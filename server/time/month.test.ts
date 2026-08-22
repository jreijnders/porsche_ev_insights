import { describe, expect, it } from 'vitest';

import { AMSTERDAM, monthKeyOf, monthRangeOf } from './month.js';

const at = (iso: string) => new Date(iso);

describe('monthRangeOf — the boundary is local midnight', () => {
  it('starts a summer month at 22:00 UTC the previous day (CEST, +2)', () => {
    const range = monthRangeOf('2026-08');
    expect(range?.from.toISOString()).toBe('2026-07-31T22:00:00.000Z');
    expect(range?.to.toISOString()).toBe('2026-08-31T22:00:00.000Z');
  });

  it('starts a winter month at 23:00 UTC the previous day (CET, +1)', () => {
    const range = monthRangeOf('2026-02');
    expect(range?.from.toISOString()).toBe('2026-01-31T23:00:00.000Z');
    expect(range?.to.toISOString()).toBe('2026-02-28T23:00:00.000Z');
  });

  it('rolls the year over in December', () => {
    const range = monthRangeOf('2026-12');
    expect(range?.from.toISOString()).toBe('2026-11-30T23:00:00.000Z');
    expect(range?.to.toISOString()).toBe('2026-12-31T23:00:00.000Z');
  });

  it('spans a month that contains the spring DST transition', () => {
    // March 2026 begins in CET (+1) and ends in CEST (+2).
    const range = monthRangeOf('2026-03');
    expect(range?.from.toISOString()).toBe('2026-02-28T23:00:00.000Z');
    expect(range?.to.toISOString()).toBe('2026-03-31T22:00:00.000Z');
  });

  it('spans a month that contains the autumn DST transition', () => {
    // October 2026 begins in CEST (+2) and ends in CET (+1).
    const range = monthRangeOf('2026-10');
    expect(range?.from.toISOString()).toBe('2026-09-30T22:00:00.000Z');
    expect(range?.to.toISOString()).toBe('2026-10-31T23:00:00.000Z');
  });

  it('rejects nonsense rather than guessing', () => {
    expect(monthRangeOf('2026-13')).toBeNull();
    expect(monthRangeOf('2026-00')).toBeNull();
    expect(monthRangeOf('not-a-month')).toBeNull();
    expect(monthRangeOf('2026-8')).toBeNull();
  });

  it('honours a different zone when asked', () => {
    expect(monthRangeOf('2026-08', 'UTC')?.from.toISOString()).toBe('2026-08-01T00:00:00.000Z');
  });
});

describe('the defect this exists to fix', () => {
  it('puts a trip starting 00:40 CEST on the 1st in the NEW month', () => {
    // 2026-08-31T22:40Z is 00:40 on 1 September in Amsterdam. Date.UTC put it
    // in August; that is the bug (#14).
    const trip = at('2026-08-31T22:40:00.000Z');

    const august = monthRangeOf('2026-08')!;
    const september = monthRangeOf('2026-09')!;

    expect(trip >= august.from && trip < august.to).toBe(false);
    expect(trip >= september.from && trip < september.to).toBe(true);
    expect(monthKeyOf(trip)).toBe('2026-09');
  });

  it('still puts 23:40 on the last day in the OLD month', () => {
    const trip = at('2026-08-31T21:40:00.000Z'); // 23:40 local on 31 August
    const august = monthRangeOf('2026-08')!;
    expect(trip >= august.from && trip < august.to).toBe(true);
    expect(monthKeyOf(trip)).toBe('2026-08');
  });

  it('does the same in winter, where the offset is one hour not two', () => {
    const trip = at('2026-12-31T23:30:00.000Z'); // 00:30 on 1 January locally
    expect(monthKeyOf(trip)).toBe('2027-01');
    const january = monthRangeOf('2027-01')!;
    expect(trip >= january.from && trip < january.to).toBe(true);
  });
});

describe('monthKeyOf and monthRangeOf agree', () => {
  // They are two views of one boundary. If they ever disagree, a trip is listed
  // in one month and reconciled in another — the failure this module prevents.
  const samples = [
    '2026-01-01T00:00:00Z',
    '2026-02-28T23:00:00Z',
    '2026-03-28T23:00:00Z',
    '2026-03-29T01:00:00Z',
    '2026-06-30T22:00:00Z',
    '2026-07-31T21:59:59Z',
    '2026-07-31T22:00:00Z',
    '2026-10-25T00:30:00Z',
    '2026-12-31T22:59:59Z',
    '2026-12-31T23:00:00Z',
  ];

  it.each(samples)('%s falls inside the range of its own month key', (iso) => {
    const instant = at(iso);
    const key = monthKeyOf(instant);
    const range = monthRangeOf(key);
    expect(range).not.toBeNull();
    expect(instant >= range!.from).toBe(true);
    expect(instant < range!.to).toBe(true);
  });

  it('uses the exported zone constant', () => {
    expect(AMSTERDAM).toBe('Europe/Amsterdam');
  });
});
