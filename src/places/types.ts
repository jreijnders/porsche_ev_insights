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
  usage: PlaceUsage;
}
