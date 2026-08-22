/**
 * Ledger API for the trip list (#21 prototype).
 *
 * Deliberately small: a month of trips, a summary above them, and the three
 * mutations the keyboard flow needs. No client session — LAN/VPN only (#16).
 */

import { and, asc, desc, eq, gte, lt, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

import { place, trip } from '../../db/schema.js';
import { db } from '../db/client.js';
import { summarise } from '../ledger/summary.js';
import { firstFixAt } from '../places/service.js';
import { acknowledgeGap, reconcileVehicleMonth } from '../reconcile/service.js';
import { AMSTERDAM, monthRangeOf } from '../time/month.js';

/**
 * Attribution is by trip START (#8), at the Europe/Amsterdam boundary (#14).
 *
 * Both the range filter below and the /months grouping derive from the same
 * zone. They have to: a filter and a grouping that disagree put a trip in one
 * month's list and another month's picker.
 */
const monthRange = (month: string) => monthRangeOf(month, AMSTERDAM);

const ledgerRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  /**
   * The month key, as ONE expression reused by select, group and order.
   *
   * The zone is inlined rather than interpolated: an interpolated string becomes
   * a bound parameter, and three separate parameters make three structurally
   * different expressions, so Postgres cannot match the GROUP BY to the
   * projection ("column trip.started_at must appear in the GROUP BY clause").
   * sql.raw is safe here because AMSTERDAM is our own constant, never input.
   */
  const monthExpr = sql`to_char(${trip.startedAt} at time zone ${sql.raw(`'${AMSTERDAM}'`)}, 'YYYY-MM')`;

  /** Months that have trips, newest first, for the picker. */
  app.get('/months', async () => {
    const rows = await db
      .select({
        month: sql<string>`${monthExpr}`.as('month'),
        trips: sql<number>`count(*)::int`.as('trips'),
        unchecked: sql<number>`count(*) filter (where ${trip.checkedAt} is null)::int`.as('unchecked'),
      })
      .from(trip)
      .groupBy(monthExpr)
      .orderBy(desc(monthExpr));
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
        startPlaceConfidence: trip.startPlaceConfidence,
        endPlaceConfidence: trip.endPlaceConfidence,
        endFixDeltaMinutes: trip.endFixDeltaMinutes,
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

    // Trips older than this predate position tracking, so an absent place is a
    // gap in the evidence rather than a failed match (#11). Derived, not stored.
    // The VIN is looked up separately rather than selected into the rows above:
    // the client has no use for it, and this payload goes to the browser.
    const [vehicleRow] = await db.select({ vin: trip.vin }).from(trip).limit(1);
    const trackingSince = vehicleRow ? await firstFixAt(vehicleRow.vin) : null;

    // Reconciliation between consecutive odometer readings (#12), computed on
    // demand. Replaces the month min/max this route used to do, which dropped
    // every kilometre driven between one month's last reading and the next
    // month's first — always in the direction that looks complete.
    const reconciliation = vehicleRow
      ? await reconcileVehicleMonth(vehicleRow.vin, request.params.month)
      : null;

    return {
      month: request.params.month,
      positionTrackingSince: trackingSince,
      summary: {
        ...summarise(trips),
        odometerReadings: reconciliation?.readingCount ?? 0,
      },
      reconciliation: reconciliation?.month ?? null,
      trips,
    };
  });

  /**
   * Close a reconciliation gap by recording the missing driving as a manual
   * trip (#12).
   *
   * The window is identified by its bounds rather than an id because windows
   * are computed, not stored — and the distance is recomputed server-side, so
   * a screen rendered before another trip landed cannot write a stale figure.
   */
  app.post<{ Body: { fromAt?: string; toAt?: string; note?: string | null } }>(
    '/acknowledge-gap',
    async (request, reply) => {
      const { fromAt, toAt, note } = request.body ?? {};
      if (!fromAt || !toAt) return reply.status(400).send({ error: 'fromAt and toAt are required' });

      const from = new Date(fromAt);
      const to = new Date(toAt);
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
        return reply.status(400).send({ error: 'fromAt and toAt must be timestamps' });
      }

      const [vehicleRow] = await db.select({ vin: trip.vin }).from(trip).limit(1);
      if (!vehicleRow) return reply.status(409).send({ error: 'No trips yet' });

      const result = await acknowledgeGap(vehicleRow.vin, from, to, note ?? null);
      if ('error' in result) return reply.status(409).send(result);
      return reply.status(201).send(result);
    },
  );

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
