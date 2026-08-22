/**
 * Database writes for one poll cycle (#13, #20).
 *
 * The invariant that matters: segments are inserted and the watermark advanced
 * in ONE transaction, with idempotent inserts. So the watermark is an
 * optimisation, not a correctness mechanism — a crash before commit moves
 * nothing, and a crash after makes the re-read a no-op.
 */

import { desc, eq, isNotNull, isNull, lt, sql } from 'drizzle-orm';

import { odometerReading, sample, segment, syncState, trip, vehicle } from '../../db/schema.js';
import { db } from '../db/client.js';
import { DEFAULT_MERGE_CONFIG, mergeSegments, type MergeConfig } from './merge.js';
import {
  parseBatteryPercent,
  parseIsCharging,
  parseOdometer,
  parsePosition,
  parseSegments,
  type MeasurementPayload,
} from './parse.js';

/** Segments are kept this long so the merge threshold can be replayed (#8). */
const SEGMENT_RETENTION_HOURS = 72;

const numeric = (n: number): string => n.toFixed(1);

/**
 * Every ledger table references vehicle.vin, so the vehicle row has to exist
 * before anything else can be written. Registering it from the vehicles list
 * each cycle also keeps the label current if it changes upstream.
 */
export async function upsertVehicle(
  vin: string,
  label: string | null,
  modelId: string | null,
): Promise<void> {
  await db
    .insert(vehicle)
    .values({ vin, label: label ?? vin, modelId })
    .onConflictDoUpdate({
      target: vehicle.vin,
      set: { label: label ?? vin, modelId },
    });
}

export interface HarvestWrites {
  samplesWritten: number;
  odometerWritten: number;
  odometerMoved: boolean;
}

/**
 * Writes the position and odometer from one measurement payload.
 *
 * Samples are deduplicated on GPS_LOCATION.lastModified, because position is
 * pushed on discrete events: 96 polls a day yield only a handful of distinct
 * fixes (#3, confirmed by the #15 probe where position was 28h stale while
 * every other measurement was minutes old).
 */
export async function writeObservations(
  vin: string,
  payload: MeasurementPayload,
): Promise<HarvestWrites> {
  const position = parsePosition(payload);
  const odometer = parseOdometer(payload);
  let samplesWritten = 0;
  let odometerWritten = 0;
  let odometerMoved = false;

  if (position) {
    const inserted = await db
      .insert(sample)
      .values({
        vin,
        eventAt: position.eventAt,
        eventAtEstimated: position.eventAt === null,
        lat: position.lat.toFixed(6),
        lon: position.lon.toFixed(6),
        direction: position.direction,
        mileageKm: odometer ? numeric(odometer.kilometers) : null,
        batteryPct: parseBatteryPercent(payload),
        charging: parseIsCharging(payload),
      })
      .onConflictDoNothing()
      .returning({ id: sample.id });
    samplesWritten = inserted.length;
  }

  if (odometer) {
    const [latest] = await db
      .select({ mileageKm: odometerReading.mileageKm })
      .from(odometerReading)
      .where(eq(odometerReading.vin, vin))
      .orderBy(desc(odometerReading.observedAt))
      .limit(1);

    // On change only — the odometer is whole kilometres (#15 probe), so a
    // sub-kilometre move produces no row and no reconciliation signal.
    if (!latest || Number(latest.mileageKm) !== odometer.kilometers) {
      await db
        .insert(odometerReading)
        .values({
          vin,
          eventAt: odometer.eventAt,
          mileageKm: numeric(odometer.kilometers),
        })
        .onConflictDoNothing();
      odometerWritten = 1;
      odometerMoved = latest !== undefined;
    }
  }

  return { samplesWritten, odometerWritten, odometerMoved };
}

/**
 * True when this vehicle has never had a trip ingest.
 *
 * Without this, a fresh install would never read trip history: odometer
 * movement is what normally arms the sticky counter, and the first reading has
 * nothing to compare against — so the ledger would stay empty until the next
 * drive. The initial sync must pull whatever history the API still holds.
 */
export async function needsInitialTripSync(vin: string): Promise<boolean> {
  const [row] = await db
    .select({ watermark: syncState.tripWatermark })
    .from(syncState)
    .where(eq(syncState.vin, vin))
    .limit(1);
  return !row || row.watermark === null;
}

export interface IngestResult {
  segmentsInserted: number;
  tripsUpserted: number;
  segmentsDropped: number;
  droppedDistanceKm: number;
}

/**
 * Ingests trip history: new segments, then journeys, then the watermark — all
 * in one transaction.
 */
export async function ingestTrips(
  vin: string,
  payload: MeasurementPayload,
  now: Date,
  config: MergeConfig = DEFAULT_MERGE_CONFIG,
): Promise<IngestResult> {
  const parsed = parseSegments(payload);
  if (parsed.length === 0) {
    return { segmentsInserted: 0, tripsUpserted: 0, segmentsDropped: 0, droppedDistanceKm: 0 };
  }

  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(segment)
      .values(
        parsed.map((s) => ({
          vin,
          apiEndAt: s.apiEndAt,
          drivingMinutes: s.drivingMinutes,
          distanceKm: numeric(s.distanceKm),
          avgConsumptionKwh100km: s.avgConsumptionKwh100km === null ? null : numeric(s.avgConsumptionKwh100km),
          avgSpeedKmh: s.avgSpeedKmh === null ? null : numeric(s.avgSpeedKmh),
          raw: s.raw,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: segment.id });

    // Merge over EVERY segment currently held, not just what was inserted: a
    // new segment can extend a journey whose earlier legs arrived in a prior
    // cycle.
    //
    // Deliberately NOT limited to the 72h retention window. That window exists
    // so the merge threshold can be replayed over recent driving — it is not a
    // bound on what becomes a trip. Limiting the merge to it meant an initial
    // sync inserted a month of segments, turned only the last 72h into trips,
    // and then pruned the rest: silent loss of all older history.
    const window = await tx
      .select()
      .from(segment)
      .where(eq(segment.vin, vin))
      .orderBy(segment.apiEndAt);

    const { journeys, droppedCount, droppedDistanceKm } = mergeSegments(
      window.map((row) => ({
        apiEndAt: row.apiEndAt,
        distanceKm: Number(row.distanceKm),
        drivingMinutes: row.drivingMinutes,
        avgConsumptionKwh100km: row.avgConsumptionKwh100km === null ? null : Number(row.avgConsumptionKwh100km),
        avgSpeedKmh: row.avgSpeedKmh === null ? null : Number(row.avgSpeedKmh),
        raw: {},
      })),
      now,
      config,
    );

    for (const journey of journeys) {
      await tx
        .insert(trip)
        .values({
          vin,
          startedAt: journey.startedAt,
          endedAt: journey.endedAt,
          startedAtDerived: journey.startedAtDerived,
          distanceKm: numeric(journey.distanceKm),
          drivingMinutes: journey.drivingMinutes,
          avgConsumptionKwh100km: journey.avgConsumptionKwh100km === null ? null : numeric(journey.avgConsumptionKwh100km),
          avgSpeedKmh: journey.avgSpeedKmh === null ? null : numeric(journey.avgSpeedKmh),
          status: journey.status,
          source: 'api',
          apiFingerprint: journey.fingerprint,
        })
        .onConflictDoUpdate({
          target: [trip.vin, trip.apiFingerprint],
          // The unique index is PARTIAL (where api_fingerprint is not null), and
          // Postgres cannot infer a partial index unless the conflict target
          // repeats its predicate. Without this: "no unique or exclusion
          // constraint matching the ON CONFLICT specification".
          targetWhere: isNotNull(trip.apiFingerprint),
          // Only derived fields. Never purpose, invoice_monthly, checked_at,
          // places or note — those are the user's.
          set: {
            startedAt: journey.startedAt,
            endedAt: journey.endedAt,
            distanceKm: numeric(journey.distanceKm),
            drivingMinutes: journey.drivingMinutes,
            avgConsumptionKwh100km: journey.avgConsumptionKwh100km === null ? null : numeric(journey.avgConsumptionKwh100km),
            avgSpeedKmh: journey.avgSpeedKmh === null ? null : numeric(journey.avgSpeedKmh),
            status: journey.status,
            updatedAt: new Date(),
          },
          // A checked row is one you have verified: the poller leaves it alone.
          setWhere: isNull(trip.checkedAt),
        });
    }

    const newest = parsed[parsed.length - 1]!.apiEndAt;
    await tx
      .insert(syncState)
      .values({ vin, tripWatermark: newest, lastPollAt: now, lastPollOk: true })
      .onConflictDoUpdate({
        target: syncState.vin,
        set: { tripWatermark: newest, updatedAt: new Date() },
      });

    return {
      segmentsInserted: inserted.length,
      tripsUpserted: journeys.length,
      segmentsDropped: droppedCount,
      droppedDistanceKm,
    };
  });
}

export async function recordPoll(
  vin: string,
  ok: boolean,
  health: 'healthy' | 'degraded' | 'broken',
  detail: string | null,
  now: Date,
): Promise<void> {
  await db
    .insert(syncState)
    .values({
      vin,
      lastPollAt: now,
      lastPollOk: ok,
      health,
      healthDetail: detail,
      consecutiveFailures: ok ? 0 : 1,
    })
    .onConflictDoUpdate({
      target: syncState.vin,
      set: {
        lastPollAt: now,
        lastPollOk: ok,
        health,
        healthDetail: detail,
        consecutiveFailures: ok ? 0 : sql`${syncState.consecutiveFailures} + 1`,
        updatedAt: new Date(),
      },
    });
}

/** Discards segments past the retention window (#8: 72h re-merge tail). */
export async function pruneSegments(now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - SEGMENT_RETENTION_HOURS * 3_600_000);
  const deleted = await db
    .delete(segment)
    .where(lt(segment.apiEndAt, cutoff))
    .returning({ id: segment.id });
  return deleted.length;
}
