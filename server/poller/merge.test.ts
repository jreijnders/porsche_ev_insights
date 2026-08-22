import { describe, expect, it } from 'vitest';

import { DEFAULT_MERGE_CONFIG, mergeSegments, type Journey } from './merge.js';
import type { ParsedSegment } from './parse.js';

/** Segment ending at `endIso`, having driven `distanceKm` over `minutes`. */
function seg(endIso: string, distanceKm: number, minutes: number, extra: Partial<ParsedSegment> = {}): ParsedSegment {
  return {
    apiEndAt: new Date(endIso),
    distanceKm,
    drivingMinutes: minutes,
    avgConsumptionKwh100km: null,
    avgSpeedKmh: null,
    raw: {},
    ...extra,
  };
}

/** Far enough in the future that everything is closed, unless stated. */
const LATER = new Date('2026-08-20T00:00:00Z');

describe('mergeSegments — gap threshold', () => {
  it('merges two segments separated by less than 15 minutes', () => {
    // first ends 10:00; second drives 10 min and ends 10:20 => starts 10:10 => gap 10 min
    const result = mergeSegments([seg('2026-08-01T10:00:00Z', 10, 20), seg('2026-08-01T10:20:00Z', 5, 10)], LATER);
    expect(result.journeys).toHaveLength(1);
    expect(result.journeys[0]!.distanceKm).toBe(15);
    expect(result.journeys[0]!.segmentCount).toBe(2);
  });

  it('splits when the gap exceeds the threshold', () => {
    // first ends 10:00; second drives 10 min and ends 10:40 => starts 10:30 => gap 30 min
    const result = mergeSegments([seg('2026-08-01T10:00:00Z', 10, 20), seg('2026-08-01T10:40:00Z', 5, 10)], LATER);
    expect(result.journeys).toHaveLength(2);
    expect(result.journeys.map((j) => j.distanceKm)).toEqual([10, 5]);
  });

  it('is inclusive on the low side of exactly 15 minutes: a 15-min gap splits', () => {
    // gap exactly 15 min -> NOT less than threshold -> splits
    const result = mergeSegments([seg('2026-08-01T10:00:00Z', 10, 20), seg('2026-08-01T10:25:00Z', 5, 10)], LATER);
    expect(result.journeys).toHaveLength(2);
  });

  it('marks a journey suspect when a decision lands within a minute of the threshold', () => {
    // gap 14 min 30 s — merges, but only just
    const result = mergeSegments([seg('2026-08-01T10:00:00Z', 10, 20), seg('2026-08-01T10:24:30Z', 5, 10)], LATER);
    expect(result.journeys).toHaveLength(1);
    expect(result.journeys[0]!.suspect).toBe(true);
  });

  it('does not mark a comfortably-merged journey suspect', () => {
    const result = mergeSegments([seg('2026-08-01T10:00:00Z', 10, 20), seg('2026-08-01T10:15:00Z', 5, 10)], LATER);
    expect(result.journeys[0]!.suspect).toBe(false);
  });
});

describe('mergeSegments — chains and ordering', () => {
  it('chains three or more segments into one journey with no ceiling', () => {
    const result = mergeSegments(
      [
        seg('2026-08-01T09:00:00Z', 20, 30),
        seg('2026-08-01T09:20:00Z', 15, 10),
        seg('2026-08-01T09:40:00Z', 25, 10),
        seg('2026-08-01T10:00:00Z', 40, 10),
      ],
      LATER,
    );
    expect(result.journeys).toHaveLength(1);
    expect(result.journeys[0]!.distanceKm).toBe(100);
    expect(result.journeys[0]!.segmentCount).toBe(4);
  });

  it('sorts input, so arrival order does not change the outcome', () => {
    const a = seg('2026-08-01T10:00:00Z', 10, 20);
    const b = seg('2026-08-01T10:20:00Z', 5, 10);
    expect(mergeSegments([b, a], LATER).journeys).toEqual(mergeSegments([a, b], LATER).journeys);
  });
});

describe('mergeSegments — aggregation', () => {
  it('sums distance and driving time, and uses wall-clock for the span', () => {
    const result = mergeSegments([seg('2026-08-01T10:00:00Z', 10, 20), seg('2026-08-01T10:20:00Z', 5, 10)], LATER);
    const j = result.journeys[0]!;
    expect(j.distanceKm).toBe(15);
    expect(j.drivingMinutes).toBe(30);
    expect(j.startedAt.toISOString()).toBe('2026-08-01T09:40:00.000Z'); // 10:00 minus 20 min
    expect(j.endedAt.toISOString()).toBe('2026-08-01T10:20:00.000Z');
  });

  it('computes average speed from total distance over total time, not by averaging averages', () => {
    // 90 km in 60 min total => 90 km/h, even though the legs differ wildly
    const result = mergeSegments(
      [
        seg('2026-08-01T10:00:00Z', 80, 40, { avgSpeedKmh: 120 }),
        seg('2026-08-01T10:15:00Z', 10, 20, { avgSpeedKmh: 30 }),
      ],
      LATER,
    );
    expect(result.journeys[0]!.avgSpeedKmh).toBe(90);
  });

  it('weights consumption by distance, so a short leg cannot dominate', () => {
    const result = mergeSegments(
      [
        seg('2026-08-01T10:00:00Z', 90, 60, { avgConsumptionKwh100km: 20 }),
        seg('2026-08-01T10:15:00Z', 10, 10, { avgConsumptionKwh100km: 40 }),
      ],
      LATER,
    );
    // (90*20 + 10*40) / 100 = 22, not the naive (20+40)/2 = 30
    expect(result.journeys[0]!.avgConsumptionKwh100km).toBe(22);
  });

  it('returns null consumption when no segment reported any', () => {
    const result = mergeSegments([seg('2026-08-01T10:00:00Z', 10, 20)], LATER);
    expect(result.journeys[0]!.avgConsumptionKwh100km).toBeNull();
  });
});

describe('mergeSegments — sub-floor segments', () => {
  it('drops a zero-distance segment but reports its distance for reconciliation', () => {
    const result = mergeSegments(
      [seg('2026-08-01T10:00:00Z', 0, 2), seg('2026-08-01T14:00:00Z', 12, 20)],
      LATER,
    );
    expect(result.journeys).toHaveLength(1);
    expect(result.journeys[0]!.distanceKm).toBe(12);
    expect(result.droppedCount).toBe(1);
    expect(result.droppedDistanceKm).toBe(0);
  });

  it('a dropped segment does not bridge two journeys that should stay separate', () => {
    const result = mergeSegments(
      [
        seg('2026-08-01T10:00:00Z', 10, 20),
        seg('2026-08-01T10:05:00Z', 0, 1), // driveway shuffle, dropped
        seg('2026-08-01T18:00:00Z', 10, 20),
      ],
      LATER,
    );
    expect(result.journeys).toHaveLength(2);
  });
});

describe('mergeSegments — provisional status', () => {
  it('is provisional until 15 minutes have passed with no new segment', () => {
    const end = '2026-08-01T10:00:00Z';
    const fiveMinLater = new Date('2026-08-01T10:05:00Z');
    expect(mergeSegments([seg(end, 10, 20)], fiveMinLater).journeys[0]!.status).toBe('provisional');
  });

  it('closes once the window has elapsed', () => {
    const end = '2026-08-01T10:00:00Z';
    const twentyMinLater = new Date('2026-08-01T10:20:00Z');
    expect(mergeSegments([seg(end, 10, 20)], twentyMinLater).journeys[0]!.status).toBe('closed');
  });
});

describe('mergeSegments — identity', () => {
  it('keeps the fingerprint stable when a journey absorbs a later segment', () => {
    const first = seg('2026-08-01T10:00:00Z', 10, 20);
    const before = mergeSegments([first], LATER).journeys[0]!.fingerprint;
    const after = mergeSegments([first, seg('2026-08-01T10:20:00Z', 5, 10)], LATER).journeys[0]!.fingerprint;
    // Identity comes from the FIRST segment, so extending must not create a
    // second trip row.
    expect(after).toBe(before);
  });

  it('gives distinct journeys distinct fingerprints', () => {
    const result = mergeSegments(
      [seg('2026-08-01T10:00:00Z', 10, 20), seg('2026-08-01T18:00:00Z', 10, 20)],
      LATER,
    );
    expect(result.journeys[0]!.fingerprint).not.toBe(result.journeys[1]!.fingerprint);
  });
});


describe('mergeSegments — degenerate input', () => {
  it('returns nothing for no segments', () => {
    expect(mergeSegments([], LATER).journeys).toEqual([]);
  });

  it('tolerates a missing driving time', () => {
    const s = seg('2026-08-01T10:00:00Z', 10, 0);
    s.drivingMinutes = null;
    const j = mergeSegments([s], LATER).journeys[0]!;
    expect(j.drivingMinutes).toBeNull();
    // With no driving time, the derived start collapses onto the end.
    expect(j.startedAt.toISOString()).toBe('2026-08-01T10:00:00.000Z');
  });

  it('uses the configured threshold rather than a hard-coded 15', () => {
    const segs = [seg('2026-08-01T10:00:00Z', 10, 20), seg('2026-08-01T10:40:00Z', 5, 10)];
    expect(mergeSegments(segs, LATER, { ...DEFAULT_MERGE_CONFIG, gapThresholdMinutes: 45 }).journeys).toHaveLength(1);
  });
});
