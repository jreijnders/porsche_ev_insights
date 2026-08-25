/**
 * Database half of odometer reconciliation. The arithmetic lives in window.ts.
 *
 * Computed on demand, never stored (#12). A stored reconciliation would be a
 * second copy of a fact the trips and readings already determine, and it would
 * go stale the moment a manual trip closes a gap — which is exactly the moment
 * the number has to move.
 */

import { and, asc, desc, eq, gt, lte, sql } from 'drizzle-orm';

import { odometerReading, trip } from '../../db/schema.js';
import { db } from '../db/client.js';

import {
  buildWindows,
  reconcileMonth,
  type MonthReconciliation,
  type Reading,
  type TripSpan,
} from './window.js';

/** Readings carry event_at where the API gave one, observed_at otherwise. */
async function loadReadings(vin: string): Promise<Reading[]> {
  const rows = await db
    .select({
      eventAt: odometerReading.eventAt,
      observedAt: odometerReading.observedAt,
      mileageKm: odometerReading.mileageKm,
    })
    .from(odometerReading)
    .where(eq(odometerReading.vin, vin))
    .orderBy(asc(odometerReading.observedAt));

  return rows.map((r) => ({ at: r.eventAt ?? r.observedAt, mileageKm: Number(r.mileageKm) }));
}

async function loadTripSpans(vin: string): Promise<TripSpan[]> {
  const rows = await db
    .select({ id: trip.id, endedAt: trip.endedAt, distanceKm: trip.distanceKm })
    .from(trip)
    .where(eq(trip.vin, vin))
    .orderBy(asc(trip.endedAt));

  return rows.map((r) => ({ id: r.id, endedAt: r.endedAt, distanceKm: Number(r.distanceKm) }));
}

export interface VehicleReconciliation {
  month: MonthReconciliation;
  /** Every window, not only this month's — the month view links into them. */
  readingCount: number;
}

export async function reconcileVehicleMonth(
  vin: string,
  month: string,
): Promise<VehicleReconciliation> {
  const [readings, trips] = await Promise.all([loadReadings(vin), loadTripSpans(vin)]);

  const latestTripEndedAt = trips.reduce<Date | null>(
    (latest, t) => (latest === null || t.endedAt > latest ? t.endedAt : latest),
    null,
  );

  const windows = buildWindows({ readings, trips, latestTripEndedAt });
  const earliest = readings.length > 0 ? readings[0]!.at : null;

  return {
    month: reconcileMonth(month, windows, earliest),
    readingCount: readings.length,
  };
}

export interface AcknowledgeResult {
  tripId: number;
  distanceKm: number;
}

/**
 * Closes a gap by recording the missing driving as an explicit manual trip.
 *
 * A manual trip is the whole mechanism (#12) — no acknowledgement table, no
 * "ignore this window" flag. The kilometres were driven; a ledger that claims
 * to be complete has to contain them, and marking them as acknowledged rather
 * than suppressing the warning keeps that visible.
 *
 * The distance is RECOMPUTED here rather than taken from the request. The
 * browser's figure may be from a screen rendered before another trip landed,
 * and writing a stale number would leave the window still adrift.
 */
export async function acknowledgeGap(
  vin: string,
  fromAt: Date,
  toAt: Date,
  note: string | null,
): Promise<AcknowledgeResult | { error: string }> {
  const [readings, trips] = await Promise.all([loadReadings(vin), loadTripSpans(vin)]);
  const latestTripEndedAt = trips.reduce<Date | null>(
    (latest, t) => (latest === null || t.endedAt > latest ? t.endedAt : latest),
    null,
  );

  const windows = buildWindows({ readings, trips, latestTripEndedAt });
  const target = windows.find(
    (w) => w.fromAt.getTime() === fromAt.getTime() && w.toAt.getTime() === toAt.getTime(),
  );

  if (!target) return { error: 'No reconciliation window with those bounds' };
  if (target.verdict === 'settling') {
    return { error: 'That window is still settling — its trips may not all have arrived yet.' };
  }
  if (target.differenceKm <= 0) {
    return {
      error:
        target.verdict === 'over_logged'
          ? 'That window is over-logged, not short. A manual trip would make it worse — remove the duplicate instead.'
          : 'That window is already inside tolerance; there is nothing to acknowledge.',
    };
  }

  // Placed at the closing reading: the only thing actually known about this
  // driving is that it happened somewhere inside the window.
  const [created] = await db
    .insert(trip)
    .values({
      vin,
      startedAt: target.fromAt,
      endedAt: target.toAt,
      startedAtDerived: true,
      distanceKm: target.differenceKm.toFixed(2),
      status: 'closed',
      source: 'manual',
      apiFingerprint: null,
      note:
        note ??
        `Erkend gat: ${target.differenceKm} km tussen tellerstand ${target.fromKm} en ${target.toKm}. ` +
          'Added by hand to make the mileage log reconcile.',
    })
    .returning({ id: trip.id });

  if (!created) return { error: 'Insert returned no row' };
  return { tripId: created.id, distanceKm: target.differenceKm };
}

/**
 * The odometer reading immediately at or before an instant, and at or after it.
 * Exposed for the origin chain (#11), which asks the same question from the
 * other direction: an unaccounted window and a broken chain are one event.
 */
export async function bracketingMileage(
  vin: string,
  at: Date,
): Promise<{ before: number | null; after: number | null }> {
  const [before] = await db
    .select({ mileageKm: odometerReading.mileageKm })
    .from(odometerReading)
    .where(and(eq(odometerReading.vin, vin), lte(odometerReading.observedAt, at)))
    .orderBy(desc(odometerReading.observedAt))
    .limit(1);

  const [after] = await db
    .select({ mileageKm: odometerReading.mileageKm })
    .from(odometerReading)
    .where(and(eq(odometerReading.vin, vin), gt(odometerReading.observedAt, at)))
    .orderBy(asc(odometerReading.observedAt))
    .limit(1);

  return {
    before: before ? Number(before.mileageKm) : null,
    after: after ? Number(after.mileageKm) : null,
  };
}

/** Count of odometer readings — the ledger says "not reconcilable" below two. */
export async function readingCount(vin: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(odometerReading)
    .where(eq(odometerReading.vin, vin));
  return row?.n ?? 0;
}
