import { describe, expect, it } from 'vitest';

import { parseEnv } from './env.js';

const minimal = { DATABASE_URL: 'postgres://u:p@localhost:5432/db' };

describe('parseEnv', () => {
  it('requires DATABASE_URL', () => {
    expect(() => parseEnv({})).toThrow(/DATABASE_URL/);
  });

  it('defaults the port and poll interval', () => {
    const env = parseEnv(minimal);
    expect(env.port).toBe(3001);
    expect(env.pollIntervalMinutes).toBe(15);
  });

  it('treats an unset NODE_ENV as development, not production', () => {
    expect(parseEnv(minimal).isProduction).toBe(false);
    expect(parseEnv({ ...minimal, NODE_ENV: 'production' }).isProduction).toBe(true);
  });

  it('rejects a non-numeric integer rather than silently using NaN', () => {
    expect(() => parseEnv({ ...minimal, PORT: '3001abc' })).toThrow(/must be an integer/);
    expect(() => parseEnv({ ...minimal, PORT: '' })).not.toThrow();
  });

  it('treats a missing or blank Google key as absent rather than failing', () => {
    // Place suggestions need it; nothing else does, so a missing key must not
    // stop the container from starting.
    expect(parseEnv(minimal).googleMapsApiKey).toBeNull();
    expect(parseEnv({ ...minimal, GOOGLE_MAPS_API_KEY: '   ' }).googleMapsApiKey).toBeNull();
    expect(parseEnv({ ...minimal, GOOGLE_MAPS_API_KEY: 'AIzaTest' }).googleMapsApiKey).toBe('AIzaTest');
  });

  it('rejects a poll interval below one minute', () => {
    expect(() => parseEnv({ ...minimal, POLL_INTERVAL_MINUTES: '0' })).toThrow(/at least 1/);
  });
});
