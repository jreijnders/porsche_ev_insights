/**
 * The naming flow (#30) — the arithmetic, with no database and no network.
 *
 * Three separate rules live here, and they deliberately use three different
 * distances, because they answer three different questions:
 *
 *  - CANDIDATE_RADIUS_M (1 km) — "which places you already know are worth
 *    showing next to this arrival?" Informational. Generous on purpose.
 *  - WIDEN_WARNING_M (250 m) — "how big may a place quietly become?" A radius
 *    past this starts claiming neighbouring buildings, which is the ratchet
 *    #11 banned. Above it the caller must say so explicitly.
 *  - CLUSTER_RADIUS_M (100 m) — "which unnamed arrivals are the same spot?"
 *    The default match radius, so what the list groups is exactly what one new
 *    place would then match.
 *
 * Collapsing any two of these into one number would make one of the three
 * questions answer the wrong way.
 */

import { haversineMeters, type Coord, type MatchablePlace } from './match.js';

/** Known places within this range of an arrival are worth showing (#30). */
export const CANDIDATE_RADIUS_M = 1_000;

/** How many to show. Beyond three the list stops being a shortlist. */
export const MAX_CANDIDATES = 3;

/**
 * A widen that would push a place past this needs an explicit override.
 *
 * Not a hard stop: the human still decides (#11). But `widen-for-trip` refuses
 * only a NO-OP widen, so without a ceiling a stale screen or a mis-click can
 * produce a place with a 900 m radius that swallows every neighbour — and the
 * damage is silent, because it shows up later as confidently wrong matches.
 */
export const WIDEN_WARNING_M = 250;

/** Two unnamed arrivals this close are the same spot. */
export const CLUSTER_RADIUS_M = 100;

/* --------------------------------------------------------- candidates */

export interface Candidate {
  placeId: number;
  /** Metres from the arrival fix to the place. */
  distanceM: number;
  /** The place's radius today — the number a widen would change. */
  matchRadiusM: number;
  /** Whether the fix is already inside the radius. */
  withinRadius: boolean;
  /**
   * What the radius would become to reach this fix, or null when it already
   * does. Computed here so the button can state the size rather than say
   * "oprekken" and surprise you.
   */
  widenToM: number | null;
  /** Whether that new radius crosses WIDEN_WARNING_M and needs an override. */
  widenNeedsOverride: boolean;
}

/**
 * Margin added when widening, so a place reaches just past the fix rather than
 * exactly to it. Mirrors the default in the widen route.
 */
export const WIDEN_MARGIN_M = 10;

/**
 * Known places near an arrival, nearest first.
 *
 * Returns places whether or not the fix is inside them: a place the fix is
 * ALREADY inside is the answer to "is this a wrong match?" (the `~` case),
 * and one just outside is the answer to "should I widen?". The panel opens on
 * both, so both belong in the list.
 */
export function nearbyCandidates(
  fix: Coord,
  places: readonly MatchablePlace[],
  radiusM: number = CANDIDATE_RADIUS_M,
  max: number = MAX_CANDIDATES,
): Candidate[] {
  return places
    .map((p) => ({ place: p, distanceM: haversineMeters(fix, p) }))
    .filter((c) => c.distanceM <= radiusM)
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, max)
    .map(({ place, distanceM }) => {
      const withinRadius = distanceM <= place.matchRadiusM;
      const widenToM = withinRadius ? null : Math.ceil(distanceM + WIDEN_MARGIN_M);
      return {
        placeId: place.id,
        distanceM: Math.round(distanceM),
        matchRadiusM: place.matchRadiusM,
        withinRadius,
        widenToM,
        widenNeedsOverride: widenToM !== null && widenToM > WIDEN_WARNING_M,
      };
    });
}

/* ------------------------------------------------------------ widening */

export type WidenVerdict =
  | { allowed: true; newRadiusM: number; needsOverride: false }
  | { allowed: true; newRadiusM: number; needsOverride: true }
  | { allowed: false; reason: 'no-op' | 'override-required'; newRadiusM: number };

/**
 * Whether a widen may proceed.
 *
 * Two refusals, and they are different kinds. A no-op widen is refused because
 * it would change nothing and reporting success would be a lie. An
 * over-ceiling widen is refused only until the caller says it means it — the
 * decision stays the human's, it just stops being one click away.
 */
export function judgeWiden(
  currentRadiusM: number,
  distanceM: number,
  marginM: number = WIDEN_MARGIN_M,
  override = false,
): WidenVerdict {
  const newRadiusM = Math.ceil(distanceM + marginM);
  if (newRadiusM <= currentRadiusM) return { allowed: false, reason: 'no-op', newRadiusM };

  const needsOverride = newRadiusM > WIDEN_WARNING_M;
  if (needsOverride && !override) {
    return { allowed: false, reason: 'override-required', newRadiusM };
  }
  return needsOverride
    ? { allowed: true, newRadiusM, needsOverride: true }
    : { allowed: true, newRadiusM, needsOverride: false };
}

/* ------------------------------------------------------------ clustering */

export interface ArrivalPoint extends Coord {
  tripId: number;
  endedAt: Date;
}

export interface ArrivalCluster {
  /** Mean of the member coordinates — where a new place would be created. */
  lat: number;
  lon: number;
  tripIds: number[];
  /** Most recent arrival in the cluster, for ordering ties and for display. */
  latestAt: Date;
  /** Widest distance from the centre, in metres — how spread the parking is. */
  spreadM: number;
}

/**
 * Group unnamed arrivals into spots (#30, Q5b).
 *
 * Single-link greedy: each point joins the first cluster whose CENTRE is within
 * CLUSTER_RADIUS_M, and the centre then moves. Deliberately not transitive
 * chaining — with chaining, a line of arrivals 90 m apart merges an entire
 * street into one cluster, which is precisely the shape a business park has.
 * Testing against the moving centre keeps a cluster roughly the size of the
 * place it will become.
 *
 * Ordered by trip count, then by recency: the spot you keep visiting is the one
 * worth naming first.
 */
export function clusterArrivals(
  points: readonly ArrivalPoint[],
  radiusM: number = CLUSTER_RADIUS_M,
): ArrivalCluster[] {
  // Oldest first, so a cluster's centre is seeded by its earliest arrival and
  // the grouping does not depend on which order the database happened to
  // return rows in.
  const ordered = [...points].sort((a, b) => a.endedAt.getTime() - b.endedAt.getTime());

  const clusters: { lat: number; lon: number; members: ArrivalPoint[] }[] = [];

  for (const point of ordered) {
    const home = clusters.find((c) => haversineMeters(point, c) <= radiusM);
    if (home) {
      home.members.push(point);
      home.lat = home.members.reduce((s, m) => s + m.lat, 0) / home.members.length;
      home.lon = home.members.reduce((s, m) => s + m.lon, 0) / home.members.length;
    } else {
      clusters.push({ lat: point.lat, lon: point.lon, members: [point] });
    }
  }

  return clusters
    .map((c) => ({
      lat: c.lat,
      lon: c.lon,
      tripIds: c.members.map((m) => m.tripId),
      latestAt: c.members.reduce((a, m) => (m.endedAt > a ? m.endedAt : a), c.members[0]!.endedAt),
      spreadM: Math.round(Math.max(...c.members.map((m) => haversineMeters(m, c)))),
    }))
    .sort((a, b) => b.tripIds.length - a.tripIds.length || b.latestAt.getTime() - a.latestAt.getTime());
}

/* ------------------------------------------------------- pre-tracking rule */

/**
 * Whether a trip happened before position tracking existed, so geometry can
 * never place it (#22) and manual placement is the only answer (#30).
 *
 * The test is on the trip's whole arrival WINDOW, not its end time. The naive
 * form (`endedAt < earliestFix`) is wrong in a way that hides: the first trip
 * after tracking begins is usually the trip whose own arrival fix IS the
 * earliest fix, so it would be branded "before position tracking" and never
 * matched again — permanently and silently. #22 found that live, on the only
 * placeable trip in the ledger at the time.
 *
 * Lives here because two callers need it and they must not drift: the planner
 * decides whether to skip a trip, and the manual-placement route decides
 * whether to allow a hand-set place. If those two ever disagree, one of them
 * offers a control the other silently undoes.
 */
export function isPreTrackingWindow(
  endedAt: Date,
  earliestFixAt: Date | number | null,
  toleranceMinutes: number,
): boolean {
  if (earliestFixAt === null) return true;
  const earliest = typeof earliestFixAt === 'number' ? earliestFixAt : earliestFixAt.getTime();
  return endedAt.getTime() + toleranceMinutes * 60_000 < earliest;
}
