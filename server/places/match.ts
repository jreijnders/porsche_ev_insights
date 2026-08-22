/**
 * Place matching (#11) — the arithmetic, with no database in sight.
 *
 * Manual-first: a place exists because you named it. Matching needs nothing
 * external, which is the whole point — a Google billing outage cannot stop the
 * ledger from naming where you went.
 *
 * Everything here is pure so it can be tested against known coordinates. The
 * database-facing half lives in service.ts.
 */

export interface Coord {
  lat: number;
  lon: number;
}

export interface MatchablePlace extends Coord {
  id: number;
  /** Per-place, because a home with street parking needs a wider net than an office. */
  matchRadiusM: number;
}

export type Confidence = 'high' | 'low' | 'none';

export interface MatchResult {
  placeId: number | null;
  confidence: Confidence;
  /** Metres to the winning place; null when nothing was in range. */
  distanceM: number | null;
  /** Metres to the next-nearest candidate — why the result is 'low' when it is. */
  runnerUpDistanceM: number | null;
}

/**
 * A runner-up this close makes the winner a coin toss rather than a match.
 * Ratio, not a fixed margin: at 20 m apart two places are genuinely ambiguous,
 * at 400 m apart the same 10 m gap is noise.
 */
export const RUNNER_UP_RATIO = 1.5;

const EARTH_RADIUS_M = 6_371_000;

const toRadians = (deg: number): number => (deg * Math.PI) / 180;

/**
 * Great-circle distance in metres.
 *
 * Haversine rather than equirectangular: the error of the cheap approximation
 * grows with distance and latitude, and this decides whether a place is inside
 * a 100 m radius. Being wrong here silently mislabels a trip.
 */
export function haversineMeters(a: Coord, b: Coord): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Nearest place whose own radius contains the fix.
 *
 * The radius test is INCLUSIVE: a fix exactly on the boundary matches. A place
 * radius is a stated intent ("anywhere within 100 m of here is my office"), not
 * a measurement, so excluding the boundary would be arbitrary.
 *
 * Radius never grows on its own — widening is always a human act (#11). An
 * auto-widening radius is a ratchet: each near-miss makes the circle bigger,
 * and eventually it swallows the neighbour.
 */
export function matchPlace(fix: Coord, places: readonly MatchablePlace[]): MatchResult {
  const candidates = places
    .map((p) => ({ place: p, distanceM: haversineMeters(fix, p) }))
    .filter((c) => c.distanceM <= c.place.matchRadiusM)
    .sort((a, b) => a.distanceM - b.distanceM);

  const [winner, runnerUp] = candidates;
  if (winner === undefined) {
    return { placeId: null, confidence: 'none', distanceM: null, runnerUpDistanceM: null };
  }

  const ambiguous = runnerUp !== undefined && runnerUp.distanceM <= winner.distanceM * RUNNER_UP_RATIO;

  return {
    placeId: winner.place.id,
    confidence: ambiguous ? 'low' : 'high',
    distanceM: winner.distanceM,
    runnerUpDistanceM: runnerUp?.distanceM ?? null,
  };
}

/* ------------------------------------------------------------ fix selection */

export interface TimedFix extends Coord {
  /** event_at where the API gave one, observed_at where it did not (#3). */
  at: Date;
}

export interface SelectedFix {
  fix: TimedFix;
  /** Minutes between the trip endpoint and the fix. Always >= 0. */
  deltaMinutes: number;
}

const MS_PER_MINUTE = 60_000;

/**
 * The first fix at or after a trip ended, within tolerance.
 *
 * Position is push-on-event, not sampled on an interval (#3) — the car reports
 * on engine stop, so the first fix after a trip ends usually IS the arrival.
 * "Usually" is why the delta is returned rather than discarded: a fix two hours
 * later is evidence about a later door-open, not about where the trip ended.
 *
 * Sorts defensively. The API demonstrably returns trip history unordered
 * (#15 probe), so assuming sorted input is a habit worth not having.
 */
export function selectArrivalFix(
  endedAt: Date,
  fixes: readonly TimedFix[],
  toleranceMinutes: number,
): SelectedFix | null {
  const end = endedAt.getTime();
  const limit = end + toleranceMinutes * MS_PER_MINUTE;

  let best: TimedFix | null = null;
  for (const fix of fixes) {
    const t = fix.at.getTime();
    if (t < end || t > limit) continue;
    if (best === null || t < best.at.getTime()) best = fix;
  }

  if (best === null) return null;
  return { fix: best, deltaMinutes: Math.round((best.at.getTime() - end) / MS_PER_MINUTE) };
}

/**
 * The last fix at or before a trip started, within tolerance — the mirror of
 * selectArrivalFix, used only when the origin cannot be chained from the
 * previous trip's destination.
 */
export function selectDepartureFix(
  startedAt: Date,
  fixes: readonly TimedFix[],
  toleranceMinutes: number,
): SelectedFix | null {
  const start = startedAt.getTime();
  const floor = start - toleranceMinutes * MS_PER_MINUTE;

  let best: TimedFix | null = null;
  for (const fix of fixes) {
    const t = fix.at.getTime();
    if (t > start || t < floor) continue;
    if (best === null || t > best.at.getTime()) best = fix;
  }

  if (best === null) return null;
  return { fix: best, deltaMinutes: Math.round((start - best.at.getTime()) / MS_PER_MINUTE) };
}

/* ------------------------------------------------------------ origin chain */

/**
 * Whether the car demonstrably did not move between two trips, so this trip
 * began where the previous one ended.
 *
 * Judged on the odometer readings BRACKETING the gap, not on readings inside
 * it: readings are written on change only, so a quiet gap may contain none at
 * all, and "no rows" would otherwise be indistinguishable from "no evidence".
 *
 * Absent evidence returns false. The chain must be PROVEN, never assumed — an
 * unproven chain propagates one wrong origin into every trip after it, and the
 * whole point of chaining is that it is more trustworthy than geometry.
 *
 * The tolerance is whole kilometres because that is the granularity the API
 * reports distance in (#15 probe).
 */
export function chainIsContinuous(
  mileageBeforeGapKm: number | null,
  mileageAfterGapKm: number | null,
  toleranceKm = 1,
): boolean {
  if (mileageBeforeGapKm === null || mileageAfterGapKm === null) return false;
  return Math.abs(mileageAfterGapKm - mileageBeforeGapKm) <= toleranceKm;
}
