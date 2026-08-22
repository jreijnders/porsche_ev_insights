export type Purpose = 'business' | 'private';

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
  summary: MonthSummary;
  trips: LedgerTrip[];
}

export interface MonthIndexEntry {
  month: string;
  trips: number;
  unchecked: number;
}
