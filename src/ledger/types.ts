export type Purpose = 'business' | 'private';

/**
 * How much to trust a place suggestion (#11).
 * null means matching has not run for this trip — NOT the same as 'none',
 * which means it ran and found nothing inside any radius.
 */
export type PlaceConfidence = 'high' | 'low' | 'none';

export interface PlaceRef {
  id: number;
  label: string;
  kind: 'home' | 'business' | 'other';
}

export interface LedgerTrip {
  id: number;
  startedAt: string;
  endedAt: string;
  startedAtDerived: boolean;
  distanceKm: number;
  drivingMinutes: number | null;
  avgConsumptionKwh100km: number | null;
  avgSpeedKmh: number | null;
  purpose: Purpose | null;
  invoiceMonthly: boolean;
  checkedAt: string | null;
  status: 'provisional' | 'closed';
  source: 'api' | 'manual';
  note: string | null;
  startPlace: PlaceRef | null;
  endPlace: PlaceRef | null;
  startPlaceConfidence: PlaceConfidence | null;
  endPlaceConfidence: PlaceConfidence | null;
  /** Minutes between arrival and the fix used to place it. Bigger is weaker evidence. */
  endFixDeltaMinutes: number | null;
}

export type ReconStatus =
  | 'quiet'
  | 'unaccounted'
  | 'over_logged'
  | 'settling'
  | 'not_reconcilable'
  | 'partial';

export interface ReconWindow {
  fromAt: string;
  toAt: string;
  fromKm: number;
  toKm: number;
  odometerDeltaKm: number;
  loggedKm: number;
  /** odometer − logged. Positive: a trip is missing. Negative: one is counted twice. */
  differenceKm: number;
  tripCount: number;
  toleranceKm: number;
  verdict: 'quiet' | 'unaccounted' | 'over_logged' | 'settling';
}

export interface Reconciliation {
  status: ReconStatus;
  unaccountedKm: number;
  overLoggedKm: number;
  windows: ReconWindow[];
  coverageFrom: string | null;
  settlingCount: number;
}

export interface MonthSummary {
  trips: number;
  totalKm: number;
  invoiceableKm: number;
  unchecked: number;
  unclassified: number;
  unplaced: number;
  odometerReadings: number;
}

export interface MonthPayload {
  month: string;
  /** When position tracking began. Trips older than this cannot be placed at all. */
  positionTrackingSince: string | null;
  /** Null only when there are no trips at all. */
  reconciliation: Reconciliation | null;
  summary: MonthSummary;
  trips: LedgerTrip[];
}

export interface MonthIndexEntry {
  month: string;
  trips: number;
  unchecked: number;
}
