/**
 * What month an instant belongs to — the single place that answers it.
 *
 * The ledger has to agree with itself. The trip list, the month picker and
 * reconciliation all divide time into months, and if any two of them disagree
 * a trip can be counted in one month and reconciled in another. That is not a
 * hypothetical: this module exists because `Date.UTC` in the trip query put the
 * month boundary at 02:00 Amsterdam in summer, so a trip starting at 00:40 on
 * the 1st was filed into the previous month (#14).
 *
 * Europe/Amsterdam, not UTC, because this is a record that may have to be
 * defended to a Dutch reader who counts months the way their calendar does.
 */

export const AMSTERDAM = 'Europe/Amsterdam';

/** en-CA renders YYYY-MM-DD, so a 7-character slice is locale-proof. */
const keyFormatter = (timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });

/** The `YYYY-MM` an instant falls in, read in the given zone. */
export function monthKeyOf(date: Date, timeZone: string = AMSTERDAM): string {
  return keyFormatter(timeZone).format(date).slice(0, 7);
}

/**
 * The offset, in milliseconds, between an instant and how the zone displays it.
 * Derived from the platform's own tz database rather than hard-coded, so DST
 * rule changes arrive with the runtime instead of needing a code change.
 */
function offsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);

  const at: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== 'literal') at[part.type] = Number(part.value);
  }

  // hour can format as 24 for midnight under hour12:false on some runtimes.
  const asIfUtc = Date.UTC(
    at.year!,
    at.month! - 1,
    at.day!,
    at.hour! % 24,
    at.minute!,
    at.second!,
  );
  return asIfUtc - date.getTime();
}

/** The instant at which a local wall-clock date begins, in the given zone. */
function zonedStart(year: number, month: number, timeZone: string): Date {
  const wallClock = Date.UTC(year, month - 1, 1, 0, 0, 0);

  // Correct the naive guess by the zone's offset, then check the offset again:
  // near a DST transition the correction can land on the other side of it.
  const firstGuess = wallClock - offsetMs(new Date(wallClock), timeZone);
  const settled = wallClock - offsetMs(new Date(firstGuess), timeZone);

  // Month boundaries are never inside a DST gap — European transitions happen
  // at 02:00/03:00 on a Sunday in March and October, never at midnight on the
  // 1st — so one correction always converges.
  return new Date(settled);
}

export interface MonthRange {
  /** Inclusive: the instant the local month begins. */
  from: Date;
  /** Exclusive: the instant the NEXT local month begins. */
  to: Date;
}

/**
 * Half-open range of instants covered by a `YYYY-MM` in the given zone.
 *
 * Returned as instants rather than as a SQL expression on purpose: the query
 * stays a plain range over `started_at`, so the existing index still applies,
 * and the boundary arithmetic can be tested without a database.
 */
export function monthRangeOf(month: string, timeZone: string = AMSTERDAM): MonthRange | null {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return null;

  const year = Number(match[1]);
  const m = Number(match[2]);
  if (m < 1 || m > 12) return null;

  return {
    from: zonedStart(year, m, timeZone),
    to: zonedStart(m === 12 ? year + 1 : year, m === 12 ? 1 : m + 1, timeZone),
  };
}
