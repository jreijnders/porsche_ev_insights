/**
 * Ledger API for the trip list (#21 prototype).
 *
 * Deliberately small: a month of trips, a summary above them, and the three
 * mutations the keyboard flow needs. No client session — LAN/VPN only (#16).
 */

import { and, asc, desc, eq, gte, lt, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

import { odometerReading, place, trip } from '../../db/schema.js';
import { db } from '../db/client.js';

/** Month boundaries in UTC. Attribution is by trip START (#8). */
function monthRange(month: string): { from: Date; to: Date } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return null;
  const year = Number(match[1]);
  const m = Number(match[2]);
  if (m < 1 || m > 12) return null;
  return {
    from: new Date(Date.UTC(year, m - 1, 1)),
    to: new Date(Date.UTC(m === 12 ? year + 1 : year, m === 12 ? 0 : m, 1)),
  };
}

const ledgerRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  /** Months that have trips, newest first, for the picker. */
  app.get('/months', async () => {
    const rows = await db
      .select({
        month: sql<string>`to_char(${trip.startedAt}, 'YYYY-MM')`.as('month'),
        trips: sql<number>`count(*)::int`.as('trips'),
        unchecked: sql<number>`count(*) filter (where ${trip.checkedAt} is null)::int`.as('unchecked'),
      })
      .from(trip)
      .groupBy(sql`to_char(${trip.startedAt}, 'YYYY-MM')`)
      .orderBy(desc(sql`to_char(${trip.startedAt}, 'YYYY-MM')`));
    return { months: rows };
  });

  app.get<{ Params: { month: string } }>('/month/:month', async (request, reply) => {
    const range = monthRange(request.params.month);
    if (!range) return reply.status(400).send({ error: 'Expected month as YYYY-MM' });

    const startPlace = { id: place.id, label: place.label, kind: place.kind };

    const rows = await db
      .select({
        id: trip.id,
        startedAt: trip.startedAt,
        endedAt: trip.endedAt,
        startedAtDerived: trip.startedAtDerived,
        distanceKm: trip.distanceKm,
        drivingMinutes: trip.drivingMinutes,
        avgConsumptionKwh100km: trip.avgConsumptionKwh100km,
        avgSpeedKmh: trip.avgSpeedKmh,
        purpose: trip.purpose,
        invoiceMonthly: trip.invoiceMonthly,
        checkedAt: trip.checkedAt,
        status: trip.status,
        source: trip.source,
        note: trip.note,
        startPlaceId: trip.startPlaceId,
        endPlaceId: trip.endPlaceId,
      })
      .from(trip)
      .where(and(gte(trip.startedAt, range.from), lt(trip.startedAt, range.to)))
      .orderBy(asc(trip.startedAt));

    // Place labels resolved separately — two joins on one table is noise for a
    // handful of rows, and OUR label is the display name (#5).
    const places = await db.select(startPlace).from(place);
    const byId = new Map(places.map((p) => [p.id, p]));

    const trips = rows.map((row) => ({
      ...row,
      distanceKm: Number(row.distanceKm),
      avgConsumptionKwh100km: row.avgConsumptionKwh100km === null ? null : Number(row.avgConsumptionKwh100km),
      avgSpeedKmh: row.avgSpeedKmh === null ? null : Number(row.avgSpeedKmh),
      startPlace: row.startPlaceId === null ? null : byId.get(row.startPlaceId) ?? null,
      endPlace: row.endPlaceId === null ? null : byId.get(row.endPlaceId) ?? null,
    }));

    // Rough completeness check. Real reconciliation is #12 — this is the
    // odometer span within the month, which needs at least two readings to
    // mean anything, and we only started collecting them recently.
    const odo = await db
      .select({
        lowest: sql<string | null>`min(${odometerReading.mileageKm})`,
        highest: sql<string | null>`max(${odometerReading.mileageKm})`,
        readings: sql<number>`count(*)::int`,
      })
      .from(odometerReading)
      .where(and(gte(odometerReading.observedAt, range.from), lt(odometerReading.observedAt, range.to)));

    const span = odo[0];
    const loggedKm = trips.reduce((sum, t) => sum + t.distanceKm, 0);
    const odometerKm =
      span && span.readings >= 2 && span.lowest !== null && span.highest !== null
        ? Number(span.highest) - Number(span.lowest)
        : null;

    return {
      month: request.params.month,
      summary: {
        trips: trips.length,
        totalKm: loggedKm,
        invoiceableKm: trips
          .filter((t) => t.checkedAt !== null && t.purpose === 'business' && t.invoiceMonthly)
          .reduce((sum, t) => sum + t.distanceKm, 0),
        unchecked: trips.filter((t) => t.checkedAt === null).length,
        unclassified: trips.filter((t) => t.purpose === null).length,
        unplaced: trips.filter((t) => t.startPlaceId === null || t.endPlaceId === null).length,
        odometerKm,
        odometerReadings: span?.readings ?? 0,
        unaccountedKm: odometerKm === null ? null : Math.round((odometerKm - loggedKm) * 10) / 10,
      },
      trips,
    };
  });

  interface PatchBody {
    purpose?: 'business' | 'private' | null;
    invoiceMonthly?: boolean;
    checked?: boolean;
    note?: string | null;
  }

  app.patch<{ Params: { id: string }; Body: PatchBody }>('/trip/:id', async (request, reply) => {
    const id = Number(request.params.id);
    if (!Number.isInteger(id)) return reply.status(400).send({ error: 'Bad id' });
    const body = request.body ?? {};

    const set: Record<string, unknown> = { updatedAt: new Date() };
    if ('purpose' in body) set.purpose = body.purpose ?? null;
    if ('invoiceMonthly' in body) set.invoiceMonthly = body.invoiceMonthly;
    if ('note' in body) set.note = body.note ?? null;
    if ('checked' in body) set.checkedAt = body.checked ? new Date() : null;

    const [updated] = await db.update(trip).set(set).where(eq(trip.id, id)).returning({ id: trip.id });
    if (!updated) return reply.status(404).send({ error: 'No such trip' });
    return { ok: true };
  });

  /**
   * Manual merge (#8): fold a trip into the one before it. This is how a
   * charging stop, or anything else the time rule got wrong, is repaired.
   */
  app.post<{ Params: { id: string } }>('/trip/:id/merge-previous', async (request, reply) => {
    const id = Number(request.params.id);
    if (!Number.isInteger(id)) return reply.status(400).send({ error: 'Bad id' });

    return db.transaction(async (tx) => {
      const [current] = await tx.select().from(trip).where(eq(trip.id, id)).limit(1);
      if (!current) return reply.status(404).send({ error: 'No such trip' });

      const [previous] = await tx
        .select()
        .from(trip)
        .where(and(eq(trip.vin, current.vin), lt(trip.startedAt, current.startedAt)))
        .orderBy(desc(trip.startedAt))
        .limit(1);
      if (!previous) return reply.status(400).send({ error: 'Nothing before this trip to merge into' });

      // Refuse to disturb a row you have already verified.
      if (previous.checkedAt !== null || current.checkedAt !== null) {
        return reply.status(409).send({ error: 'Uncheck both trips before merging' });
      }

      const distanceKm = Number(previous.distanceKm) + Number(current.distanceKm);
      const drivingMinutes =
        previous.drivingMinutes === null && current.drivingMinutes === null
          ? null
          : (previous.drivingMinutes ?? 0) + (current.drivingMinutes ?? 0);

      // Distance-weighted, as the merge rule requires — averaging the averages
      // would be wrong whenever the legs differ in length.
      const weight = (a: string | null, aKm: number, b: string | null, bKm: number): string | null => {
        if (a === null && b === null) return null;
        const total = aKm + bKm;
        if (total === 0) return a ?? b;
        return (((a === null ? 0 : Number(a)) * aKm + (b === null ? 0 : Number(b)) * bKm) / total).toFixed(1);
      };

      await tx
        .update(trip)
        .set({
          endedAt: current.endedAt,
          endPlaceId: current.endPlaceId,
          distanceKm: distanceKm.toFixed(2),
          drivingMinutes,
          avgConsumptionKwh100km: weight(
            previous.avgConsumptionKwh100km, Number(previous.distanceKm),
            current.avgConsumptionKwh100km, Number(current.distanceKm),
          ),
          avgSpeedKmh:
            drivingMinutes && drivingMinutes > 0
              ? (distanceKm / (drivingMinutes / 60)).toFixed(1)
              : previous.avgSpeedKmh,
          note: [previous.note, current.note].filter(Boolean).join(' / ') || null,
          updatedAt: new Date(),
        })
        .where(eq(trip.id, previous.id));

      await tx.delete(trip).where(eq(trip.id, id));
      return { ok: true, mergedInto: previous.id };
    });
  });
};

export default ledgerRoutes;
