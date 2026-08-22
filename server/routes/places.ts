/**
 * The place book (#11): create, edit, delete, and re-run matching.
 *
 * Manual-first. Every place here exists because a human named it — nothing in
 * this file talks to Google, and matching works with the network unplugged.
 * Google-sourced suggestions are additive and deliberately elsewhere.
 */

import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

import { place, sample, trip } from '../../db/schema.js';
import { db } from '../db/client.js';
import { haversineMeters } from '../places/match.js';
import { DEFAULT_MATCH_CONFIG, placeUsage, rematchVehicle } from '../places/service.js';

type PlaceKind = 'home' | 'business' | 'other';

interface PlaceBody {
  label?: string;
  kind?: PlaceKind;
  lat?: number;
  lon?: number;
  matchRadiusM?: number;
  note?: string | null;
}

const KINDS: readonly PlaceKind[] = ['home', 'business', 'other'];

/** Coordinates are stored as numeric(9,6); Drizzle wants them as strings. */
const coord = (n: number): string => n.toFixed(6);

function validate(body: PlaceBody, requireAll: boolean): string | null {
  if (requireAll || body.label !== undefined) {
    if (!body.label || body.label.trim() === '') return 'label is required';
  }
  if (requireAll || body.kind !== undefined) {
    if (!body.kind || !KINDS.includes(body.kind)) return `kind must be one of ${KINDS.join(', ')}`;
  }
  if (requireAll || body.lat !== undefined) {
    if (typeof body.lat !== 'number' || body.lat < -90 || body.lat > 90) return 'lat must be between -90 and 90';
  }
  if (requireAll || body.lon !== undefined) {
    if (typeof body.lon !== 'number' || body.lon < -180 || body.lon > 180) return 'lon must be between -180 and 180';
  }
  if (body.matchRadiusM !== undefined) {
    if (typeof body.matchRadiusM !== 'number' || body.matchRadiusM <= 0) return 'matchRadiusM must be positive';
  }
  return null;
}

/**
 * Time comparison against the coalesce(event_at, observed_at) expression.
 *
 * Drizzle's gte/lte carry a column's type mapper; against a raw `sql`
 * expression there is no column, so a Date is handed to postgres.js unconverted
 * and it throws ("The string argument must be of type string... Received an
 * instance of Date"). Passing an ISO string with an explicit cast keeps the
 * comparison in timestamptz where it belongs.
 */
const fixTime = sql`coalesce(${sample.eventAt}, ${sample.observedAt})`;
const atOrAfter = (t: Date) => sql`${fixTime} >= ${t.toISOString()}::timestamptz`;
const atOrBefore = (t: Date) => sql`${fixTime} <= ${t.toISOString()}::timestamptz`;

async function onlyVin(): Promise<string | null> {
  const rows = await db.select({ vin: trip.vin }).from(trip).limit(1);
  return rows[0]?.vin ?? null;
}

/** Re-match after any change to the book, so a new place names old trips at once. */
async function rematchAfterChange(): Promise<void> {
  const vin = await onlyVin();
  if (vin) await rematchVehicle(vin);
}

const placeRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.get('/', async () => {
    const rows = await db.select().from(place).orderBy(asc(place.label));
    const vin = await onlyVin();
    // Usage is computed, not stored: it is a view of the trips, and a stored
    // copy would be wrong the moment a re-match moved one.
    const usage = vin ? await placeUsage(vin) : new Map();

    return {
      places: rows.map((p) => ({
        ...p,
        lat: Number(p.lat),
        lon: Number(p.lon),
        usage: usage.get(p.id) ?? { trips: 0, checkedTrips: 0, nearestMatchM: null, farthestMatchM: null },
      })),
    };
  });

  app.post<{ Body: PlaceBody }>('/', async (request, reply) => {
    const error = validate(request.body ?? {}, true);
    if (error) return reply.status(400).send({ error });

    const body = request.body;
    const [created] = await db
      .insert(place)
      .values({
        label: body.label!.trim(),
        kind: body.kind!,
        lat: coord(body.lat!),
        lon: coord(body.lon!),
        matchRadiusM: body.matchRadiusM ?? 100,
        note: body.note ?? null,
      })
      .returning();
    if (!created) return reply.status(500).send({ error: 'Insert returned no row' });

    await rematchAfterChange();
    return reply.status(201).send({ place: { ...created, lat: Number(created.lat), lon: Number(created.lon) } });
  });

  /**
   * Create a place from a trip's own arrival coordinate — the common path, and
   * one action rather than "read the coordinate, then type it in" (#11).
   *
   * Uses the same fix the matcher would have used, so a place created this way
   * is guaranteed to match the trip it came from.
   */
  type FromTrip = { Params: { id: string }; Body: PlaceBody; Querystring: { endpoint?: string } };
  app.post<FromTrip>('/from-trip/:id', async (request, reply) => {
    const tripId = Number(request.params.id);
    if (!Number.isInteger(tripId)) return reply.status(400).send({ error: 'Bad trip id' });

    const body = request.body ?? {};
    if (!body.label || body.label.trim() === '') return reply.status(400).send({ error: 'label is required' });
    if (!body.kind || !KINDS.includes(body.kind)) return reply.status(400).send({ error: 'kind is required' });

    const [row] = await db.select().from(trip).where(eq(trip.id, tripId));
    if (!row) return reply.status(404).send({ error: 'No such trip' });

    const endpoint = request.query?.endpoint === 'start' ? 'start' : 'end';
    const anchor = endpoint === 'start' ? row.startedAt : row.endedAt;
    const windowMs = DEFAULT_MATCH_CONFIG.toleranceMinutes * 60_000;

    // Mirror the matcher: first fix at/after arrival, last fix at/before departure.
    const [fix] =
      endpoint === 'start'
        ? await db
            .select({ lat: sample.lat, lon: sample.lon })
            .from(sample)
            .where(and(eq(sample.vin, row.vin), atOrBefore(anchor), atOrAfter(new Date(anchor.getTime() - windowMs))))
            .orderBy(sql`${fixTime} desc`)
            .limit(1)
        : await db
            .select({ lat: sample.lat, lon: sample.lon })
            .from(sample)
            .where(and(eq(sample.vin, row.vin), atOrAfter(anchor), atOrBefore(new Date(anchor.getTime() + windowMs))))
            .orderBy(sql`${fixTime} asc`)
            .limit(1);

    if (!fix) {
      return reply.status(409).send({
        error:
          'No position fix within tolerance of that trip — it probably predates position tracking, so there is no coordinate to name.',
      });
    }

    const [created] = await db
      .insert(place)
      .values({
        label: body.label.trim(),
        kind: body.kind,
        lat: fix.lat,
        lon: fix.lon,
        matchRadiusM: body.matchRadiusM ?? 100,
        note: body.note ?? null,
      })
      .returning();
    if (!created) return reply.status(500).send({ error: 'Insert returned no row' });

    await rematchAfterChange();
    return reply.status(201).send({ place: { ...created, lat: Number(created.lat), lon: Number(created.lon) } });
  });

  app.patch<{ Params: { id: string }; Body: PlaceBody }>('/:id', async (request, reply) => {
    const id = Number(request.params.id);
    if (!Number.isInteger(id)) return reply.status(400).send({ error: 'Bad place id' });

    const body = request.body ?? {};
    const error = validate(body, false);
    if (error) return reply.status(400).send({ error });

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (body.label !== undefined) patch.label = body.label.trim();
    if (body.kind !== undefined) patch.kind = body.kind;
    if (body.lat !== undefined) patch.lat = coord(body.lat);
    if (body.lon !== undefined) patch.lon = coord(body.lon);
    // Widening is a human act and only ever arrives through here — matching
    // never grows a radius on its own (#11).
    if (body.matchRadiusM !== undefined) patch.matchRadiusM = body.matchRadiusM;
    if (body.note !== undefined) patch.note = body.note;

    const [updated] = await db.update(place).set(patch).where(eq(place.id, id)).returning();
    if (!updated) return reply.status(404).send({ error: 'No such place' });

    await rematchAfterChange();
    return { place: { ...updated, lat: Number(updated.lat), lon: Number(updated.lon) } };
  });

  app.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const id = Number(request.params.id);
    if (!Number.isInteger(id)) return reply.status(400).send({ error: 'Bad place id' });

    // A checked trip that names this place is verified history. Deleting the
    // place would either rewrite that row or break the foreign key, so refuse
    // outright and say which trips are in the way.
    const held = await db
      .select({ id: trip.id, startedAt: trip.startedAt })
      .from(trip)
      .where(
        and(
          sql`(${trip.startPlaceId} = ${id} or ${trip.endPlaceId} = ${id})`,
          sql`${trip.checkedAt} is not null`,
        ),
      );

    if (held.length > 0) {
      return reply.status(409).send({
        error: `${held.length} checked trip(s) reference this place. Deleting it would rewrite verified history — unchecked those trips first, or rename the place instead.`,
        tripIds: held.map((t) => t.id),
      });
    }

    // Unchecked references are only suggestions, so they simply go.
    await db.transaction(async (tx) => {
      await tx
        .update(trip)
        .set({ startPlaceId: null, startPlaceConfidence: null })
        .where(and(eq(trip.startPlaceId, id), isNull(trip.checkedAt)));
      await tx
        .update(trip)
        .set({ endPlaceId: null, endPlaceConfidence: null })
        .where(and(eq(trip.endPlaceId, id), isNull(trip.checkedAt)));
    });

    const [deleted] = await db.delete(place).where(eq(place.id, id)).returning({ id: place.id });
    if (!deleted) return reply.status(404).send({ error: 'No such place' });

    await rematchAfterChange();
    return { deleted: deleted.id };
  });

  /**
   * "Accept and widen": stretch a place just far enough to cover one trip's
   * arrival, when the fix sits a little outside the radius (#11).
   *
   * Deliberately an endpoint rather than a client calculation, and it
   * RECOMPUTES the distance from the stored fix instead of trusting a number
   * the browser passed back — the radius is what decides whether future trips
   * match, so it must not be settable from a stale screen.
   *
   * Still never automatic. Nothing calls this except a human choosing to.
   */
  app.post<{ Params: { id: string }; Body: { placeId?: number; marginM?: number } }>(
    '/widen-for-trip/:id',
    async (request, reply) => {
      const tripId = Number(request.params.id);
      if (!Number.isInteger(tripId)) return reply.status(400).send({ error: 'Bad trip id' });

      const [row] = await db.select().from(trip).where(eq(trip.id, tripId));
      if (!row) return reply.status(404).send({ error: 'No such trip' });

      const windowMs = DEFAULT_MATCH_CONFIG.toleranceMinutes * 60_000;
      const [fix] = await db
        .select({ lat: sample.lat, lon: sample.lon })
        .from(sample)
        .where(
          and(
            eq(sample.vin, row.vin),
            atOrAfter(row.endedAt),
            atOrBefore(new Date(row.endedAt.getTime() + windowMs)),
          ),
        )
        .orderBy(sql`${fixTime} asc`)
        .limit(1);

      if (!fix) return reply.status(409).send({ error: 'No arrival fix for that trip to widen towards' });

      const places = await db.select().from(place);
      const target = request.body?.placeId
        ? places.find((p) => p.id === request.body.placeId)
        : places
            .map((p) => ({ p, d: haversineMeters({ lat: Number(fix.lat), lon: Number(fix.lon) }, { lat: Number(p.lat), lon: Number(p.lon) }) }))
            .sort((a, b) => a.d - b.d)[0]?.p;

      if (!target) return reply.status(409).send({ error: 'No place to widen — create one first' });

      const distanceM = haversineMeters(
        { lat: Number(fix.lat), lon: Number(fix.lon) },
        { lat: Number(target.lat), lon: Number(target.lon) },
      );
      const margin = request.body?.marginM ?? 10;
      const newRadius = Math.ceil(distanceM + margin);

      if (newRadius <= target.matchRadiusM) {
        return reply.status(409).send({
          error: `${target.label} already reaches that far (${target.matchRadiusM} m, fix is ${Math.round(distanceM)} m away) — widening would change nothing.`,
        });
      }

      const [updated] = await db
        .update(place)
        .set({ matchRadiusM: newRadius, updatedAt: new Date() })
        .where(eq(place.id, target.id))
        .returning();

      await rematchAfterChange();
      return {
        place: updated ? { ...updated, lat: Number(updated.lat), lon: Number(updated.lon) } : null,
        widenedFrom: target.matchRadiusM,
        widenedTo: newRadius,
        fixDistanceM: Math.round(distanceM),
      };
    },
  );

  /** Re-run matching on demand. Idempotent; never touches a checked trip. */
  app.post('/rematch', async (_request, reply) => {
    const vin = await onlyVin();
    if (!vin) return reply.status(409).send({ error: 'No trips yet — nothing to match' });
    return { summary: await rematchVehicle(vin) };
  });
};

export default placeRoutes;
