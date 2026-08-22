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

export interface MonthSummary {
  trips: number;
  totalKm: number;
  invoiceableKm: number;
  unchecked: number;
  unclassified: number;
  unplaced: number;
  odometerKm: number | null;
  odometerReadings: number;
  unaccountedKm: number | null;
}

export interface MonthPayload {
  month: string;
  /** When position tracking began. Trips older than this cannot be placed at all. */
  positionTrackingSince: string | null;
  summary: MonthSummary;
  trips: LedgerTrip[];
}

export interface MonthIndexEntry {
  month: string;
  trips: number;
  unchecked: number;
}
