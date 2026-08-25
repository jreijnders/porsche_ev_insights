export type PlaceKind = 'home' | 'business' | 'other';

/** How a place is actually being used — computed from the trips, never stored. */
export interface PlaceUsage {
  trips: number;
  /** Trips a human has checked. These block deletion, deliberately. */
  checkedTrips: number;
  /** How far matched arrival fixes landed, in metres. Null until something matches. */
  nearestMatchM: number | null;
  farthestMatchM: number | null;
}

export interface Place {
  id: number;
  label: string;
  kind: PlaceKind;
  lat: number;
  lon: number;
  matchRadiusM: number;
  note: string | null;
  /** From Nominatim at creation, stored permanently (#5/#30). Null on places made before that. */
  address: string | null;
  usage: PlaceUsage;
}

/**
 * A group of arrivals that matched no place (#30) — the place book's own
 * question: "which spots do I keep going to without a name?"
 *
 * Not stored anywhere. Computed from the trips on every read, like usage, for
 * the same reason: a stored copy is wrong the moment a re-match moves a trip.
 */
export interface ArrivalCluster {
  lat: number;
  lon: number;
  tripIds: number[];
  latestAt: string;
  /** Widest distance from the centre — how spread the parking is, in metres. */
  spreadM: number;
  /** From Nominatim, or null when the lookup was skipped or failed. */
  address: string | null;
  /** False when this cluster was past the address-lookup cap, not when it failed. */
  addressLookedUp: boolean;
}
