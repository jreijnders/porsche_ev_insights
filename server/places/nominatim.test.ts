import { describe, expect, it } from 'vitest';

import { formatAddress } from './nominatim.js';

describe('formatAddress', () => {
  it('composes the line the five real probe responses would produce', () => {
    // Captured from live Nominatim calls on the same five Spaanse Polder
    // coordinates #5 and #16 measured (#30). These are the shapes that
    // actually come back, not invented ones.
    expect(
      formatAddress({ road: 'Groothandelsmarkt', house_number: '152', postcode: '3044 HE', city: 'Rotterdam' }),
    ).toBe('Groothandelsmarkt 152, 3044 HE Rotterdam');
    expect(formatAddress({ road: 'Giessenweg', house_number: '5', postcode: '3044 AK', city: 'Rotterdam' })).toBe(
      'Giessenweg 5, 3044 AK Rotterdam',
    );
  });

  it('handles the one probe spot with no house number', () => {
    // Spaanse Polder W landed on a charging-station node, which has a road but
    // no number. A street plus postcode is still recognisable; dropping the
    // whole line because one field is missing would not be.
    expect(formatAddress({ road: 'Overschieseweg', postcode: '3044 GA', city: 'Rotterdam' })).toBe(
      'Overschieseweg, 3044 GA Rotterdam',
    );
  });

  it('falls back through the city-name variants OSM actually uses', () => {
    expect(formatAddress({ road: 'Dorpsstraat', house_number: '1', town: 'Renswoude' })).toBe('Dorpsstraat 1, Renswoude');
    expect(formatAddress({ road: 'Kerkweg', village: 'Ransdorp' })).toBe('Kerkweg, Ransdorp');
  });

  it('returns null rather than an empty or comma-only string', () => {
    // The caller treats null as "show the coordinate instead". A "" or a ", "
    // would render as a blank address line that looks like a bug.
    expect(formatAddress({})).toBeNull();
    expect(formatAddress({ postcode: undefined, city: undefined })).toBeNull();
  });

  it('never emits a dangling separator when only one half is known', () => {
    expect(formatAddress({ road: 'Keenstraat', house_number: '8' })).toBe('Keenstraat 8');
    expect(formatAddress({ postcode: '3044 CD', city: 'Rotterdam' })).toBe('3044 CD Rotterdam');
  });
});
