/** Formatting helpers. Pure, so they are testable — see format.test.ts. */

/**
 * en-GB throughout, not en-US: this ledger records European driving, so dates
 * are day-first and the clock is 24-hour. A 12-hour clock would turn a 00:23
 * departure into "12:23 am", which is exactly the kind of ambiguity a record
 * you might have to defend should not contain.
 */
const DAY = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', timeZone: 'Europe/Amsterdam' });
const TIME = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Amsterdam' });

export function formatDay(iso: string): string {
  return DAY.format(new Date(iso));
}

export function formatTime(iso: string): string {
  return TIME.format(new Date(iso));
}

export function formatMonth(month: string): string {
  const [year, m] = month.split('-');
  const date = new Date(Date.UTC(Number(year), Number(m) - 1, 1));
  return new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
}

/** 175 -> "2h 55m". Driving time is reference data, so keep it compact. */
export function formatDuration(minutes: number | null): string {
  if (minutes === null) return '–';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h === 0 ? `${m}m` : `${h}h ${m}m`;
}

export function formatKm(km: number): string {
  return `${formatKmNumber(km)} km`;
}

/**
 * The bare number, for a column whose header already says "km".
 *
 * Repeating the unit on every row of a table is noise: it makes each cell a
 * different width and stops the digits lining up, which is the one thing a
 * numeric column exists to do.
 */
export function formatKmNumber(km: number): string {
  return km.toLocaleString('en-GB', { maximumFractionDigits: km % 1 === 0 ? 0 : 1 });
}

/**
 * A journey is only checkable once it is closed (#8) — a provisional trip may
 * still absorb another leg. The database enforces this too; this keeps the UI
 * from offering something that will be refused.
 */
export function isCheckable(status: string): boolean {
  return status === 'closed';
}
