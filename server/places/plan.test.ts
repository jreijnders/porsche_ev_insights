import { describe, expect, it } from 'vitest';

import type { MatchablePlace, TimedFix } from './match.js';
import { planRematch, type OdometerPoint, type TripForMatch } from './plan.js';

const BASE = { lat: 51.93, lon: 4.42 };
const north = (m: number) => ({ lat: BASE.lat + m / 111_320, lon: BASE.lon });

const HOME: MatchablePlace = { id: 1, ...north(0), matchRadiusM: 150 };
const OFFICE: MatchablePlace = { id: 2, ...north(5_000), matchRadiusM: 100 };
const PLACES = [HOME, OFFICE];

const at = (iso: string) => new Date(iso);

function fix(iso: string, place: { lat: number; lon: number }): TimedFix {
  return { at: at(iso), ...place };
}

function trip(over: Partial<TripForMatch> & { id: number }): TripForMatch {
  return {
    startedAt: at('2026-08-21T09:00:00Z'),
    endedAt: at('2026-08-21T09:30:00Z'),
    checkedAt: null,
    startPlaceId: null,
    endPlaceId: null,
    endPlaceConfidence: null,
    ...over,
  };
}

const BASE_INPUT = { places: PLACES, odometer: [] as OdometerPoint[], toleranceMinutes: 60 };

describe('planRematch — a checked trip is never modified', () => {
  it('produces no update for a checked trip, however well it would match', () => {
    const checked = trip({
      id: 7,
      checkedAt: at('2026-08-21T20:00:00Z'),
    });
    const plan = planRematch({
      ...BASE_INPUT,
      trips: [checked],
      fixes: [fix('2026-08-21T09:35:00Z', north(10))], // a perfect match for HOME
    });

    expect(plan.updates).toEqual([]);
    expect(plan.skippedCheckedTripIds).toEqual([7]);
  });

  it('never emits an update whose id belongs to a checked trip, in a mixed set', () => {
    const trips = [
      trip({ id: 1, checkedAt: at('2026-08-20T10:00:00Z'), startedAt: at('2026-08-20T09:00:00Z'), endedAt: at('2026-08-20T09:30:00Z') }),
      trip({ id: 2 }),
      trip({ id: 3, checkedAt: at('2026-08-22T10:00:00Z'), startedAt: at('2026-08-22T09:00:00Z'), endedAt: at('2026-08-22T09:30:00Z') }),
    ];
    const fixes = [
      fix('2026-08-20T09:35:00Z', north(10)),
      fix('2026-08-21T09:35:00Z', north(10)),
      fix('2026-08-22T09:35:00Z', north(10)),
    ];
    const plan = planRematch({ ...BASE_INPUT, trips, fixes });

    const checkedIds = new Set([1, 3]);
    expect(plan.updates.every((u) => !checkedIds.has(u.tripId))).toBe(true);
    expect(plan.updates.map((u) => u.tripId)).toEqual([2]);
  });
});

describe('planRematch — pre-tracking trips are not failures', () => {
  it('reports a trip that ended before any fix existed as pre-tracking, not unmatched', () => {
    const old = trip({ id: 1, startedAt: at('2026-07-18T09:00:00Z'), endedAt: at('2026-07-18T12:23:35Z') });
    const recent = trip({ id: 2, startedAt: at('2026-08-22T09:00:00Z'), endedAt: at('2026-08-22T09:30:00Z') });

    const plan = planRematch({
      ...BASE_INPUT,
      trips: [old, recent],
      fixes: [fix('2026-08-22T09:35:00Z', north(10))],
    });

    expect(plan.preTrackingTripIds).toEqual([1]);
    // And crucially: no update marking it 'none', which would read as "we
    // looked and found nothing" rather than "there was nothing to look at".
    expect(plan.updates.map((u) => u.tripId)).toEqual([2]);
  });

  it('treats every trip as pre-tracking when no fixes exist at all', () => {
    const plan = planRematch({ ...BASE_INPUT, trips: [trip({ id: 1 })], fixes: [] });
    expect(plan.preTrackingTripIds).toEqual([1]);
    expect(plan.updates).toEqual([]);
  });
});

describe('planRematch — destination matching', () => {
  it('places the destination from the first fix after arrival', () => {
    const plan = planRematch({
      ...BASE_INPUT,
      trips: [trip({ id: 1 })],
      fixes: [fix('2026-08-21T09:34:00Z', north(20))],
    });

    expect(plan.updates[0]).toMatchObject({
      tripId: 1,
      endPlaceId: HOME.id,
      endPlaceConfidence: 'high',
      endFixDeltaMinutes: 4,
    });
  });

  it('records none when the only fix is outside every radius', () => {
    const plan = planRematch({
      ...BASE_INPUT,
      trips: [trip({ id: 1 })],
      fixes: [fix('2026-08-21T09:34:00Z', north(2_000))],
    });

    expect(plan.updates[0]).toMatchObject({ endPlaceId: null, endPlaceConfidence: 'none' });
  });

  it('records none when a fix exists but falls outside the tolerance window', () => {
    const plan = planRematch({
      ...BASE_INPUT,
      trips: [trip({ id: 1 })],
      fixes: [
        // An earlier fix establishes that tracking was already running, so this
        // is a genuine no-match rather than a pre-tracking trip.
        fix('2026-08-21T08:55:00Z', north(10)),
        fix('2026-08-21T11:00:00Z', north(10)), // 90 min after arrival, tolerance 60
      ],
    });

    expect(plan.updates[0]).toMatchObject({ endPlaceId: null, endFixDeltaMinutes: null });
  });
});

describe('planRematch — origin chaining', () => {
  const first = trip({
    id: 1,
    startedAt: at('2026-08-21T08:00:00Z'),
    endedAt: at('2026-08-21T08:30:00Z'),
  });
  const second = trip({
    id: 2,
    startedAt: at('2026-08-21T17:00:00Z'),
    endedAt: at('2026-08-21T17:40:00Z'),
  });
  const fixes = [
    fix('2026-08-21T08:35:00Z', { ...north(5_000) }), // arrives at OFFICE
    fix('2026-08-21T17:45:00Z', north(10)), // arrives HOME
  ];

  it('chains the origin from the previous destination when the odometer is continuous', () => {
    const odometer: OdometerPoint[] = [
      { at: at('2026-08-21T08:30:00Z'), mileageKm: 25_600 },
      { at: at('2026-08-21T17:00:00Z'), mileageKm: 25_600 }, // unmoved across the gap
    ];
    const plan = planRematch({ ...BASE_INPUT, trips: [first, second], fixes, odometer });

    const secondUpdate = plan.updates.find((u) => u.tripId === 2);
    expect(secondUpdate).toMatchObject({
      startPlaceId: OFFICE.id,
      originSource: 'chained',
    });
  });

  it('refuses to chain when the odometer shows movement in the gap', () => {
    const odometer: OdometerPoint[] = [
      { at: at('2026-08-21T08:30:00Z'), mileageKm: 25_600 },
      { at: at('2026-08-21T17:00:00Z'), mileageKm: 25_640 }, // 40 km of unlogged driving
    ];
    const plan = planRematch({ ...BASE_INPUT, trips: [first, second], fixes, odometer });

    const secondUpdate = plan.updates.find((u) => u.tripId === 2);
    expect(secondUpdate?.originSource).not.toBe('chained');
    expect(secondUpdate?.startPlaceId).not.toBe(OFFICE.id);
  });

  it('refuses to chain when there is no odometer evidence at all', () => {
    // The default state today: one odometer reading in the whole database.
    const plan = planRematch({ ...BASE_INPUT, trips: [first, second], fixes, odometer: [] });
    expect(plan.updates.find((u) => u.tripId === 2)?.originSource).not.toBe('chained');
  });

  it('does not propagate a broken chain into later trips', () => {
    const third = trip({
      id: 3,
      startedAt: at('2026-08-22T08:00:00Z'),
      endedAt: at('2026-08-22T08:30:00Z'),
    });
    const plan = planRematch({
      ...BASE_INPUT,
      trips: [first, second, third],
      fixes: [...fixes, fix('2026-08-22T08:35:00Z', north(9_000))], // nowhere known
      odometer: [],
    });

    // Nothing may inherit an origin that was never established.
    expect(plan.updates.find((u) => u.tripId === 3)?.startPlaceId).toBeNull();
    expect(plan.updates.find((u) => u.tripId === 3)?.originSource).toBe('none');
  });

  it('inherits the previous destination\'s confidence rather than upgrading it', () => {
    // Two places close together make the destination ambiguous; the origin
    // chained from it must not claim to be more certain than its source.
    const crowded: MatchablePlace[] = [
      { id: 1, ...north(5_000), matchRadiusM: 200 },
      { id: 2, ...north(5_060), matchRadiusM: 200 },
    ];
    const odometer: OdometerPoint[] = [
      { at: at('2026-08-21T08:30:00Z'), mileageKm: 25_600 },
      { at: at('2026-08-21T17:00:00Z'), mileageKm: 25_600 },
    ];
    const plan = planRematch({
      places: crowded,
      toleranceMinutes: 60,
      trips: [first, second],
      // Nearly equidistant between the two: 28 m and 32 m, so the runner-up is
      // well inside the 1.5x ratio and the destination is a coin toss.
      fixes: [fix('2026-08-21T08:35:00Z', north(5_028)), fix('2026-08-21T17:45:00Z', north(20_000))],
      odometer,
    });

    expect(plan.updates.find((u) => u.tripId === 1)?.endPlaceConfidence).toBe('low');
    expect(plan.updates.find((u) => u.tripId === 2)).toMatchObject({
      originSource: 'chained',
      startPlaceConfidence: 'low',
    });
  });

  it('chains from a checked trip, which is the most trustworthy ancestor', () => {
    const checkedFirst = { ...first, checkedAt: at('2026-08-21T20:00:00Z'), endPlaceId: OFFICE.id, endPlaceConfidence: 'high' as const };
    const odometer: OdometerPoint[] = [
      { at: at('2026-08-21T08:30:00Z'), mileageKm: 25_600 },
      { at: at('2026-08-21T17:00:00Z'), mileageKm: 25_600 },
    ];
    const plan = planRematch({ ...BASE_INPUT, trips: [checkedFirst, second], fixes, odometer });

    expect(plan.updates.find((u) => u.tripId === 2)).toMatchObject({
      startPlaceId: OFFICE.id,
      startPlaceConfidence: 'high',
      originSource: 'chained',
    });
  });
});

describe('planRematch — ordering', () => {
  it('does not assume the trips arrive in order', () => {
    const first = trip({ id: 1, startedAt: at('2026-08-21T08:00:00Z'), endedAt: at('2026-08-21T08:30:00Z') });
    const second = trip({ id: 2, startedAt: at('2026-08-21T17:00:00Z'), endedAt: at('2026-08-21T17:40:00Z') });
    const odometer: OdometerPoint[] = [
      { at: at('2026-08-21T08:30:00Z'), mileageKm: 25_600 },
      { at: at('2026-08-21T17:00:00Z'), mileageKm: 25_600 },
    ];
    const fixes = [
      fix('2026-08-21T08:35:00Z', north(5_000)),
      fix('2026-08-21T17:45:00Z', north(10)),
    ];

    // Reversed input; chaining must still run first -> second.
    const plan = planRematch({ ...BASE_INPUT, trips: [second, first], fixes, odometer });
    expect(plan.updates.find((u) => u.tripId === 2)?.originSource).toBe('chained');
  });
});
