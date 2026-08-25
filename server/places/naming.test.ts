import { describe, expect, it } from 'vitest';

import type { MatchablePlace } from './match.js';
import {
  CANDIDATE_RADIUS_M,
  CLUSTER_RADIUS_M,
  clusterArrivals,
  isPreTrackingWindow,
  judgeWiden,
  nearbyCandidates,
  WIDEN_MARGIN_M,
  WIDEN_WARNING_M,
  type ArrivalPoint,
} from './naming.js';

/** Rotterdam Spaanse Polder — the ground #5, #16 and this ticket all measured. */
const BASE = { lat: 51.93, lon: 4.42 };

function north(metres: number) {
  return { lat: BASE.lat + metres / 111_320, lon: BASE.lon };
}

function place(id: number, metresNorth: number, matchRadiusM: number): MatchablePlace {
  return { id, ...north(metresNorth), matchRadiusM, kind: 'business' };
}

function arrival(tripId: number, metresNorth: number, minutes: number): ArrivalPoint {
  return { tripId, ...north(metresNorth), endedAt: new Date(Date.UTC(2026, 7, 20, 0, minutes)) };
}

describe('nearbyCandidates', () => {
  it('includes places the fix is already inside — the wrong-match case needs them', () => {
    // The panel opens on low-confidence matches too, where the trip HAS a place
    // and it may be the wrong one. A list of only-outside places could not
    // offer the right answer.
    const [first] = nearbyCandidates(BASE, [place(1, 20, 100)]);
    expect(first?.withinRadius).toBe(true);
    expect(first?.widenToM).toBeNull();
  });

  it('states the resulting radius rather than just offering to widen', () => {
    const [first] = nearbyCandidates(BASE, [place(1, 200, 100)]);
    expect(first?.withinRadius).toBe(false);
    expect(first?.widenToM).toBe(Math.ceil(200 + WIDEN_MARGIN_M));
  });

  it('flags a widen that would cross the ceiling', () => {
    const under = nearbyCandidates(BASE, [place(1, 200, 100)])[0];
    const over = nearbyCandidates(BASE, [place(2, 640, 100)])[0];
    expect(under?.widenNeedsOverride).toBe(false);
    expect(over?.widenNeedsOverride).toBe(true);
    // The far one is still SHOWN — showing and offering are different acts.
    expect(over?.distanceM).toBeGreaterThan(WIDEN_WARNING_M);
  });

  it('drops places beyond the candidate radius', () => {
    expect(nearbyCandidates(BASE, [place(1, CANDIDATE_RADIUS_M + 50, 100)])).toHaveLength(0);
    expect(nearbyCandidates(BASE, [place(1, CANDIDATE_RADIUS_M - 50, 100)])).toHaveLength(1);
  });

  it('returns nearest first and caps the shortlist', () => {
    const places = [place(1, 800, 100), place(2, 50, 100), place(3, 400, 100), place(4, 600, 100)];
    expect(nearbyCandidates(BASE, places).map((c) => c.placeId)).toEqual([2, 3, 4]);
  });
});

describe('judgeWiden', () => {
  it('refuses a widen that would change nothing', () => {
    const verdict = judgeWiden(500, 100);
    expect(verdict).toMatchObject({ allowed: false, reason: 'no-op' });
  });

  it('allows a small widen without ceremony', () => {
    expect(judgeWiden(100, 200)).toMatchObject({ allowed: true, needsOverride: false, newRadiusM: 210 });
  });

  it('refuses to cross the ceiling until the caller says it means it', () => {
    const distance = WIDEN_WARNING_M + 100;
    expect(judgeWiden(100, distance)).toMatchObject({ allowed: false, reason: 'override-required' });
    expect(judgeWiden(100, distance, WIDEN_MARGIN_M, true)).toMatchObject({
      allowed: true,
      needsOverride: true,
    });
  });

  it('no-op wins over override-required — an override cannot force a pointless widen', () => {
    // Order matters: if the ceiling were checked first, an oversized place
    // would report "needs override" for a widen that would then do nothing,
    // and confirming it would report success while changing no radius.
    expect(judgeWiden(2_000, 900, WIDEN_MARGIN_M, true)).toMatchObject({ allowed: false, reason: 'no-op' });
  });

  it('the margin is what makes a place reach PAST the fix, not exactly to it', () => {
    const { newRadiusM } = judgeWiden(10, 100, WIDEN_MARGIN_M, false) as { newRadiusM: number };
    expect(newRadiusM).toBeGreaterThan(100);
  });
});

describe('clusterArrivals', () => {
  it('groups arrivals at one spot and averages the centre', () => {
    const [cluster] = clusterArrivals([arrival(1, 0, 0), arrival(2, 40, 10), arrival(3, 80, 20)]);
    expect(cluster?.tripIds).toEqual([1, 2, 3]);
    expect(cluster?.lat).toBeCloseTo(north(40).lat, 5);
  });

  it('keeps genuinely separate spots apart', () => {
    const clusters = clusterArrivals([arrival(1, 0, 0), arrival(2, 500, 10)]);
    expect(clusters).toHaveLength(2);
  });

  it('does not chain a street into one cluster', () => {
    // Four arrivals 90 m apart: each is within CLUSTER_RADIUS_M of its
    // neighbour, so transitive chaining would merge 270 m of street into a
    // single "spot" and then create one place that matches none of them well.
    const clusters = clusterArrivals([arrival(1, 0, 0), arrival(2, 90, 10), arrival(3, 180, 20), arrival(4, 270, 30)]);
    expect(clusters.length).toBeGreaterThan(1);
    for (const c of clusters) expect(c.spreadM).toBeLessThanOrEqual(CLUSTER_RADIUS_M);
  });

  it('orders by trip count, so the spot you keep visiting comes first', () => {
    const clusters = clusterArrivals([
      arrival(1, 0, 0),
      arrival(2, 5_000, 10),
      arrival(3, 5_010, 20),
      arrival(4, 5_020, 30),
    ]);
    expect(clusters[0]?.tripIds).toHaveLength(3);
    expect(clusters[1]?.tripIds).toEqual([1]);
  });

  it('does not depend on the order rows arrive in', () => {
    // The API returns history unordered (#15 probe) and a plain SELECT has no
    // guaranteed order either, so the grouping seeds from the oldest arrival
    // rather than from whatever came back first.
    const points = [arrival(1, 0, 0), arrival(2, 40, 10), arrival(3, 5_000, 20)];
    const forwards = clusterArrivals(points);
    const backwards = clusterArrivals([...points].reverse());
    expect(backwards.map((c) => c.tripIds)).toEqual(forwards.map((c) => c.tripIds));
  });

  it('reports spread, so a cluster over a whole car park is visible as one', () => {
    const [cluster] = clusterArrivals([arrival(1, 0, 0), arrival(2, 60, 10)]);
    expect(cluster?.spreadM).toBe(30);
  });
});

describe('isPreTrackingWindow', () => {
  const TOLERANCE = 60;
  const at = (h: number) => new Date(Date.UTC(2026, 7, 20, h));

  it('is true when no position has ever been recorded', () => {
    expect(isPreTrackingWindow(at(12), null, TOLERANCE)).toBe(true);
  });

  it('does NOT brand the first trip after tracking begins', () => {
    // The bug #22 found live: that trip's own arrival fix usually IS the
    // earliest fix, so a naive `endedAt < earliestFix` test excludes the only
    // placeable trip in the ledger — permanently, and without saying so.
    const endedAt = at(12);
    const itsOwnArrivalFix = new Date(endedAt.getTime() + 2 * 60_000);
    expect(isPreTrackingWindow(endedAt, itsOwnArrivalFix, TOLERANCE)).toBe(false);
    // The naive form would have said true, which is the whole point.
    expect(endedAt.getTime() < itsOwnArrivalFix.getTime()).toBe(true);
  });

  it('is true only once the whole arrival window closed before the first fix', () => {
    const endedAt = at(12);
    const justInside = new Date(endedAt.getTime() + (TOLERANCE - 1) * 60_000);
    const justOutside = new Date(endedAt.getTime() + (TOLERANCE + 1) * 60_000);
    expect(isPreTrackingWindow(endedAt, justInside, TOLERANCE)).toBe(false);
    expect(isPreTrackingWindow(endedAt, justOutside, TOLERANCE)).toBe(true);
  });

  it('accepts a timestamp or a Date, because the two callers hold different ones', () => {
    const endedAt = at(12);
    const fix = at(20);
    expect(isPreTrackingWindow(endedAt, fix, TOLERANCE)).toBe(isPreTrackingWindow(endedAt, fix.getTime(), TOLERANCE));
  });
});
