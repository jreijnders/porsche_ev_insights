/**
 * Turns a place book plus a pile of position fixes into a set of trip updates.
 *
 * Pure, and separate from service.ts, for one reason above all: the rule that a
 * CHECKED trip is never modified is the load-bearing guarantee of the whole
 * ledger — a human verified that row, and no automatic process may quietly
 * disagree. A rule that important should be provable without standing up a
 * database, so the decision of what to write lives here and the writing lives
 * next door.
 */

import {
  chainIsContinuous,
  matchPlace,
  selectArrivalFix,
  selectDepartureFix,
  type Confidence,
  type MatchablePlace,
  type TimedFix,
} from './match.js';

export interface TripForMatch {
  id: number;
  startedAt: Date;
  endedAt: Date;
  /** Null when unchecked. Any non-null value makes the row untouchable. */
  checkedAt: Date | null;
  startPlaceId: number | null;
  endPlaceId: number | null;
  endPlaceConfidence: Confidence | null;
}

export interface OdometerPoint {
  at: Date;
  mileageKm: number;
}

export interface PlanInput {
  /** Every trip for the vehicle, in any order. Checked ones included — they are
   *  needed as chain ancestors even though they are never written. */
  trips: readonly TripForMatch[];
  places: readonly MatchablePlace[];
  fixes: readonly TimedFix[];
  odometer: readonly OdometerPoint[];
  toleranceMinutes: number;
  chainToleranceKm?: number;
}

export type OriginSource = 'chained' | 'geometry' | 'none';

export interface TripPlacement {
  tripId: number;
  startPlaceId: number | null;
  startPlaceConfidence: Confidence;
  endPlaceId: number | null;
  endPlaceConfidence: Confidence;
  endFixDeltaMinutes: number | null;
  originSource: OriginSource;
}

export interface RematchPlan {
  updates: TripPlacement[];
  /** Trips that ended before any position was ever recorded (#11). Not failures. */
  preTrackingTripIds: number[];
  /** Trips left alone because a human checked them. */
  skippedCheckedTripIds: number[];
}

/**
 * Odometer reading immediately at or before an instant, and at or after it.
 * Used to bracket the gap between two trips — see chainIsContinuous for why
 * bracketing beats looking inside the gap.
 */
function bracket(odometer: readonly OdometerPoint[], at: Date): { before: number | null; after: number | null } {
  let before: OdometerPoint | null = null;
  let after: OdometerPoint | null = null;
  for (const point of odometer) {
    const t = point.at.getTime();
    if (t <= at.getTime() && (before === null || t > before.at.getTime())) before = point;
    if (t >= at.getTime() && (after === null || t < after.at.getTime())) after = point;
  }
  return { before: before?.mileageKm ?? null, after: after?.mileageKm ?? null };
}

export function planRematch(input: PlanInput): RematchPlan {
  const { places, fixes, odometer, toleranceMinutes, chainToleranceKm = 1 } = input;

  // Sorted, never assumed sorted — the same discipline the trip history forced
  // on us (#15). Chaining reads the previous trip, so order is correctness here.
  const trips = [...input.trips].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());

  const updates: TripPlacement[] = [];
  const preTrackingTripIds: number[] = [];
  const skippedCheckedTripIds: number[] = [];

  // The boundary below which the place book simply cannot help: no position was
  // being collected yet. Reporting these as failed matches would be a lie about
  // the data rather than about the algorithm.
  const earliestFixAt = fixes.reduce<number | null>(
    (min, f) => (min === null || f.at.getTime() < min ? f.at.getTime() : min),
    null,
  );

  /** Destination of the previous trip as this run understands it — freshly
   *  planned where we planned one, stored otherwise. Chaining off a stale value
   *  would propagate a destination we just decided was wrong. */
  let previous: { trip: TripForMatch; endPlaceId: number | null; endConfidence: Confidence | null } | null = null;

  for (const trip of trips) {
    // Pre-tracking means the trip's ENTIRE arrival window closed before the
    // first fix was ever recorded — not merely that the trip ended before it.
    //
    // The naive test (endedAt < earliestFix) is wrong in a way that hides: the
    // first trip after tracking begins is usually the trip whose own arrival
    // fix IS the earliest fix, so it would be branded "before position
    // tracking" and never matched again, permanently and silently.
    const arrivalWindowCloses = trip.endedAt.getTime() + toleranceMinutes * 60_000;
    const isPreTracking = earliestFixAt === null || arrivalWindowCloses < earliestFixAt;

    if (trip.checkedAt !== null) {
      skippedCheckedTripIds.push(trip.id);
      // Still a valid chain ancestor: a human confirmed where it ended, which
      // makes it the BEST possible ancestor, not one to skip over.
      previous = { trip, endPlaceId: trip.endPlaceId, endConfidence: trip.endPlaceConfidence };
      continue;
    }

    if (isPreTracking) {
      preTrackingTripIds.push(trip.id);
      previous = { trip, endPlaceId: trip.endPlaceId, endConfidence: trip.endPlaceConfidence };
      continue;
    }

    // ---- destination: geometry against the first fix after arrival ----------
    const arrival = selectArrivalFix(trip.endedAt, fixes, toleranceMinutes);
    const endMatch = arrival
      ? matchPlace(arrival.fix, places)
      : { placeId: null, confidence: 'none' as Confidence, distanceM: null, runnerUpDistanceM: null };

    // ---- origin: chain first, geometry second, nothing third ---------------
    let startPlaceId: number | null = null;
    let startConfidence: Confidence = 'none';
    let originSource: OriginSource = 'none';

    if (previous !== null && previous.endPlaceId !== null) {
      const before = bracket(odometer, previous.trip.endedAt).before;
      const after = bracket(odometer, trip.startedAt).after;
      if (chainIsContinuous(before, after, chainToleranceKm)) {
        startPlaceId = previous.endPlaceId;
        // Inherit, never upgrade: an origin is at most as trustworthy as the
        // destination it was copied from.
        startConfidence = previous.endConfidence ?? 'low';
        originSource = 'chained';
      }
    }

    if (originSource === 'none') {
      const departure = selectDepartureFix(trip.startedAt, fixes, toleranceMinutes);
      if (departure) {
        const startMatch = matchPlace(departure.fix, places);
        startPlaceId = startMatch.placeId;
        startConfidence = startMatch.confidence;
        if (startMatch.placeId !== null) originSource = 'geometry';
      }
    }

    updates.push({
      tripId: trip.id,
      startPlaceId,
      startPlaceConfidence: startConfidence,
      endPlaceId: endMatch.placeId,
      endPlaceConfidence: endMatch.confidence,
      endFixDeltaMinutes: arrival?.deltaMinutes ?? null,
      originSource,
    });

    previous = { trip, endPlaceId: endMatch.placeId, endConfidence: endMatch.confidence };
  }

  return { updates, preTrackingTripIds, skippedCheckedTripIds };
}
