import { describe, expect, it } from 'vitest';

import { formatDuration, formatKm, formatMonth, isCheckable } from './format';

describe('formatDuration', () => {
  it('shows minutes only under an hour', () => {
    expect(formatDuration(29)).toBe('29m');
  });

  it('splits hours and minutes', () => {
    expect(formatDuration(175)).toBe('2u 55m');
  });

  it('renders a whole number of hours without stray minutes', () => {
    expect(formatDuration(120)).toBe('2u 0m');
  });

  it('shows an en dash when there is no driving time rather than 0m', () => {
    // Null means "the API did not say", which is not the same as zero.
    expect(formatDuration(null)).toBe('–');
  });
});

describe('formatKm', () => {
  it('omits a decimal for whole kilometres, which is what the API gives', () => {
    expect(formatKm(141)).toBe('141 km');
  });

  it('keeps one decimal when there is a fraction (manual entry, merges)', () => {
    expect(formatKm(12.5)).toBe('12,5 km');
  });

  it('groups thousands', () => {
    expect(formatKm(1014)).toBe('1.014 km');
  });
});

describe('formatMonth', () => {
  it('names the month rather than showing a number', () => {
    expect(formatMonth('2026-08').toLowerCase()).toContain('augustus');
    expect(formatMonth('2026-08')).toContain('2026');
  });

  it('does not drift a month at a UTC boundary', () => {
    // A naive local-time construction can land in December of the prior year.
    expect(formatMonth('2026-01').toLowerCase()).toContain('januari');
    expect(formatMonth('2026-01')).toContain('2026');
  });
});

describe('isCheckable', () => {
  it('allows checking a closed trip', () => {
    expect(isCheckable('closed')).toBe(true);
  });

  it('refuses a provisional trip, which may still absorb another leg', () => {
    expect(isCheckable('provisional')).toBe(false);
  });
});
