/**
 * Per-cause failure handling (#13). Pure, so the policy is testable without
 * waiting 15 minutes to find out what it does.
 */

export type FailureCause = 'rate_limit' | 'transient' | 'auth' | 'unknown';

export interface Reaction {
  /** Intervals to skip before polling again. */
  skipIntervals: number;
  /** Retry attempts within this cycle. */
  retriesInCycle: number;
  /** Stop the loop entirely — only re-authentication restarts it. */
  stop: boolean;
  health: 'healthy' | 'degraded' | 'broken';
}

export function classify(status: number | null, isAuthError: boolean): FailureCause {
  if (isAuthError) return 'auth';
  if (status === 429) return 'rate_limit';
  if (status !== null && status >= 500) return 'transient';
  if (status === null) return 'transient'; // network-level failure
  return 'unknown';
}

export function reactionFor(cause: FailureCause): Reaction {
  switch (cause) {
    case 'rate_limit':
      // Back off hard: a Porsche block is expensive and needs a hand-solved
      // captcha to clear, so an hour of silence is cheap by comparison (#4).
      return { skipIntervals: 4, retriesInCycle: 0, stop: false, health: 'degraded' };
    case 'transient':
      return { skipIntervals: 0, retriesInCycle: 3, stop: false, health: 'degraded' };
    case 'auth':
      // Never retried. A login retry loop is what got a documented Porsche
      // account blocked.
      return { skipIntervals: 0, retriesInCycle: 0, stop: true, health: 'broken' };
    case 'unknown':
      return { skipIntervals: 1, retriesInCycle: 0, stop: false, health: 'degraded' };
  }
}

/** Exponential backoff for in-cycle retries: 1s, 2s, 4s. */
export function retryDelayMs(attempt: number): number {
  return 1000 * 2 ** attempt;
}
