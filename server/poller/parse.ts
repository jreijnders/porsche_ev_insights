/**
 * Parsers for Porsche measurement payloads.
 *
 * Shapes were confirmed against the live car (#15 probe), not inferred:
 *   GPS_LOCATION     {lastModified, location: "52.399680,4.636353", direction}
 *   MILEAGE          {lastModified, kilometers}          <- INTEGER km
 *   BATTERY_LEVEL    {lastModified, percent}
 *   CHARGING_SUMMARY {lastModified, status: "NOT_PLUGGED", mode, targetSoC}
 *
 * Every measurement carries `status.isEnabled`, and a disabled one comes back
 * with a `cause` (e.g. NOT_SUPPORTED, or privacy mode). Reading `value` without
 * checking that flag is a bug the existing src/App.jsx has; this does not.
 */

export interface Measurement {
  key: string;
  status?: { isEnabled?: boolean; cause?: string };
  value?: Record<string, unknown> & { lastModified?: string };
}

export interface MeasurementPayload {
  measurements?: Measurement[];
}

/** Returns the measurement's value only if the backend reports it enabled. */
export function enabledValue(
  payload: MeasurementPayload,
  key: string,
): (Record<string, unknown> & { lastModified?: string }) | null {
  const m = payload.measurements?.find((x) => x.key === key);
  if (!m) return null;
  if (m.status?.isEnabled === false) return null;
  return m.value ?? null;
}

function parseLastModified(value: { lastModified?: string }): Date | null {
  if (!value.lastModified) return null;
  const d = new Date(value.lastModified);
  return Number.isNaN(d.getTime()) ? null : d;
}

export interface ParsedPosition {
  lat: number;
  lon: number;
  direction: number | null;
  /** GPS_LOCATION.lastModified — when the vehicle actually pushed this fix. */
  eventAt: Date | null;
}

export function parsePosition(payload: MeasurementPayload): ParsedPosition | null {
  const value = enabledValue(payload, 'GPS_LOCATION');
  if (!value) return null;

  const raw = value.location;
  if (typeof raw !== 'string') return null;
  const [latStr, lonStr] = raw.split(',');
  const lat = Number(latStr);
  const lon = Number(lonStr);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const direction = typeof value.direction === 'number' ? value.direction : null;
  return { lat, lon, direction, eventAt: parseLastModified(value) };
}

export interface ParsedOdometer {
  kilometers: number;
  eventAt: Date | null;
}

export function parseOdometer(payload: MeasurementPayload): ParsedOdometer | null {
  const value = enabledValue(payload, 'MILEAGE');
  if (!value) return null;
  const km = value.kilometers;
  if (typeof km !== 'number' || !Number.isFinite(km)) return null;
  return { kilometers: km, eventAt: parseLastModified(value) };
}

export function parseBatteryPercent(payload: MeasurementPayload): number | null {
  const value = enabledValue(payload, 'BATTERY_LEVEL');
  const percent = value?.percent;
  return typeof percent === 'number' ? percent : null;
}

/**
 * Charging state comes from CHARGING_SUMMARY.status, NOT from
 * BATTERY_CHARGING_STATE — that key does not exist (#15 probe: requested and
 * absent entirely, not even isEnabled:false).
 */
export function parseIsCharging(payload: MeasurementPayload): boolean | null {
  const value = enabledValue(payload, 'CHARGING_SUMMARY');
  const status = value?.status;
  if (typeof status !== 'string') return null;
  return status !== 'NOT_PLUGGED' && status !== 'NOT_CHARGING';
}

export interface RawTripEntry {
  distanceKm?: number;
  avgKwhPerHundredKm?: number;
  avgSpeedKmh?: number;
  drivingTimeMinutes?: number;
  tripEndTime?: string;
}

export interface ParsedSegment {
  apiEndAt: Date;
  distanceKm: number;
  drivingMinutes: number | null;
  avgConsumptionKwh100km: number | null;
  avgSpeedKmh: number | null;
  raw: RawTripEntry;
}

/**
 * Reads TRIP_STATISTICS_SHORT_TERM_HISTORY into segments, newest-last.
 *
 * Only the *history* is ingested. TRIP_STATISTICS_SHORT_TERM holds the latest
 * trip and only moves into history when the NEXT trip begins (#15 probe), and
 * its distance grows while driving — so persisting it would churn rows keyed on
 * a moving tripEndTime. The ledger therefore lags by one trip.
 */
export function parseSegments(payload: MeasurementPayload): ParsedSegment[] {
  const value = enabledValue(payload, 'TRIP_STATISTICS_SHORT_TERM_HISTORY');
  const list = value?.list;
  if (!Array.isArray(list)) return [];

  const segments: ParsedSegment[] = [];
  for (const entry of list as RawTripEntry[]) {
    if (!entry?.tripEndTime) continue;
    const apiEndAt = new Date(entry.tripEndTime);
    if (Number.isNaN(apiEndAt.getTime())) continue;
    const distanceKm = typeof entry.distanceKm === 'number' ? entry.distanceKm : 0;

    segments.push({
      apiEndAt,
      distanceKm,
      drivingMinutes:
        typeof entry.drivingTimeMinutes === 'number' ? entry.drivingTimeMinutes : null,
      avgConsumptionKwh100km:
        typeof entry.avgKwhPerHundredKm === 'number' ? entry.avgKwhPerHundredKm : null,
      avgSpeedKmh: typeof entry.avgSpeedKmh === 'number' ? entry.avgSpeedKmh : null,
      raw: entry,
    });
  }

  segments.sort((a, b) => a.apiEndAt.getTime() - b.apiEndAt.getTime());
  return segments;
}
