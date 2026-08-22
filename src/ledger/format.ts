/** Formatting helpers. Pure, so they are testable — see format.test.ts. */

const DAY = new Intl.DateTimeFormat('nl-NL', { day: '2-digit', month: 'short', timeZone: 'Europe/Amsterdam' });
const TIME = new Intl.DateTimeFormat('nl-NL', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Amsterdam' });

export function formatDay(iso: string): string {
  return DAY.format(new Date(iso));
}

export function formatTime(iso: string): string {
  return TIME.format(new Date(iso));
}

export function formatMonth(month: string): string {
  const [year, m] = month.split('-');
  const date = new Date(Date.UTC(Number(year), Number(m) - 1, 1));
  return new Intl.DateTimeFormat('nl-NL', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
}

/** 175 -> "2u 55m". Driving time is reference data, so keep it compact. */
export function formatDuration(minutes: number | null): string {
  if (minutes === null) return '–';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h === 0 ? `${m}m` : `${h}u ${m}m`;
}

export function formatKm(km: number): string {
  return `${km.toLocaleString('nl-NL', { maximumFractionDigits: km % 1 === 0 ? 0 : 1 })} km`;
}

/**
 * A journey is only checkable once it is closed (#8) — a provisional trip may
 * still absorb another leg. The database enforces this too; this keeps the UI
 * from offering something that will be refused.
 */
export function isCheckable(status: string): boolean {
  return status === 'closed';
}
