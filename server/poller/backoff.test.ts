import { describe, expect, it } from 'vitest';

import { classify, reactionFor, retryDelayMs } from './backoff.js';

describe('classify', () => {
  it('treats an auth error as auth regardless of status', () => {
    expect(classify(429, true)).toBe('auth');
    expect(classify(null, true)).toBe('auth');
  });

  it('recognises a rate limit', () => {
    expect(classify(429, false)).toBe('rate_limit');
  });

  it('treats 5xx and network-level failures as transient', () => {
    expect(classify(503, false)).toBe('transient');
    expect(classify(null, false)).toBe('transient');
  });

  it('does not treat an ordinary 4xx as transient', () => {
    expect(classify(404, false)).toBe('unknown');
  });
});

describe('reactionFor', () => {
  it('stops entirely on auth, and never retries', () => {
    const r = reactionFor('auth');
    expect(r.stop).toBe(true);
    expect(r.retriesInCycle).toBe(0);
    expect(r.health).toBe('broken');
  });

  it('backs off about an hour on a rate limit without retrying in-cycle', () => {
    const r = reactionFor('rate_limit');
    expect(r.skipIntervals).toBe(4);
    expect(r.retriesInCycle).toBe(0);
    expect(r.stop).toBe(false);
  });

  it('retries in-cycle for transient failures but does not skip intervals', () => {
    const r = reactionFor('transient');
    expect(r.retriesInCycle).toBe(3);
    expect(r.skipIntervals).toBe(0);
  });

  it('never marks health healthy for any failure', () => {
    for (const cause of ['rate_limit', 'transient', 'auth', 'unknown'] as const) {
      expect(reactionFor(cause).health).not.toBe('healthy');
    }
  });
});

describe('retryDelayMs', () => {
  it('grows exponentially', () => {
    expect([0, 1, 2].map(retryDelayMs)).toEqual([1000, 2000, 4000]);
  });
});
