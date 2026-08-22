/**
 * Rittenregistratie ledger schema.
 *
 * Resolves issue #10 on the wayfinder map (#1). Not yet wired to a build —
 * the re-platforming plan (#9) decides where this lives, how TypeScript is
 * configured, and how migrations run. Until then this is the design artifact.
 *
 * Conventions, all decided on #10:
 *  - `numeric`, never floating point, for anything that gets summed into an
 *    invoice. Float sums produce cent-level discrepancies you cannot explain.
 *  - Canonical metric storage (km, minutes, kWh/100km). Display conversion is
 *    the frontend's job — see src/utils/unitConvert.js.
 *  - Nullability carries meaning. An unplaced, unclassified or unchecked trip
 *    is a normal intermediate state, not a defect, so those columns are null
 *    rather than holding placeholder values.
 *  - `vin` everywhere. One car today; trips must stay attached to the car that
 *    made them, because reconciliation is against that car's odometer.
 */

import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/* ------------------------------------------------------------------ enums */

/** Home gets a wide match radius; business/other are tighter. See #11. */
export const placeKind = pgEnum('place_kind', ['home', 'business', 'other']);

/** Null purpose on a trip means "not yet classified" — deliberately not a third value here. */
export const tripPurpose = pgEnum('trip_purpose', ['business', 'private']);

/**
 * `provisional` — may still absorb another leg (see the merge rule, #8);
 * hidden from the ledger and not checkable.
 * `closed`      — 15 min elapsed with no new segment. Editable, checkable.
 *
 * A third state for month-close immutability is deliberately absent; that is
 * still fog on the map and would be an additive migration.
 */
export const tripStatus = pgEnum('trip_status', ['provisional', 'closed']);

export const tripSource = pgEnum('trip_source', ['api', 'manual']);

/**
 * Auth health is ACCOUNT-scoped, not per-vehicle, so it lives on
 * porsche_session rather than sync_state (#18). `reauth_required` means the
 * refresh chain is broken and only a hand-solved captcha can fix it.
 */
export const authHealth = pgEnum('auth_health', ['healthy', 'degraded', 'reauth_required']);

export const syncHealth = pgEnum('sync_health', [
  'healthy',
  'degraded',        // transient failures, still polling
  'broken',          // repeated failures, cause unknown
  'reauth_required', // refresh chain broken — needs a hand-solved captcha (#13)
]);

/* --------------------------------------------------------------- vehicle */

export const vehicle = pgTable('vehicle', {
  vin: text('vin').primaryKey(),
  label: text('label').notNull(),
  /** Key into src/constants/porscheEvModels.js, for WLTP/battery specs. */
  modelId: text('model_id'),
  acquiredOn: timestamp('acquired_on', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/* ----------------------------------------------------------------- place */

/**
 * The durable place book. Everything here is ours to keep:
 *  - `label` is OUR name for the place, and is the primary display name
 *    everywhere. Required by Google's EEA terms (#5) and the better product
 *    choice regardless.
 *  - `address` comes from Nominatim reverse-geocoding, whose OSMF Geocoding
 *    Guideline expressly permits permanent storage.
 *  - `googlePlaceId` may be retained indefinitely (confirmed, #5). Google
 *    names and addresses may NOT be cached at any duration and have no
 *    column here by design.
 */
export const place = pgTable(
  'place',
  {
    id: serial('id').primaryKey(),
    label: text('label').notNull(),
    kind: placeKind('kind').notNull(),
    lat: numeric('lat', { precision: 9, scale: 6 }).notNull(),
    lon: numeric('lon', { precision: 9, scale: 6 }).notNull(),
    /** Tight by default (#14 grilling: ~100 m). Home is set wide by hand — street parking. */
    matchRadiusM: integer('match_radius_m').notNull().default(100),
    googlePlaceId: text('google_place_id'),
    address: text('address'),
    addressSource: text('address_source'),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('place_coords_idx').on(t.lat, t.lon),
    check('place_radius_positive', sql`${t.matchRadiusM} > 0`),
  ],
);

/* ------------------------------------------------------------------ trip */

/**
 * One ledger row: a journey. The unit that gets classified, checked and invoiced.
 *
 * Identity: surrogate `id`, plus `apiFingerprint` (raw API end timestamp +
 * distance) unique per vehicle to stop a re-sync writing the same journey
 * twice. Deliberately NOT a natural key over `endedAt` — that column is
 * user-editable, and a natural key over editable data is a trap.
 * Manual trips carry a null fingerprint and are never deduped: two genuine
 * trips at the same minute are the user's business.
 */
export const trip = pgTable(
  'trip',
  {
    id: serial('id').primaryKey(),
    vin: text('vin').notNull().references(() => vehicle.vin),

    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }).notNull(),

    /**
     * True when startedAt was derived as (end - drivingMinutes) rather than
     * reported by the API. That derivation is granular to whole minutes and,
     * if drivingMinutes excludes standstill, lands late — biasing the merge
     * rule toward over-splitting (#8). Surfacing it lets the UI mark such
     * trips as suspect instead of implying precision that isn't there.
     */
    startedAtDerived: boolean('started_at_derived').notNull().default(false),

    startPlaceId: integer('start_place_id').references(() => place.id),
    endPlaceId: integer('end_place_id').references(() => place.id),

    distanceKm: numeric('distance_km', { precision: 8, scale: 2 }).notNull(),
    drivingMinutes: integer('driving_minutes'),
    avgConsumptionKwh100km: numeric('avg_consumption_kwh_100km', { precision: 5, scale: 1 }),
    avgSpeedKmh: numeric('avg_speed_kmh', { precision: 5, scale: 1 }),

    /** Null = not yet classified. Suggested from place kinds, confirmed by the user (#18). */
    purpose: tripPurpose('purpose'),
    /** Billing decision, always manual — never inferred from geography. */
    invoiceMonthly: boolean('invoice_monthly').notNull().default(false),
    /** Null = unchecked. One column so the flag and its date cannot disagree. */
    checkedAt: timestamp('checked_at', { withTimezone: true }),

    status: tripStatus('status').notNull().default('provisional'),
    source: tripSource('source').notNull(),
    apiFingerprint: text('api_fingerprint'),

    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('trip_api_fingerprint_uq')
      .on(t.vin, t.apiFingerprint)
      .where(sql`${t.apiFingerprint} is not null`),
    index('trip_vin_started_idx').on(t.vin, t.startedAt),
    index('trip_unchecked_idx').on(t.vin, t.startedAt).where(sql`${t.checkedAt} is null`),
    check('trip_time_order', sql`${t.endedAt} >= ${t.startedAt}`),
    check('trip_distance_nonneg', sql`${t.distanceKm} >= 0`),
    /** A provisional journey may still absorb another leg, so it cannot be verified (#8). */
    check(
      'trip_no_checked_while_provisional',
      sql`${t.checkedAt} is null or ${t.status} <> 'provisional'`,
    ),
    /** An API trip must be fingerprinted; a manual one must not be. */
    check(
      'trip_fingerprint_matches_source',
      sql`(${t.source} = 'api') = (${t.apiFingerprint} is not null)`,
    ),
  ],
);

/* --------------------------------------------------------------- segment */

/**
 * Raw API trip records, kept for a 72-hour rolling window then discarded (#8).
 * The window exists so the merge threshold can be changed and replayed over
 * recent driving, which is how the number gets tuned from real data.
 *
 * `raw` is the entry exactly as received. It is how the open question from #8
 * gets answered by data rather than by a console.log: if the payload turns out
 * to carry a true trip start time, `trip.startedAtDerived` can go away.
 */
export const segment = pgTable(
  'segment',
  {
    id: serial('id').primaryKey(),
    vin: text('vin').notNull().references(() => vehicle.vin),
    apiEndAt: timestamp('api_end_at', { withTimezone: true }).notNull(),
    drivingMinutes: integer('driving_minutes'),
    distanceKm: numeric('distance_km', { precision: 8, scale: 2 }).notNull(),
    avgConsumptionKwh100km: numeric('avg_consumption_kwh_100km', { precision: 5, scale: 1 }),
    avgSpeedKmh: numeric('avg_speed_kmh', { precision: 5, scale: 1 }),
    raw: jsonb('raw').notNull(),
    /** Which ledger row this merged into. Null until the journey closes. */
    tripId: integer('trip_id').references(() => trip.id, { onDelete: 'set null' }),
    ingestedAt: timestamp('ingested_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('segment_vin_end_uq').on(t.vin, t.apiEndAt),
    index('segment_ingested_idx').on(t.ingestedAt),
  ],
);

/* ---------------------------------------------------------------- sample */

/**
 * Deduplicated vehicle positions — the place harvester's raw evidence.
 *
 * Position is PUSH-ON-EVENT, not interval (#3): the car reports on engine
 * start/stop, door/tailgate, battery thresholds and manual request, and the
 * backend keeps ONE slot, overwritten on each status change. `eventAt`
 * (GPS_LOCATION's `lastModified`) is when that event fired.
 *
 * So a poll every 15 minutes yields only a handful of DISTINCT positions per
 * day. Deduping on (vin, eventAt) collapses ~35k rows/year to ~3k, which is
 * why these are kept forever with no pruning job (#10 Q1).
 *
 * `mileageKm` matters: doors and tailgate also push a position, so a changed
 * eventAt does NOT mean the car moved. Odometer is how you tell.
 */
export const sample = pgTable(
  'sample',
  {
    id: serial('id').primaryKey(),
    vin: text('vin').notNull().references(() => vehicle.vin),

    /** GPS_LOCATION.lastModified. Null when the API omits it (upstream #58). */
    eventAt: timestamp('event_at', { withTimezone: true }),
    /** When we polled. The degraded substitute when eventAt is absent. */
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull().defaultNow(),
    /** True when eventAt was unavailable and observedAt stands in for it. */
    eventAtEstimated: boolean('event_at_estimated').notNull().default(false),

    lat: numeric('lat', { precision: 9, scale: 6 }).notNull(),
    lon: numeric('lon', { precision: 9, scale: 6 }).notNull(),
    direction: integer('direction'),

    /** numeric, not integer: never truncate an odometer reading — see odometerReading. */
    mileageKm: numeric('mileage_km', { precision: 9, scale: 1 }),
    batteryPct: integer('battery_pct'),
    charging: boolean('charging'),
  },
  (t) => [
    /** The dedup. Partial, since eventAt is nullable. */
    uniqueIndex('sample_vin_event_uq')
      .on(t.vin, t.eventAt)
      .where(sql`${t.eventAt} is not null`),
    index('sample_vin_observed_idx').on(t.vin, t.observedAt),
    check(
      'sample_estimated_implies_no_event',
      sql`not ${t.eventAtEstimated} or ${t.eventAt} is null`,
    ),
  ],
);

/* ------------------------------------------------------- odometerReading */

/**
 * Separate from `sample` on purpose, for two reasons:
 *  - It is the ONLY anchor for reconciliation. PPA trip entries carry no
 *    per-trip odometer (the retired legacy endpoint did) — see #2 and #12.
 *  - It must survive the absence of GPS. Privacy mode disables location but
 *    mileage can still arrive, and a row in `sample` requires coordinates.
 *
 * Written on CHANGE only, not every poll.
 */
export const odometerReading = pgTable(
  'odometer_reading',
  {
    id: serial('id').primaryKey(),
    vin: text('vin').notNull().references(() => vehicle.vin),
    eventAt: timestamp('event_at', { withTimezone: true }),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull().defaultNow(),
    /**
     * numeric, not integer. Whether the API reports whole or fractional km is
     * unknown until the live probe (#15); truncating here would inject a
     * per-reading error straight into the reconciliation that guarantees the
     * ledger is complete (#12).
     */
    mileageKm: numeric('mileage_km', { precision: 9, scale: 1 }).notNull(),
  },
  (t) => [
    uniqueIndex('odometer_vin_mileage_uq').on(t.vin, t.mileageKm),
    index('odometer_vin_observed_idx').on(t.vin, t.observedAt),
  ],
);

/* ------------------------------------------------------------- syncState */

export const syncState = pgTable('sync_state', {
  vin: text('vin').primaryKey().references(() => vehicle.vin),
  /** Latest processed segment.apiEndAt. Advanced only after a successful write (#13). */
  tripWatermark: timestamp('trip_watermark', { withTimezone: true }),
  lastPollAt: timestamp('last_poll_at', { withTimezone: true }),
  lastPollOk: boolean('last_poll_ok'),
  health: syncHealth('health').notNull().default('healthy'),
  healthDetail: text('health_detail'),
  consecutiveFailures: integer('consecutive_failures').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/* --------------------------------------------------------- porscheSession */

/**
 * The refresh token now lives server-side rather than in the browser.
 *
 * Stored in PLAINTEXT, decided knowingly (#18): the container is LAN/VPN-only
 * with no auth, and the database password already sits in .env on the same
 * host, so an encryption key beside the data it protects is ceremony rather
 * than a boundary. The real controls are network isolation and host disk
 * encryption. Note what is behind this row:
 * access to the vehicle and to a complete location history. The container is
 * LAN/VPN-only with no auth (#16), so this table is the security boundary.
 */
export const porscheSession = pgTable('porsche_session', {
  accountEmail: text('account_email').primaryKey(),
  accessToken: text('access_token').notNull(),
  refreshToken: text('refresh_token').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  /** Account-wide auth state. Drives the re-authenticate banner. */
  health: authHealth('health').notNull().default('healthy'),
  lastError: text('last_error'),
  lastRefreshAt: timestamp('last_refresh_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/* ---------------------------------------------------------------- setting */

/**
 * Operator-tunable values, exposed in the UI (#21 chose env *or* UI):
 * poll interval, merge threshold minutes, minimum trip distance floor,
 * default place match radius.
 */
export const setting = pgTable('setting', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Kilometre allowance per year — the Dutch untaxed rate changes annually
 * (€0.23/km for 2026). #14 owns how the monthly figure uses this.
 */
export const mileageRate = pgTable(
  'mileage_rate',
  {
    year: integer('year').primaryKey(),
    eurPerKm: numeric('eur_per_km', { precision: 5, scale: 3 }).notNull(),
  },
  (t) => [check('mileage_rate_nonneg', sql`${t.eurPerKm} >= 0`)],
);
