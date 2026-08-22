import { describe, expect, it } from 'vitest';

import {
  chainIsContinuous,
  haversineMeters,
  matchPlace,
  RUNNER_UP_RATIO,
  selectArrivalFix,
  selectDepartureFix,
  type MatchablePlace,
  type TimedFix,
} from './match.js';

/** Rotterdam Spaanse Polder — the real place book's neighbourhood (#5). */
const BASE = { lat: 51.93, lon: 4.42 };

/** Metres north of BASE, via the exact degrees-per-metre at this latitude. */
function north(metres: number) {
  return { lat: BASE.lat + metres / 111_320, lon: BASE.lon };
}

function place(id: number, metresNorth: number, matchRadiusM: number): MatchablePlace {
  return { id, ...north(metresNorth), matchRadiusM };
}

describe('haversineMeters', () => {
  it('is zero for a point against itself', () => {
    expect(haversineMeters(BASE, BASE)).toBe(0);
  });

  it('matches a known distance: Amsterdam to Rotterdam is ~57.23 km', () => {
    const amsterdam = { lat: 52.3676, lon: 4.9041 };
    const rotterdam = { lat: 51.9244, lon: 4.4777 };
    // 57,229.3 m, computed independently in Python for these exact
    // coordinates. NOT the ~57.8 km usually quoted between the two cities —
    // that is a different pair of reference points, and taking it on trust
    // would have "failed" a correct implementation.
    expect(haversineMeters(amsterdam, rotterdam)).toBeCloseTo(57_229.3, 0);
  });

  it('is symmetric', () => {
    const a = { lat: 51.93, lon: 4.42 };
    const b = { lat: 52.09, lon: 5.11 };
    expect(haversineMeters(a, b)).toBeCloseTo(haversineMeters(b, a), 6);
  });

  it('measures a short north-south offset accurately', () => {
    // 100 m north should read as ~100 m, within a metre.
    expect(haversineMeters(BASE, north(100))).toBeCloseTo(100, 0);
  });
});

describe('matchPlace — nearest wins', () => {
  it('picks the nearest place when several are in range', () => {
    const places = [place(1, 80, 200), place(2, 20, 200), place(3, 150, 200)];
    const result = matchPlace(BASE, places);
    expect(result.placeId).toBe(2);
    expect(result.distanceM).toBeCloseTo(20, 0);
  });

  it('returns none, and no place, when nothing is in range', () => {
    const result = matchPlace(BASE, [place(1, 500, 100), place(2, 900, 100)]);
    expect(result).toEqual({
      placeId: null,
      confidence: 'none',
      distanceM: null,
      runnerUpDistanceM: null,
    });
  });

  it('returns none for an empty place book', () => {
    expect(matchPlace(BASE, []).confidence).toBe('none');
  });

  it('respects each place\'s own radius, not a global one', () => {
    // The nearer place has a radius too tight to contain the fix; the further
    // one is generous enough. The generous one must win.
    const result = matchPlace(BASE, [place(1, 50, 10), place(2, 300, 400)]);
    expect(result.placeId).toBe(2);
  });
});

describe('matchPlace — radius boundary is inclusive', () => {
  it('matches a fix exactly on the boundary', () => {
    // 100 m away, 100 m radius: inside.
    const result = matchPlace(BASE, [place(1, 100, 100)]);
    expect(result.placeId).toBe(1);
    expect(result.confidence).toBe('high');
  });

  it('rejects a fix just outside the boundary', () => {
    const result = matchPlace(BASE, [place(1, 101, 100)]);
    expect(result.placeId).toBeNull();
    expect(result.confidence).toBe('none');
  });
});

describe('matchPlace — the 1.5x runner-up threshold', () => {
  it('is low when the runner-up is inside the ratio', () => {
    // 100 m and 140 m: 140 <= 100 * 1.5, so the win is not convincing.
    const result = matchPlace(BASE, [place(1, 100, 500), place(2, 140, 500)]);
    expect(result.placeId).toBe(1);
    expect(result.confidence).toBe('low');
    expect(result.runnerUpDistanceM).toBeCloseTo(140, 0);
  });

  it('is low exactly at the ratio', () => {
    // 100 m and 150 m: the boundary case, inclusive.
    const result = matchPlace(BASE, [place(1, 100, 500), place(2, 150, 500)]);
    expect(result.confidence).toBe('low');
  });

  it('is high just beyond the ratio', () => {
    // 100 m and 160 m: 160 > 150, a clear win.
    const result = matchPlace(BASE, [place(1, 100, 500), place(2, 160, 500)]);
    expect(result.confidence).toBe('high');
    expect(result.runnerUpDistanceM).toBeCloseTo(160, 0);
  });

  it('ignores a near runner-up that is outside its own radius', () => {
    // The second place is close, but its radius excludes the fix, so it is not
    // a candidate at all and cannot make the winner ambiguous.
    const result = matchPlace(BASE, [place(1, 100, 500), place(2, 120, 50)]);
    expect(result.confidence).toBe('high');
    expect(result.runnerUpDistanceM).toBeNull();
  });

  it('uses the documented ratio', () => {
    expect(RUNNER_UP_RATIO).toBe(1.5);
  });
});

describe('selectArrivalFix — tolerance window edges', () => {
  const endedAt = new Date('2026-08-21T12:00:00Z');
  const fixAt = (minutes: number): TimedFix => ({
    ...north(0),
    at: new Date(endedAt.getTime() + minutes * 60_000),
  });

  it('takes the first fix at or after the trip end', () => {
    const selected = selectArrivalFix(endedAt, [fixAt(30), fixAt(5), fixAt(50)], 60);
    expect(selected?.deltaMinutes).toBe(5);
  });

  it('accepts a fix exactly at the trip end, with a zero delta', () => {
    const selected = selectArrivalFix(endedAt, [fixAt(0)], 60);
    expect(selected?.deltaMinutes).toBe(0);
  });

  it('accepts a fix exactly on the tolerance boundary', () => {
    expect(selectArrivalFix(endedAt, [fixAt(60)], 60)?.deltaMinutes).toBe(60);
  });

  it('rejects a fix one minute past the tolerance', () => {
    expect(selectArrivalFix(endedAt, [fixAt(61)], 60)).toBeNull();
  });

  it('never looks backwards — a fix before the trip ended is not an arrival', () => {
    expect(selectArrivalFix(endedAt, [fixAt(-5)], 60)).toBeNull();
  });

  it('does not assume the fixes are sorted', () => {
    // The API returns history unordered (#15); nothing here may rely on order.
    const selected = selectArrivalFix(endedAt, [fixAt(45), fixAt(2), fixAt(20)], 60);
    expect(selected?.deltaMinutes).toBe(2);
  });

  it('returns null when there are no fixes at all', () => {
    expect(selectArrivalFix(endedAt, [], 60)).toBeNull();
  });
});

describe('selectDepartureFix', () => {
  const startedAt = new Date('2026-08-21T09:00:00Z');
  const fixAt = (minutes: number): TimedFix => ({
    ...north(0),
    at: new Date(startedAt.getTime() + minutes * 60_000),
  });

  it('takes the last fix at or before the trip start', () => {
    const selected = selectDepartureFix(startedAt, [fixAt(-50), fixAt(-3), fixAt(-30)], 60);
    expect(selected?.deltaMinutes).toBe(3);
  });

  it('accepts a fix exactly on the tolerance boundary', () => {
    expect(selectDepartureFix(startedAt, [fixAt(-60)], 60)?.deltaMinutes).toBe(60);
  });

  it('rejects a fix beyond the tolerance', () => {
    expect(selectDepartureFix(startedAt, [fixAt(-61)], 60)).toBeNull();
  });

  it('never looks forwards — a fix after the trip started is not a departure', () => {
    expect(selectDepartureFix(startedAt, [fixAt(5)], 60)).toBeNull();
  });
});

describe('chainIsContinuous — the chain must be proven', () => {
  it('accepts an unchanged odometer across the gap', () => {
    expect(chainIsContinuous(25_647, 25_647)).toBe(true);
  });

  it('accepts a one-kilometre difference, which is rounding not driving', () => {
    // Distances arrive as whole kilometres (#15), so a 1 km delta between two
    // readings is inside the noise floor.
    expect(chainIsContinuous(25_647, 25_648)).toBe(true);
  });

  it('refuses a gap where the car demonstrably moved', () => {
    expect(chainIsContinuous(25_647, 25_659)).toBe(false);
  });

  it('refuses when the odometer moved backwards by more than tolerance', () => {
    // Should not happen, but a broken chain is the safe reading of nonsense.
    expect(chainIsContinuous(25_659, 25_647)).toBe(false);
  });

  it('refuses when evidence is missing on either side', () => {
    expect(chainIsContinuous(null, 25_647)).toBe(false);
    expect(chainIsContinuous(25_647, null)).toBe(false);
    expect(chainIsContinuous(null, null)).toBe(false);
  });

  it('honours an explicit tolerance', () => {
    expect(chainIsContinuous(100, 103, 5)).toBe(true);
    expect(chainIsContinuous(100, 106, 5)).toBe(false);
  });
});
