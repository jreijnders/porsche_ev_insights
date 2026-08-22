/**
 * The journey-merge rule, implementing the decision in #8.
 *
 * Pure on purpose: this is the arithmetic a mileage claim rests on, and #9 put
 * it in the mandatory-test set. No database, no clock except the `now` passed in.
 */

import type { ParsedSegment } from './parse.js';

export interface MergeConfig {
  /** Stops shorter than this merge into one journey. Default 15 min (#8). */
  gapThresholdMinutes: number;
  /** Segments below this are dropped (driveway shunting). Default 0.5 km. */
  minDistanceKm: number;
  /** A journey stays provisional until this long after its last segment. */
  provisionalMinutes: number;
}

export const DEFAULT_MERGE_CONFIG: MergeConfig = {
  gapThresholdMinutes: 15,
  minDistanceKm: 0.5,
  provisionalMinutes: 15,
};

export interface Journey {
  /** Stable identity: derived from the FIRST segment, so absorbing a later
   *  segment extends the journey rather than creating a second one. */
  fingerprint: string;
  startedAt: Date;
  endedAt: Date;
  /** Always true: the API provides no trip start time (#15 probe). */
  startedAtDerived: boolean;
  distanceKm: number;
  drivingMinutes: number | null;
  avgConsumptionKwh100km: number | null;
  avgSpeedKmh: number | null;
  status: 'provisional' | 'closed';
  segmentCount: number;
  /** True when a merge decision fell within a minute of the threshold, so the
   *  UI can mark the row as less trustworthy rather than implying precision. */
  suspect: boolean;
}

/**
 * The API gives only `tripEndTime` and `drivingTimeMinutes`, so a start is
 * derived. Two known imprecisions, both accepted in #8:
 *  - whole minutes, so ±60s at best;
 *  - if drivingTimeMinutes excludes standstill, the derived start lands late,
 *    biasing gaps upward and the rule toward over-splitting. Over-splitting is
 *    the safe direction: a wrongly split journey is repaired by manual merge,
 *    a wrongly merged one loses a destination.
 */
export function derivedStart(segment: ParsedSegment): Date {
  const minutes = segment.drivingMinutes ?? 0;
  return new Date(segment.apiEndAt.getTime() - minutes * 60_000);
}

export function fingerprintOf(segment: ParsedSegment): string {
  return `${segment.apiEndAt.toISOString()}|${segment.distanceKm}`;
}

/** Distance-weighted mean, ignoring segments with no value. Null if none. */
function weighted(
  parts: Array<{ distanceKm: number; value: number | null }>,
): number | null {
  let weight = 0;
  let total = 0;
  for (const part of parts) {
    if (part.value === null) continue;
    // A zero-distance segment still carries information; weight it minimally
    // rather than dropping it, so a short leg does not vanish from the mean.
    const w = part.distanceKm > 0 ? part.distanceKm : 0;
    weight += w;
    total += part.value * w;
  }
  if (weight === 0) return null;
  return Math.round((total / weight) * 10) / 10;
}

export interface MergeResult {
  journeys: Journey[];
  /** Segments dropped for being below the floor, and their total distance —
   *  which still counts toward odometer reconciliation (#8, #12). */
  droppedCount: number;
  droppedDistanceKm: number;
}

/**
 * Groups segments into journeys.
 *
 * `segments` must be for one vehicle. Order does not matter — they are sorted.
 */
export function mergeSegments(
  segments: ParsedSegment[],
  now: Date,
  config: MergeConfig = DEFAULT_MERGE_CONFIG,
): MergeResult {
  const kept: ParsedSegment[] = [];
  let droppedCount = 0;
  let droppedDistanceKm = 0;

  for (const s of segments) {
    if (s.distanceKm < config.minDistanceKm) {
      droppedCount += 1;
      droppedDistanceKm += s.distanceKm;
      continue;
    }
    kept.push(s);
  }

  kept.sort((a, b) => a.apiEndAt.getTime() - b.apiEndAt.getTime());

  const groups: ParsedSegment[][] = [];
  let current: ParsedSegment[] = [];
  const nearThreshold: boolean[] = [];
  let groupSuspect = false;

  const thresholdMs = config.gapThresholdMinutes * 60_000;

  for (const segment of kept) {
    if (current.length === 0) {
      current = [segment];
      groupSuspect = false;
      continue;
    }
    const previous = current[current.length - 1]!;
    const gapMs = derivedStart(segment).getTime() - previous.apiEndAt.getTime();

    // A negative gap means the derived start precedes the previous end — the
    // derivation is imprecise enough for that to happen. Treat as contiguous.
    const merges = gapMs < thresholdMs;
    if (Math.abs(gapMs - thresholdMs) <= 60_000) groupSuspect = true;

    if (merges) {
      current.push(segment);
    } else {
      groups.push(current);
      nearThreshold.push(groupSuspect);
      current = [segment];
      groupSuspect = false;
    }
  }
  if (current.length > 0) {
    groups.push(current);
    nearThreshold.push(groupSuspect);
  }

  const provisionalCutoffMs = config.provisionalMinutes * 60_000;

  const journeys = groups.map((group, index): Journey => {
    const first = group[0]!;
    const last = group[group.length - 1]!;
    const distanceKm = group.reduce((sum, s) => sum + s.distanceKm, 0);
    const drivingParts = group.map((s) => s.drivingMinutes).filter((m): m is number => m !== null);
    const drivingMinutes = drivingParts.length > 0
      ? drivingParts.reduce((a, b) => a + b, 0)
      : null;

    // Speed as total distance over total driving time — the distance-weighted
    // answer, and physically what "average speed" means. Averaging the
    // per-segment averages would be wrong whenever segments differ in length.
    let avgSpeedKmh: number | null = null;
    if (drivingMinutes !== null && drivingMinutes > 0) {
      avgSpeedKmh = Math.round((distanceKm / (drivingMinutes / 60)) * 10) / 10;
    } else {
      avgSpeedKmh = weighted(group.map((s) => ({ distanceKm: s.distanceKm, value: s.avgSpeedKmh })));
    }

    return {
      fingerprint: fingerprintOf(first),
      // Wall-clock: first derived start to last reported end (#8).
      startedAt: derivedStart(first),
      endedAt: last.apiEndAt,
      startedAtDerived: true,
      distanceKm,
      drivingMinutes,
      avgConsumptionKwh100km: weighted(
        group.map((s) => ({ distanceKm: s.distanceKm, value: s.avgConsumptionKwh100km })),
      ),
      avgSpeedKmh,
      status:
        now.getTime() - last.apiEndAt.getTime() > provisionalCutoffMs ? 'closed' : 'provisional',
      segmentCount: group.length,
      suspect: nearThreshold[index] ?? false,
    };
  });

  return { journeys, droppedCount, droppedDistanceKm };
}

/** Calendar month a journey belongs to: the month of its START (#8). */
export function monthKeyOf(journey: Journey): string {
  const y = journey.startedAt.getUTCFullYear();
  const m = String(journey.startedAt.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}
