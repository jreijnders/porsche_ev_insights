import { describe, expect, it } from 'vitest';

import { monthKeyOf } from '../time/month.js';
import {
  buildWindows,
  reconcileMonth,
  toleranceFor,
  type Reading,
  type TripSpan,
} from './window.js';

const at = (iso: string) => new Date(iso);

function reading(iso: string, mileageKm: number): Reading {
  return { at: at(iso), mileageKm };
}

let nextId = 1;
function trip(iso: string, distanceKm: number): TripSpan {
  return { id: nextId++, endedAt: at(iso), distanceKm };
}

/** A trip well after every window, so windows are judgeable rather than settling. */
const LATER = at('2026-10-01T00:00:00Z');

describe('toleranceFor — scales with the number of roundings', () => {
  it('has a 2 km floor for a nearly empty window', () => {
    expect(toleranceFor(0)).toBe(2);
    expect(toleranceFor(1)).toBe(2);
    expect(toleranceFor(4)).toBe(2);
  });

  it('grows at half a kilometre per trip once past the floor', () => {
    // Whole-kilometre reporting means up to 0.5 km of rounding per trip.
    expect(toleranceFor(10)).toBe(5);
    expect(toleranceFor(40)).toBe(20);
  });
});

describe('buildWindows — arithmetic between consecutive readings', () => {
  const readings = [reading('2026-08-01T08:00:00Z', 1_000), reading('2026-08-10T08:00:00Z', 1_100)];

  it('subtracts the trips inside the window from the odometer delta', () => {
    const [w] = buildWindows({
      readings,
      trips: [trip('2026-08-03T10:00:00Z', 60), trip('2026-08-07T10:00:00Z', 40)],
      latestTripEndedAt: LATER,
    });

    expect(w).toMatchObject({
      odometerDeltaKm: 100,
      loggedKm: 100,
      differenceKm: 0,
      tripCount: 2,
      verdict: 'quiet',
    });
  });

  it('ignores trips that ended before the window opened', () => {
    const [w] = buildWindows({
      readings,
      trips: [trip('2026-07-30T10:00:00Z', 60), trip('2026-08-03T10:00:00Z', 40)],
      latestTripEndedAt: LATER,
    });
    expect(w?.tripCount).toBe(1);
    expect(w?.loggedKm).toBe(40);
  });

  it('ignores trips that ended after the window closed', () => {
    const [w] = buildWindows({
      readings,
      trips: [trip('2026-08-03T10:00:00Z', 40), trip('2026-08-12T10:00:00Z', 60)],
      latestTripEndedAt: LATER,
    });
    expect(w?.tripCount).toBe(1);
  });

  it('counts a trip ending exactly on the closing reading, and only once', () => {
    // The boundary is (from, to]: a trip on the edge belongs to the earlier
    // window alone. Counting it twice would invent an over-log AND a gap.
    const three = [
      reading('2026-08-01T08:00:00Z', 1_000),
      reading('2026-08-10T08:00:00Z', 1_100),
      reading('2026-08-20T08:00:00Z', 1_200),
    ];
    const windows = buildWindows({
      readings: three,
      trips: [trip('2026-08-10T08:00:00Z', 100), trip('2026-08-15T10:00:00Z', 100)],
      latestTripEndedAt: LATER,
    });

    expect(windows[0]?.tripCount).toBe(1);
    expect(windows[1]?.tripCount).toBe(1);
    expect(windows[0]?.verdict).toBe('quiet');
    expect(windows[1]?.verdict).toBe('quiet');
  });

  it('excludes a trip ending exactly on the opening reading', () => {
    const [w] = buildWindows({
      readings,
      trips: [trip('2026-08-01T08:00:00Z', 50)],
      latestTripEndedAt: LATER,
    });
    expect(w?.tripCount).toBe(0);
  });

  it('spans the gap between one month\'s last reading and the next month\'s first', () => {
    // The whole reason for reconciling between readings rather than within
    // months: these 100 km would vanish from a per-month min/max.
    const [w] = buildWindows({
      readings: [reading('2026-08-28T08:00:00Z', 1_000), reading('2026-09-03T08:00:00Z', 1_100)],
      trips: [],
      latestTripEndedAt: LATER,
    });
    expect(w?.odometerDeltaKm).toBe(100);
    expect(w?.differenceKm).toBe(100);
    expect(w?.verdict).toBe('unaccounted');
  });

  it('does not assume the readings arrive in order', () => {
    const [w] = buildWindows({
      readings: [reading('2026-08-10T08:00:00Z', 1_100), reading('2026-08-01T08:00:00Z', 1_000)],
      trips: [],
      latestTripEndedAt: LATER,
    });
    expect(w?.fromKm).toBe(1_000);
    expect(w?.odometerDeltaKm).toBe(100);
  });

  it('produces no windows from fewer than two readings', () => {
    expect(buildWindows({ readings: [reading('2026-08-01T08:00:00Z', 1_000)], trips: [], latestTripEndedAt: LATER })).toEqual([]);
    expect(buildWindows({ readings: [], trips: [], latestTripEndedAt: LATER })).toEqual([]);
  });
});

describe('buildWindows — tolerance either side', () => {
  const readings = [reading('2026-08-01T08:00:00Z', 1_000), reading('2026-08-10T08:00:00Z', 1_100)];

  it('stays quiet just inside the floor with few trips', () => {
    // 2 trips -> tolerance 2 km. Difference of exactly 2 km is inside.
    const [w] = buildWindows({
      readings,
      trips: [trip('2026-08-03T10:00:00Z', 50), trip('2026-08-05T10:00:00Z', 48)],
      latestTripEndedAt: LATER,
    });
    expect(w?.differenceKm).toBe(2);
    expect(w?.verdict).toBe('quiet');
  });

  it('flags just outside the floor with few trips', () => {
    const [w] = buildWindows({
      readings,
      trips: [trip('2026-08-03T10:00:00Z', 50), trip('2026-08-05T10:00:00Z', 47)],
      latestTripEndedAt: LATER,
    });
    expect(w?.differenceKm).toBe(3);
    expect(w?.verdict).toBe('unaccounted');
  });

  it('tolerates more drift when many trips carry many roundings', () => {
    // 20 trips of 4 km = 80 km logged against 100 km driven: 20 km adrift, but
    // tolerance is 10 km, so this IS still flagged...
    const many = Array.from({ length: 20 }, (_, i) =>
      trip(`2026-08-0${(i % 9) + 1}T1${i % 10}:00:00Z`, 4),
    );
    const [w] = buildWindows({ readings, trips: many, latestTripEndedAt: LATER });
    expect(w?.toleranceKm).toBe(10);
    expect(w?.verdict).toBe('unaccounted');
  });

  it('stays quiet where the same drift would be flagged with fewer trips', () => {
    // 20 trips totalling 92 km: 8 km adrift, inside a 10 km tolerance. The
    // identical 8 km with two trips would be flagged.
    const many = Array.from({ length: 20 }, (_, i) =>
      trip(`2026-08-0${(i % 9) + 1}T1${i % 10}:00:00Z`, 4.6),
    );
    const [w] = buildWindows({ readings, trips: many, latestTripEndedAt: LATER });
    expect(w?.toleranceKm).toBe(10);
    expect(w?.verdict).toBe('quiet');
  });
});

describe('buildWindows — the two directions are not the same problem', () => {
  const readings = [reading('2026-08-01T08:00:00Z', 1_000), reading('2026-08-10T08:00:00Z', 1_100)];

  it('reports the odometer running ahead as unaccounted, with a positive difference', () => {
    const [w] = buildWindows({ readings, trips: [trip('2026-08-03T10:00:00Z', 40)], latestTripEndedAt: LATER });
    expect(w?.verdict).toBe('unaccounted');
    expect(w?.differenceKm).toBe(60);
  });

  it('reports the ledger running ahead as over_logged, with a negative difference', () => {
    // A duplicated trip: 160 km logged against 100 km driven. This one is
    // already inside the invoice figure, which is why it is not collapsed into
    // an absolute "discrepancy".
    const [w] = buildWindows({
      readings,
      trips: [trip('2026-08-03T10:00:00Z', 80), trip('2026-08-03T10:00:00Z', 80)],
      latestTripEndedAt: LATER,
    });
    expect(w?.verdict).toBe('over_logged');
    expect(w?.differenceKm).toBe(-60);
  });
});

describe('buildWindows — settling is structural, not a timer', () => {
  const readings = [
    reading('2026-08-01T08:00:00Z', 1_000),
    reading('2026-08-10T08:00:00Z', 1_100),
    reading('2026-08-20T08:00:00Z', 1_250),
  ];
  const trips = [trip('2026-08-05T10:00:00Z', 100)];

  it('holds the newest window as settling while nothing later has arrived', () => {
    const windows = buildWindows({ readings, trips, latestTripEndedAt: at('2026-08-05T10:00:00Z') });
    // The first window is judgeable — a later trip exists relative to it? No:
    // the newest trip ends BEFORE the first window closes, so both are settling.
    expect(windows.map((w) => w.verdict)).toEqual(['settling', 'settling']);
  });

  it('releases a window once a trip later than it is ingested', () => {
    const windows = buildWindows({ readings, trips, latestTripEndedAt: at('2026-08-12T10:00:00Z') });
    // A trip on the 12th proves history has moved past the window closing on
    // the 10th, but says nothing about the one closing on the 20th.
    expect(windows[0]?.verdict).toBe('quiet');
    expect(windows[1]?.verdict).toBe('settling');
  });

  it('never reports settling as clean, even when the arithmetic happens to balance', () => {
    const windows = buildWindows({
      readings: [reading('2026-08-01T08:00:00Z', 1_000), reading('2026-08-10T08:00:00Z', 1_100)],
      trips: [trip('2026-08-05T10:00:00Z', 100)],
      latestTripEndedAt: at('2026-08-05T10:00:00Z'),
    });
    expect(windows[0]?.differenceKm).toBe(0);
    expect(windows[0]?.verdict).toBe('settling');
  });

  it('holds everything as settling when there are no trips at all', () => {
    const windows = buildWindows({ readings, trips: [], latestTripEndedAt: null });
    expect(windows.every((w) => w.verdict === 'settling')).toBe(true);
  });
});

describe('monthKeyOf — the boundary is Amsterdam, not UTC', () => {
  it('puts a summer trip just after local midnight in the new month', () => {
    // 22:30 UTC on 31 August is 00:30 on 1 September in Amsterdam (CEST).
    expect(monthKeyOf(at('2026-08-31T22:30:00Z'))).toBe('2026-09');
  });

  it('puts a summer instant just before local midnight in the old month', () => {
    expect(monthKeyOf(at('2026-08-31T21:30:00Z'))).toBe('2026-08');
  });

  it('handles the winter offset too', () => {
    // CET is +1: 23:30 UTC on 31 December is 00:30 on 1 January locally.
    expect(monthKeyOf(at('2026-12-31T23:30:00Z'))).toBe('2027-01');
    expect(monthKeyOf(at('2026-12-31T22:30:00Z'))).toBe('2026-12');
  });
});

describe('reconcileMonth', () => {
  const windows = buildWindows({
    readings: [
      reading('2026-08-01T08:00:00Z', 1_000),
      reading('2026-08-10T08:00:00Z', 1_100),
      reading('2026-08-20T08:00:00Z', 1_200),
    ],
    trips: [trip('2026-08-05T10:00:00Z', 100), trip('2026-08-15T10:00:00Z', 60)],
    latestTripEndedAt: LATER,
  });

  it('sums the month\'s windows and names the direction', () => {
    const result = reconcileMonth('2026-08', windows, at('2026-08-01T08:00:00Z'));
    expect(result.status).toBe('unaccounted');
    expect(result.unaccountedKm).toBe(40);
    expect(result.overLoggedKm).toBe(0);
    expect(result.windows).toHaveLength(2);
  });

  it('reports a month entirely before any reading as not_reconcilable, never as zero', () => {
    const result = reconcileMonth('2026-07', windows, at('2026-08-01T08:00:00Z'));
    expect(result.status).toBe('not_reconcilable');
    // The figure must not read as "checked, and nothing missing".
    expect(result.windows).toEqual([]);
  });

  it('reports the month coverage began in as partial, and says from when', () => {
    const clean = buildWindows({
      readings: [reading('2026-08-14T08:00:00Z', 1_000), reading('2026-08-20T08:00:00Z', 1_100)],
      trips: [trip('2026-08-15T10:00:00Z', 100)],
      latestTripEndedAt: LATER,
    });
    const result = reconcileMonth('2026-08', clean, at('2026-08-14T08:00:00Z'));
    expect(result.status).toBe('partial');
    expect(result.coverageFrom).toEqual(at('2026-08-14T08:00:00Z'));
  });

  it('prefers over_logged when both directions appear — it is the dangerous one', () => {
    const mixed = buildWindows({
      readings: [
        reading('2026-08-01T08:00:00Z', 1_000),
        reading('2026-08-10T08:00:00Z', 1_100), // 40 km unaccounted
        reading('2026-08-20T08:00:00Z', 1_150), // 50 km over-logged
      ],
      trips: [trip('2026-08-05T10:00:00Z', 60), trip('2026-08-15T10:00:00Z', 100)],
      latestTripEndedAt: LATER,
    });
    const result = reconcileMonth('2026-08', mixed, at('2026-08-01T08:00:00Z'));
    expect(result.status).toBe('over_logged');
    // Both are reported; neither is collapsed into the other.
    expect(result.unaccountedKm).toBe(40);
    expect(result.overLoggedKm).toBe(50);
  });

  it('an acknowledged-gap trip brings the window to quiet', () => {
    // The mechanism for closing a gap is an ordinary manual trip (#12), so the
    // arithmetic must simply absorb it.
    const before = buildWindows({
      readings: [reading('2026-08-01T08:00:00Z', 1_000), reading('2026-08-10T08:00:00Z', 1_100)],
      trips: [trip('2026-08-05T10:00:00Z', 60)],
      latestTripEndedAt: LATER,
    });
    // Coverage began in JULY, so August is fully covered and can reach 'quiet'
    // rather than the 'partial' a mid-month first reading would force.
    const coverageFrom = at('2026-07-25T08:00:00Z');
    expect(reconcileMonth('2026-08', before, coverageFrom).unaccountedKm).toBe(40);

    const after = buildWindows({
      readings: [reading('2026-08-01T08:00:00Z', 1_000), reading('2026-08-10T08:00:00Z', 1_100)],
      trips: [trip('2026-08-05T10:00:00Z', 60), trip('2026-08-06T10:00:00Z', 40)],
      latestTripEndedAt: LATER,
    });
    const result = reconcileMonth('2026-08', after, coverageFrom);
    expect(result.status).toBe('quiet');
    expect(result.unaccountedKm).toBe(0);
  });

  it('reports settling rather than quiet when nothing in the month is judgeable', () => {
    const fresh = buildWindows({
      readings: [reading('2026-08-01T08:00:00Z', 1_000), reading('2026-08-10T08:00:00Z', 1_100)],
      trips: [trip('2026-08-05T10:00:00Z', 100)],
      latestTripEndedAt: at('2026-08-05T10:00:00Z'),
    });
    expect(reconcileMonth('2026-08', fresh, at('2026-08-01T08:00:00Z')).status).toBe('settling');
  });
});

describe('reconciliation agrees with the origin chain (#11/#22)', () => {
  it('sees the same event a broken chain sees', () => {
    // A broken origin chain and unaccounted kilometres are one event from two
    // directions: the car moved without a logged trip. chainIsContinuous refuses
    // the chain when the bracketing odometer readings differ; reconciliation
    // reports that same difference as unaccounted. They must not disagree.
    const readings = [reading('2026-08-05T09:00:00Z', 25_600), reading('2026-08-05T17:00:00Z', 25_640)];
    const [w] = buildWindows({ readings, trips: [], latestTripEndedAt: LATER });

    const gapKm = readings[1]!.mileageKm - readings[0]!.mileageKm;
    expect(w?.differenceKm).toBe(gapKm);
    expect(w?.verdict).toBe('unaccounted');
    // Same 40 km that makes chainIsContinuous(25_600, 25_640) return false.
    expect(gapKm).toBeGreaterThan(1);
  });
});
