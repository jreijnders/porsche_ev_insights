/**
 * The database half of place matching. All decisions live in plan.ts; this
 * loads the inputs and writes the outcome.
 *
 * Config follows the merge rule's idiom (DEFAULT_MERGE_CONFIG): a constant that
 * callers may override, rather than a settings-table read. The `setting` table
 * exists but nothing uses it yet, and inventing that machinery here would be a
 * second decision smuggled into this one.
 */

import { and, asc, eq, isNull, sql } from 'drizzle-orm';

import { odometerReading, place, sample, trip } from '../../db/schema.js';
import { db } from '../db/client.js';

import { haversineMeters, selectArrivalFix, type MatchablePlace, type TimedFix } from './match.js';
import { planRematch, type OdometerPoint, type RematchPlan, type TripForMatch } from './plan.js';

export interface MatchConfig {
  /**
   * How long after a trip ends a position fix may still count as its arrival.
   * 60 minutes because position is push-on-event (#3): the engine-stop event
   * usually lands immediately, but a car parked in a garage with poor signal
   * may not report until the next door-open.
   */
  toleranceMinutes: number;
  /** Odometer slack when proving an origin chain. Whole km — the API's own granularity. */
  chainToleranceKm: number;
}

export const DEFAULT_MATCH_CONFIG: MatchConfig = {
  toleranceMinutes: 60,
  chainToleranceKm: 1,
};

export interface RematchSummary {
  tripsConsidered: number;
  placed: number;
  ambiguous: number;
  unmatched: number;
  chained: number;
  /** Trips given a purpose they did not have. Never a reclassification. */
  purposeSuggested: number;
  preTracking: number;
  skippedChecked: number;
}

async function loadPlaces(): Promise<MatchablePlace[]> {
  const rows = await db
    .select({ id: place.id, lat: place.lat, lon: place.lon, matchRadiusM: place.matchRadiusM, kind: place.kind })
    .from(place);
  return rows.map((r) => ({
    id: r.id,
    lat: Number(r.lat),
    lon: Number(r.lon),
    matchRadiusM: r.matchRadiusM,
    kind: r.kind,
  }));
}

async function loadFixes(vin: string): Promise<TimedFix[]> {
  const rows = await db
    .select({
      eventAt: sample.eventAt,
      observedAt: sample.observedAt,
      lat: sample.lat,
      lon: sample.lon,
    })
    .from(sample)
    .where(eq(sample.vin, vin));

  // event_at is when the car says the event happened; observed_at is when we
  // polled. The first is right whenever it exists (#3).
  return rows.map((r) => ({
    at: r.eventAt ?? r.observedAt,
    lat: Number(r.lat),
    lon: Number(r.lon),
  }));
}

async function loadOdometer(vin: string): Promise<OdometerPoint[]> {
  const rows = await db
    .select({
      eventAt: odometerReading.eventAt,
      observedAt: odometerReading.observedAt,
      mileageKm: odometerReading.mileageKm,
    })
    .from(odometerReading)
    .where(eq(odometerReading.vin, vin));

  return rows.map((r) => ({ at: r.eventAt ?? r.observedAt, mileageKm: Number(r.mileageKm) }));
}

async function loadTrips(vin: string): Promise<TripForMatch[]> {
  // Checked trips are loaded too: they are never written, but they are the best
  // possible chain ancestors, so leaving them out would break chains across
  // exactly the rows a human already confirmed.
  const rows = await db
    .select({
      id: trip.id,
      startedAt: trip.startedAt,
      endedAt: trip.endedAt,
      checkedAt: trip.checkedAt,
      startPlaceId: trip.startPlaceId,
      endPlaceId: trip.endPlaceId,
      endPlaceConfidence: trip.endPlaceConfidence,
      purpose: trip.purpose,
    })
    .from(trip)
    .where(eq(trip.vin, vin))
    .orderBy(asc(trip.startedAt));

  return rows;
}

/**
 * Re-runs matching over every unchecked trip for a vehicle.
 *
 * Re-runnable by design (#11): a place created today should retroactively name
 * yesterday's unchecked trips, so this is called after ingest, after any place
 * changes, and on demand.
 */
export async function rematchVehicle(
  vin: string,
  config: MatchConfig = DEFAULT_MATCH_CONFIG,
): Promise<RematchSummary> {
  const [places, fixes, odometer, trips] = await Promise.all([
    loadPlaces(),
    loadFixes(vin),
    loadOdometer(vin),
    loadTrips(vin),
  ]);

  const plan = planRematch({
    trips,
    places,
    fixes,
    odometer,
    toleranceMinutes: config.toleranceMinutes,
    chainToleranceKm: config.chainToleranceKm,
  });

  await applyPlan(plan);
  return summarise(plan);
}

async function applyPlan(plan: RematchPlan): Promise<void> {
  if (plan.updates.length === 0) return;

  await db.transaction(async (tx) => {
    for (const u of plan.updates) {
      await tx
        .update(trip)
        .set({
          startPlaceId: u.startPlaceId,
          startPlaceConfidence: u.startPlaceConfidence,
          endPlaceId: u.endPlaceId,
          endPlaceConfidence: u.endPlaceConfidence,
          endFixDeltaMinutes: u.endFixDeltaMinutes,
          // Only ever written when it is null, so a hand classification cannot
          // be undone by a re-run. Spread so the column is untouched otherwise.
          ...(u.suggestedPurpose === null ? {} : { purpose: u.suggestedPurpose }),
          updatedAt: new Date(),
        })
        // Belt and braces. plan.ts already refuses to emit updates for checked
        // trips and is tested on it; this makes the guarantee true even if a row
        // is checked between planning and writing. The `purpose is null` clause
        // does the same for the suggestion: if a classification lands between
        // planning and writing, the write must lose.
        .where(
          and(
            eq(trip.id, u.tripId),
            isNull(trip.checkedAt),
            u.suggestedPurpose === null ? undefined : isNull(trip.purpose),
          ),
        );
    }
  });
}

function summarise(plan: RematchPlan): RematchSummary {
  const placed = plan.updates.filter((u) => u.endPlaceId !== null);
  return {
    tripsConsidered: plan.updates.length,
    placed: placed.length,
    ambiguous: plan.updates.filter((u) => u.endPlaceConfidence === 'low').length,
    unmatched: plan.updates.filter((u) => u.endPlaceConfidence === 'none').length,
    chained: plan.updates.filter((u) => u.originSource === 'chained').length,
    purposeSuggested: plan.updates.filter((u) => u.suggestedPurpose !== null).length,
    preTracking: plan.preTrackingTripIds.length,
    skippedChecked: plan.skippedCheckedTripIds.length,
  };
}

/**
 * The instant position tracking began for a vehicle, or null if it has not.
 * The ledger renders trips older than this as "before position tracking"
 * rather than as failed matches — derived, never stored (#11).
 */
export async function firstFixAt(vin: string): Promise<Date | null> {
  // Ordered-limit-1 over TYPED columns rather than a raw min(): an aggregate
  // inside sql`` has no column behind it, so Drizzle cannot map the result and
  // postgres.js hands back "2026-08-21 11:50:39+00" — a string in Postgres
  // format, not ISO. Serialised into the month payload it then loses to a
  // lexicographic comparison against ISO timestamps for any trip on the same
  // day tracking began, which is precisely the boundary this value exists to
  // draw. Typed columns come back as Date and serialise as ISO.
  const [row] = await db
    .select({ eventAt: sample.eventAt, observedAt: sample.observedAt })
    .from(sample)
    .where(eq(sample.vin, vin))
    .orderBy(asc(sql`coalesce(${sample.eventAt}, ${sample.observedAt})`))
    .limit(1);
  return row ? (row.eventAt ?? row.observedAt) : null;
}

/* --------------------------------------------------------------- usage */

export interface PlaceUsage {
  /** Trips naming this place at either end. */
  trips: number;
  /** How many of those a human has checked — these block deletion. */
  checkedTrips: number;
  /**
   * How far the matched arrival fixes actually landed from the place, in
   * metres. This is the radius measured against reality: a place with a 150 m
   * radius whose farthest real match is 12 m is far wider than it needs to be,
   * and one whose farthest match is 148 m is one bad park from missing.
   */
  nearestMatchM: number | null;
  farthestMatchM: number | null;
}

export async function placeUsage(
  vin: string,
  config: MatchConfig = DEFAULT_MATCH_CONFIG,
): Promise<Map<number, PlaceUsage>> {
  const [places, fixes, trips] = await Promise.all([
    loadPlaces(),
    loadFixes(vin),
    db
      .select({
        endedAt: trip.endedAt,
        checkedAt: trip.checkedAt,
        startPlaceId: trip.startPlaceId,
        endPlaceId: trip.endPlaceId,
      })
      .from(trip)
      .where(eq(trip.vin, vin)),
  ]);

  const byId = new Map(places.map((p) => [p.id, p]));
  const usage = new Map<number, PlaceUsage>(
    places.map((p) => [p.id, { trips: 0, checkedTrips: 0, nearestMatchM: null, farthestMatchM: null }]),
  );

  for (const row of trips) {
    const referenced = new Set([row.startPlaceId, row.endPlaceId].filter((id): id is number => id !== null));
    for (const id of referenced) {
      const entry = usage.get(id);
      if (!entry) continue;
      entry.trips += 1;
      if (row.checkedAt !== null) entry.checkedTrips += 1;
    }

    // Distance is only meaningful for the END, which is the endpoint geometry
    // actually chose; an origin is usually chained rather than measured.
    if (row.endPlaceId === null) continue;
    const place = byId.get(row.endPlaceId);
    const entry = usage.get(row.endPlaceId);
    if (!place || !entry) continue;

    const arrival = selectArrivalFix(row.endedAt, fixes, config.toleranceMinutes);
    if (!arrival) continue;

    const distance = Math.round(haversineMeters(arrival.fix, place));
    entry.nearestMatchM = entry.nearestMatchM === null ? distance : Math.min(entry.nearestMatchM, distance);
    entry.farthestMatchM = entry.farthestMatchM === null ? distance : Math.max(entry.farthestMatchM, distance);
  }

  return usage;
}
