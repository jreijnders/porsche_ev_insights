/**
 * The place book (#11): create, edit, delete, and re-run matching.
 *
 * Manual-first. Every place here exists because a human named it, and matching
 * works with the network unplugged.
 *
 * Nothing in this file calls Google. The naming panel (#30) renders Google
 * content in the BROWSER, inside a Places UI Kit element, and posts back a
 * `place_id` and a label the human typed — so the only Google-derived value
 * that ever reaches this server is an opaque ID, which #5 confirmed may be
 * stored indefinitely. Addresses come from Nominatim, which permits permanent
 * storage.
 */

import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

import { place, sample, trip } from '../../db/schema.js';
import { db } from '../db/client.js';
import { haversineMeters, selectArrivalFix, type MatchablePlace, type TimedFix } from '../places/match.js';
import {
  clusterArrivals,
  isPreTrackingWindow,
  judgeWiden,
  nearbyCandidates,
  WIDEN_MARGIN_M,
  WIDEN_WARNING_M,
  type ArrivalPoint,
} from '../places/naming.js';
import { reverseGeocode, searchPlaces } from '../places/nominatim.js';
import { DEFAULT_MATCH_CONFIG, firstFixAt, placeUsage, rematchVehicle } from '../places/service.js';

type PlaceKind = 'home' | 'business' | 'other';

interface PlaceBody {
  label?: string;
  kind?: PlaceKind;
  lat?: number;
  lon?: number;
  matchRadiusM?: number;
  note?: string | null;
  /**
   * From the Google panel (#30). The ID is ALL we take: names and addresses
   * have no caching permission at any duration (#5), so the label is typed by
   * the human having read the name inside Google's own component.
   */
  googlePlaceId?: string | null;
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

/** The pre-tracking rule, shared with the planner so the two cannot drift. */
async function isPreTracking(endedAt: Date, vin: string): Promise<boolean> {
  return isPreTrackingWindow(endedAt, await firstFixAt(vin), DEFAULT_MATCH_CONFIG.toleranceMinutes);
}

async function onlyVin(): Promise<string | null> {
  const rows = await db.select({ vin: trip.vin }).from(trip).limit(1);
  return rows[0]?.vin ?? null;
}

/**
 * The address to store on a new place, looked up once at creation (#30).
 *
 * Stored and never refetched: OSMF permits permanent storage, so a place keeps
 * a readable address even when Nominatim is unreachable later — and creating a
 * place is the one moment a human is already waiting, so the ~1 s the usage
 * policy costs is affordable exactly here and nowhere else.
 *
 * A failed lookup is not an error. The place is created without an address.
 */
async function addressFor(lat: number, lon: number): Promise<{ address: string | null; addressSource: string | null }> {
  const result = await reverseGeocode(lat, lon);
  return { address: result?.address ?? null, addressSource: result?.source ?? null };
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
        googlePlaceId: body.googlePlaceId ?? null,
        ...(await addressFor(body.lat!, body.lon!)),
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
        googlePlaceId: body.googlePlaceId ?? null,
        ...(await addressFor(Number(fix.lat), Number(fix.lon))),
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
  app.post<{ Params: { id: string }; Body: { placeId?: number; marginM?: number; override?: boolean } }>(
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
      const margin = request.body?.marginM ?? WIDEN_MARGIN_M;
      const verdict = judgeWiden(target.matchRadiusM, distanceM, margin, request.body?.override === true);

      if (!verdict.allowed && verdict.reason === 'no-op') {
        return reply.status(409).send({
          error: `${target.label} already reaches that far (${target.matchRadiusM} m, fix is ${Math.round(distanceM)} m away) — widening would change nothing.`,
        });
      }

      // The ceiling (#30). Not a refusal to widen — a refusal to widen this far
      // by accident. #11 banned the RATCHET, not the human decision, and a
      // radius past WIDEN_WARNING_M is where a place starts claiming the
      // building next door. The client must send `override` to mean it.
      if (!verdict.allowed) {
        return reply.status(409).send({
          error: `That would make ${target.label} ${verdict.newRadiusM} m across — past ${WIDEN_WARNING_M} m a place starts swallowing its neighbours. Confirm if you really mean it.`,
          needsOverride: true,
          wouldBecomeM: verdict.newRadiusM,
          currentRadiusM: target.matchRadiusM,
          fixDistanceM: Math.round(distanceM),
          ceilingM: WIDEN_WARNING_M,
        });
      }

      const newRadius = verdict.newRadiusM;

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

  /* ------------------------------------------------- the naming panel (#30) */

  /**
   * Everything the naming panel needs for one trip, in one call.
   *
   * One round trip rather than three, because the panel opens inline in a
   * ledger row and a staggered fill would make the row jump under the pointer.
   */
  app.get<{ Params: { id: string } }>('/naming/:id', async (request, reply) => {
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

    // No fix means no coordinate, so none of the geometry below applies. That
    // is not a dead end: the trip still went somewhere, and you still know
    // where. The panel switches to manual mode — pick a place you already
    // have, or name one by address — and the answer STICKS, because plan.ts
    // skips pre-tracking trips entirely rather than re-deriving them. That is
    // what makes this safe where the ambiguity hand-pick was not.
    if (!fix) {
      const rows = await db.select().from(place).orderBy(asc(place.label));
      return {
        tripId,
        mode: 'manual' as const,
        at: null,
        address: null,
        candidates: [],
        // The whole book: with no coordinate there is no "nearby", so the
        // shortlist has to be everything and the filtering is yours.
        places: rows.map((p) => ({
          id: p.id,
          label: p.label,
          kind: p.kind,
          address: p.address,
          lat: Number(p.lat),
          lon: Number(p.lon),
        })),
        currentPlaceId: row.endPlaceId,
        currentConfidence: row.endPlaceConfidence,
        ceilingM: WIDEN_WARNING_M,
      };
    }

    const at = { lat: Number(fix.lat), lon: Number(fix.lon) };
    const rows = await db.select().from(place);
    const matchable: MatchablePlace[] = rows.map((p) => ({
      id: p.id,
      lat: Number(p.lat),
      lon: Number(p.lon),
      matchRadiusM: p.matchRadiusM,
      kind: p.kind,
    }));
    const byId = new Map(rows.map((p) => [p.id, p]));

    const candidates = nearbyCandidates(at, matchable).map((c) => ({
      ...c,
      label: byId.get(c.placeId)?.label ?? '?',
      kind: byId.get(c.placeId)?.kind ?? 'other',
    }));

    // Address last: it is the one part that can be slow, and it is also the
    // one part the panel can live without.
    const address = await reverseGeocode(at.lat, at.lon);

    return {
      tripId,
      mode: 'fix' as const,
      at,
      address: address?.address ?? null,
      candidates,
      places: [],
      /** Which candidate, if any, the trip currently names — the "~" case. */
      currentPlaceId: row.endPlaceId,
      currentConfidence: row.endPlaceConfidence,
      ceilingM: WIDEN_WARNING_M,
    };
  });

  /**
   * Arrivals that matched no place, grouped into spots (#30).
   *
   * The place book's own question — "which spots do I keep going to without a
   * name?" — as opposed to the ledger's "where did THIS trip end?". Same
   * evidence, different cut, and this one names several trips at once.
   *
   * Checked trips are excluded: naming a cluster creates a place and re-matches,
   * and a checked trip is never rewritten (#22). Including them would offer an
   * action that then silently skipped half its members.
   */
  app.get('/unnamed', async () => {
    const vin = await onlyVin();
    if (!vin) return { clusters: [] };

    const rows = await db
      .select({ id: trip.id, endedAt: trip.endedAt })
      .from(trip)
      .where(and(eq(trip.vin, vin), isNull(trip.endPlaceId), isNull(trip.checkedAt)));

    if (rows.length === 0) return { clusters: [] };

    const fixRows = await db
      .select({ eventAt: sample.eventAt, observedAt: sample.observedAt, lat: sample.lat, lon: sample.lon })
      .from(sample)
      .where(eq(sample.vin, vin));
    const fixes: TimedFix[] = fixRows.map((f) => ({
      at: f.eventAt ?? f.observedAt,
      lat: Number(f.lat),
      lon: Number(f.lon),
    }));

    const points: ArrivalPoint[] = [];
    for (const r of rows) {
      const arrival = selectArrivalFix(r.endedAt, fixes, DEFAULT_MATCH_CONFIG.toleranceMinutes);
      // No fix means the trip predates position tracking. It is not an unnamed
      // spot — it is a trip with no spot at all, and listing it here would
      // offer a naming action that cannot work.
      if (!arrival) continue;
      points.push({ tripId: r.id, lat: arrival.fix.lat, lon: arrival.fix.lon, endedAt: r.endedAt });
    }

    const clusters = clusterArrivals(points);

    // Addresses are fetched serially by the Nominatim queue anyway, so cap the
    // number rather than let a first run of fifty clusters take a minute. The
    // cap is stated in the response rather than silently applied.
    const ADDRESSED = 10;
    const withAddress = await Promise.all(
      clusters.map(async (c, i) => ({
        ...c,
        address: i < ADDRESSED ? ((await reverseGeocode(c.lat, c.lon))?.address ?? null) : null,
        addressLookedUp: i < ADDRESSED,
      })),
    );

    return { clusters: withAddress, addressedLimit: ADDRESSED };
  });

  /**
   * Name a cluster: one place, and every trip in it placed by the re-match.
   *
   * The coordinate is the cluster centre computed server-side rather than one
   * the browser passed back, for the same reason widen recomputes its distance
   * — the coordinate decides what matches, so it must not be settable from a
   * stale screen.
   */
  type FromCluster = { Body: PlaceBody & { tripIds?: number[] } };
  app.post<FromCluster>('/from-cluster', async (request, reply) => {
    const body = request.body ?? {};
    if (!body.label || body.label.trim() === '') return reply.status(400).send({ error: 'label is required' });
    if (!body.kind || !KINDS.includes(body.kind)) return reply.status(400).send({ error: 'kind is required' });
    if (!Array.isArray(body.tripIds) || body.tripIds.length === 0) {
      return reply.status(400).send({ error: 'tripIds is required' });
    }

    const vin = await onlyVin();
    if (!vin) return reply.status(409).send({ error: 'No trips yet' });

    const fixRows = await db
      .select({ eventAt: sample.eventAt, observedAt: sample.observedAt, lat: sample.lat, lon: sample.lon })
      .from(sample)
      .where(eq(sample.vin, vin));
    const fixes: TimedFix[] = fixRows.map((f) => ({
      at: f.eventAt ?? f.observedAt,
      lat: Number(f.lat),
      lon: Number(f.lon),
    }));

    const tripRows = await db.select({ id: trip.id, endedAt: trip.endedAt }).from(trip).where(eq(trip.vin, vin));
    const wanted = new Set(body.tripIds);
    const points = tripRows
      .filter((r) => wanted.has(r.id))
      .map((r) => ({ r, arrival: selectArrivalFix(r.endedAt, fixes, DEFAULT_MATCH_CONFIG.toleranceMinutes) }))
      .filter((x): x is { r: (typeof tripRows)[number]; arrival: NonNullable<typeof x.arrival> } => x.arrival !== null);

    if (points.length === 0) {
      return reply.status(409).send({ error: 'None of those trips has an arrival position.' });
    }

    const lat = points.reduce((s, p) => s + p.arrival.fix.lat, 0) / points.length;
    const lon = points.reduce((s, p) => s + p.arrival.fix.lon, 0) / points.length;

    const [created] = await db
      .insert(place)
      .values({
        label: body.label.trim(),
        kind: body.kind,
        lat: coord(lat),
        lon: coord(lon),
        matchRadiusM: body.matchRadiusM ?? 100,
        note: body.note ?? null,
        googlePlaceId: body.googlePlaceId ?? null,
        ...(await addressFor(lat, lon)),
      })
      .returning();
    if (!created) return reply.status(500).send({ error: 'Insert returned no row' });

    await rematchAfterChange();
    return reply.status(201).send({
      place: { ...created, lat: Number(created.lat), lon: Number(created.lon) },
      tripsInCluster: points.length,
    });
  });

  /* ------------------------------------ manual placement, pre-tracking (#30) */

  /**
   * Forward geocoding, for naming a place you have no coordinate for.
   *
   * A thin pass-through so the browser never talks to Nominatim directly: one
   * User-Agent, one rate limiter, one place to change if the policy does.
   */
  app.get<{ Querystring: { q?: string } }>('/geocode', async (request) => {
    return { hits: await searchPlaces(request.query?.q ?? '') };
  });

  /**
   * The guard both manual endpoints share.
   *
   * Manual placement is only allowed on a trip matching CANNOT place — one
   * with no arrival fix. On any other trip the planner owns `end_place_id` and
   * would overwrite a hand-set value at the next re-match (#29), which is a
   * control that silently undoes itself. Refusing is the honest answer;
   * offering it and losing it quietly is not.
   *
   * Returns a verdict rather than sending the reply, so the refusal reason and
   * its status live next to each other and the caller stays readable.
   */
  type Verdict = { ok: true } | { ok: false; status: number; error: string };

  async function manualTarget(tripId: number): Promise<Verdict> {
    const [row] = await db.select().from(trip).where(eq(trip.id, tripId));
    if (!row) return { ok: false, status: 404, error: 'No such trip' };

    if (row.checkedAt !== null) {
      return {
        ok: false,
        status: 409,
        error: 'This trip is checked — uncheck it before changing its place.',
      };
    }
    if (!(await isPreTracking(row.endedAt, row.vin))) {
      return {
        ok: false,
        status: 409,
        error:
          'This trip does have position data, so matching decides its place — a manual choice would disappear at the next re-match. Adjust the place\'s radius instead.',
      };
    }
    return { ok: true };
  }

  /** Point a pre-tracking trip at a place you already have. No new geometry. */
  app.post<{ Params: { id: string }; Body: { placeId?: number } }>('/attach/:id', async (request, reply) => {
    const tripId = Number(request.params.id);
    if (!Number.isInteger(tripId)) return reply.status(400).send({ error: 'Bad trip id' });

    const placeId = request.body?.placeId;
    if (!Number.isInteger(placeId)) return reply.status(400).send({ error: 'placeId is required' });

    const verdict = await manualTarget(tripId);
    if (!verdict.ok) return reply.status(verdict.status).send({ error: verdict.error });

    const [exists] = await db.select({ id: place.id }).from(place).where(eq(place.id, placeId!));
    if (!exists) return reply.status(404).send({ error: 'No such place' });

    await db
      .update(trip)
      .set({
        endPlaceId: placeId!,
        // 'high' because a human said so, which outranks any geometry. The
        // column's other values describe what MATCHING concluded; this row was
        // never matched and never will be.
        endPlaceConfidence: 'high',
        updatedAt: new Date(),
      })
      // Re-checked in the WHERE: a row checked between the guard and the write
      // must lose, the same belt-and-braces service.ts uses.
      .where(and(eq(trip.id, tripId), isNull(trip.checkedAt)));

    return { ok: true, placeId };
  });

  /**
   * Create a place at a geocoded coordinate and point a pre-tracking trip at it.
   *
   * The coordinate comes from OUR geocode call, re-run here rather than taken
   * from the browser — the same reason widen recomputes its distance. A
   * coordinate decides what matches later, so it must not be settable from a
   * stale screen.
   */
  type FromAddress = { Params: { id: string }; Body: PlaceBody & { query?: string } };
  app.post<FromAddress>('/from-address/:id', async (request, reply) => {
    const tripId = Number(request.params.id);
    if (!Number.isInteger(tripId)) return reply.status(400).send({ error: 'Bad trip id' });

    const body = request.body ?? {};
    if (!body.label || body.label.trim() === '') return reply.status(400).send({ error: 'label is required' });
    if (!body.kind || !KINDS.includes(body.kind)) return reply.status(400).send({ error: 'kind is required' });
    if (!body.query || body.query.trim() === '') return reply.status(400).send({ error: 'query is required' });

    const verdict = await manualTarget(tripId);
    if (!verdict.ok) return reply.status(verdict.status).send({ error: verdict.error });

    const [hit] = await searchPlaces(body.query, 1);
    if (!hit) {
      return reply.status(409).send({ error: `No address found for "${body.query}".` });
    }

    const [created] = await db
      .insert(place)
      .values({
        label: body.label.trim(),
        kind: body.kind,
        lat: coord(hit.lat),
        lon: coord(hit.lon),
        matchRadiusM: body.matchRadiusM ?? 100,
        note: body.note ?? null,
        googlePlaceId: body.googlePlaceId ?? null,
        address: hit.address,
        addressSource: 'nominatim',
      })
      .returning();
    if (!created) return reply.status(500).send({ error: 'Insert returned no row' });

    await db
      .update(trip)
      .set({ endPlaceId: created.id, endPlaceConfidence: 'high', updatedAt: new Date() })
      .where(and(eq(trip.id, tripId), isNull(trip.checkedAt)));

    // A place created here is a real place: later trips that actually drive
    // there should match it, so the book re-matches like any other change.
    await rematchAfterChange();

    return reply.status(201).send({
      place: { ...created, lat: Number(created.lat), lon: Number(created.lon) },
      geocodedTo: hit,
    });
  });

  /** Re-run matching on demand. Idempotent; never touches a checked trip. */
  app.post('/rematch', async (_request, reply) => {
    const vin = await onlyVin();
    if (!vin) return reply.status(409).send({ error: 'No trips yet — nothing to match' });
    return { summary: await rematchVehicle(vin) };
  });
};

export default placeRoutes;
