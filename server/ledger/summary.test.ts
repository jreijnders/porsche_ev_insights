import { describe, expect, it } from 'vitest';

import { summarise, type SummarisableTrip } from './summary.js';

const CHECKED = new Date('2026-08-22T10:00:00Z');

function trip(over: Partial<SummarisableTrip> = {}): SummarisableTrip {
  return {
    distanceKm: 10,
    checkedAt: null,
    invoiceMonthly: false,
    purpose: null,
    startPlaceId: 1,
    endPlaceId: 2,
    ...over,
  };
}

describe('invoiceableKm — two conditions, not three', () => {
  it('counts a trip that is checked and flagged', () => {
    const s = summarise([trip({ checkedAt: CHECKED, invoiceMonthly: true, distanceKm: 42 })]);
    expect(s.invoiceableKm).toBe(42);
  });

  it('counts a checked, flagged trip classified PRIVÉ', () => {
    // The rule that changed in #14. Purpose is tax classification, not billing
    // selection — a flagged trip counts however it is classified, and the
    // misclassification shows up as one instead of silently shrinking the figure.
    const s = summarise([
      trip({ checkedAt: CHECKED, invoiceMonthly: true, purpose: 'private', distanceKm: 30 }),
    ]);
    expect(s.invoiceableKm).toBe(30);
  });

  it('counts a checked, flagged trip with no classification at all', () => {
    const s = summarise([
      trip({ checkedAt: CHECKED, invoiceMonthly: true, purpose: null, distanceKm: 25 }),
    ]);
    expect(s.invoiceableKm).toBe(25);
  });

  it('excludes a checked BUSINESS trip that was not flagged', () => {
    // Being business is not a billing decision. The flag is.
    const s = summarise([
      trip({ checkedAt: CHECKED, invoiceMonthly: false, purpose: 'business', distanceKm: 99 }),
    ]);
    expect(s.invoiceableKm).toBe(0);
  });

  it('excludes a flagged trip that has not been checked', () => {
    const s = summarise([trip({ checkedAt: null, invoiceMonthly: true, distanceKm: 47 })]);
    expect(s.invoiceableKm).toBe(0);
  });

  it('is zero for an empty month rather than undefined', () => {
    expect(summarise([]).invoiceableKm).toBe(0);
  });

  it('sums only the qualifying trips out of a mixed month', () => {
    const s = summarise([
      trip({ checkedAt: CHECKED, invoiceMonthly: true, distanceKm: 100 }),
      trip({ checkedAt: CHECKED, invoiceMonthly: true, distanceKm: 50, purpose: 'private' }),
      trip({ checkedAt: CHECKED, invoiceMonthly: false, distanceKm: 999 }),
      trip({ checkedAt: null, invoiceMonthly: true, distanceKm: 999 }),
    ]);
    expect(s.invoiceableKm).toBe(150);
    expect(s.totalKm).toBe(2148);
  });
});

describe('the unchecked warning carries kilometres', () => {
  it('reports the count AND the distance of flagged-but-unchecked trips', () => {
    const s = summarise([
      trip({ checkedAt: null, invoiceMonthly: true, distanceKm: 40 }),
      trip({ checkedAt: null, invoiceMonthly: true, distanceKm: 7 }),
      trip({ checkedAt: CHECKED, invoiceMonthly: true, distanceKm: 100 }),
    ]);
    expect(s.uncheckedFlagged).toBe(2);
    expect(s.uncheckedFlaggedKm).toBe(47);
    expect(s.invoiceableKm).toBe(100);
  });

  it('matches the sum of exactly those trips and no others', () => {
    // An unchecked but UNFLAGGED trip is not pending billing work, so it must
    // not inflate the warning.
    const s = summarise([
      trip({ checkedAt: null, invoiceMonthly: true, distanceKm: 40 }),
      trip({ checkedAt: null, invoiceMonthly: false, distanceKm: 500 }),
    ]);
    expect(s.uncheckedFlagged).toBe(1);
    expect(s.uncheckedFlaggedKm).toBe(40);
    expect(s.unchecked).toBe(2);
  });

  it('is zero when everything flagged has been checked', () => {
    const s = summarise([trip({ checkedAt: CHECKED, invoiceMonthly: true, distanceKm: 10 })]);
    expect(s.uncheckedFlagged).toBe(0);
    expect(s.uncheckedFlaggedKm).toBe(0);
  });

  it('rounds to one decimal rather than trailing float noise', () => {
    const s = summarise([
      trip({ checkedAt: null, invoiceMonthly: true, distanceKm: 0.1 }),
      trip({ checkedAt: null, invoiceMonthly: true, distanceKm: 0.2 }),
    ]);
    expect(s.uncheckedFlaggedKm).toBe(0.3);
  });
});

describe('the other counters', () => {
  it('counts unclassified trips by purpose being absent', () => {
    const s = summarise([trip({ purpose: null }), trip({ purpose: 'business' })]);
    expect(s.unclassified).toBe(1);
  });

  it('counts a trip missing either endpoint as unplaced', () => {
    const s = summarise([
      trip({ startPlaceId: null }),
      trip({ endPlaceId: null }),
      trip({ startPlaceId: null, endPlaceId: null }),
      trip(),
    ]);
    expect(s.unplaced).toBe(3);
  });

  it('accepts a checkedAt that arrived as a string from JSON', () => {
    const s = summarise([
      { ...trip({ invoiceMonthly: true, distanceKm: 12 }), checkedAt: '2026-08-22T10:00:00Z' },
    ]);
    expect(s.invoiceableKm).toBe(12);
  });
});
