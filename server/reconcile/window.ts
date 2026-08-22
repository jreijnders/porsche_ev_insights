/**
 * Odometer reconciliation (#12) — is the ledger complete?
 *
 * Between two consecutive odometer readings the car drove a known number of
 * kilometres. Everything logged in that span should add up to it. What is left
 * over is either a trip that never arrived or a trip counted twice, and those
 * are different problems pointing in opposite directions.
 *
 * Reconciled BETWEEN READINGS, never within a calendar month. A month's
 * min/max drops every kilometre driven between one month's last reading and
 * the next month's first — invisibly, and always in the direction that makes
 * the ledger look complete when it is not.
 *
 * Pure. The database half lives in service.ts.
 */

import { AMSTERDAM, monthKeyOf } from '../time/month.js';

export interface Reading {
  at: Date;
  mileageKm: number;
}

export interface TripSpan {
  id: number;
  endedAt: Date;
  distanceKm: number;
}

export type Verdict =
  /** Inside tolerance. Nothing to see. */
  | 'quiet'
  /** Odometer ran ahead of the ledger — a trip is probably missing. */
  | 'unaccounted'
  /** The ledger ran ahead of the odometer — a duplicate, and it is in your figure. */
  | 'over_logged'
  /** Too recent to judge. NOT a clean result. */
  | 'settling';

export interface ReconWindow {
  fromAt: Date;
  toAt: Date;
  fromKm: number;
  toKm: number;
  /** What the odometer says was driven. */
  odometerDeltaKm: number;
  /** What the ledger accounts for. */
  loggedKm: number;
  /** odometer − logged. Signed, deliberately: the sign IS the diagnosis. */
  differenceKm: number;
  tripCount: number;
  toleranceKm: number;
  verdict: Verdict;
}

/**
 * How far apart the two figures may drift before it means anything.
 *
 * Scales with the NUMBER OF TRIPS, not with distance. The API reports whole
 * kilometres (#15 probe), so every trip carries up to half a kilometre of
 * rounding; twenty short trips can drift further than one long one. A floor of
 * 2 km keeps a window with one or two trips from being flagged over nothing.
 */
export function toleranceFor(tripCount: number): number {
  return Math.max(2, 0.5 * tripCount);
}

/**
 * Trips belonging to a window: (fromAt, toAt].
 *
 * Half-open on purpose. A trip that ends exactly on a reading must land in
 * exactly one window — closed at both ends would count it twice, and the
 * duplicate would show up as `over_logged` in one window and `unaccounted` in
 * the next, i.e. two invented problems from one arithmetic choice.
 */
function tripsInWindow(trips: readonly TripSpan[], fromAt: Date, toAt: Date): TripSpan[] {
  return trips.filter((t) => t.endedAt.getTime() > fromAt.getTime() && t.endedAt.getTime() <= toAt.getTime());
}

export interface BuildOptions {
  readings: readonly Reading[];
  trips: readonly TripSpan[];
  /**
   * The end of the newest trip the ledger holds. A window is only judgeable
   * once a trip LATER than it exists — that is what proves history has moved
   * past the window, rather than the window merely being old.
   */
  latestTripEndedAt: Date | null;
}

export function buildWindows({ readings, trips, latestTripEndedAt }: BuildOptions): ReconWindow[] {
  // Sorted, never assumed sorted — consecutive pairs are the whole method, so
  // order is correctness rather than tidiness here.
  const sorted = [...readings].sort((a, b) => a.at.getTime() - b.at.getTime());
  const windows: ReconWindow[] = [];

  for (let i = 0; i + 1 < sorted.length; i += 1) {
    const from = sorted[i]!;
    const to = sorted[i + 1]!;

    const inWindow = tripsInWindow(trips, from.at, to.at);
    const loggedKm = inWindow.reduce((sum, t) => sum + t.distanceKm, 0);
    const odometerDeltaKm = to.mileageKm - from.mileageKm;
    const differenceKm = odometerDeltaKm - loggedKm;
    const toleranceKm = toleranceFor(inWindow.length);

    // Settling is structural, not a time delay: a window whose far edge is the
    // newest thing we know about may simply be waiting for its trips to arrive.
    // Trip history lags the drive, so judging it now would report a missing
    // trip that is merely late.
    const judgeable = latestTripEndedAt !== null && latestTripEndedAt.getTime() > to.at.getTime();

    let verdict: Verdict;
    if (!judgeable) verdict = 'settling';
    else if (Math.abs(differenceKm) <= toleranceKm) verdict = 'quiet';
    else if (differenceKm > 0) verdict = 'unaccounted';
    else verdict = 'over_logged';

    windows.push({
      fromAt: from.at,
      toAt: to.at,
      fromKm: from.mileageKm,
      toKm: to.mileageKm,
      odometerDeltaKm: round1(odometerDeltaKm),
      loggedKm: round1(loggedKm),
      differenceKm: round1(differenceKm),
      tripCount: inWindow.length,
      toleranceKm,
      verdict,
    });
  }

  return windows;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

/* ------------------------------------------------------------ month rollup */

export type MonthStatus =
  | 'quiet'
  | 'unaccounted'
  | 'over_logged'
  | 'settling'
  /** No odometer coverage at all — never a number implying it was checked. */
  | 'not_reconcilable'
  /** Odometer coverage began part-way through this month. */
  | 'partial';

export interface MonthReconciliation {
  status: MonthStatus;
  /** Sum of positive differences — kilometres the odometer saw and the ledger did not. */
  unaccountedKm: number;
  /** Sum of negative differences, as a positive number — kilometres logged twice. */
  overLoggedKm: number;
  windows: ReconWindow[];
  /** When odometer coverage starts, for a partial month. */
  coverageFrom: Date | null;
  /** Windows too recent to judge. */
  settlingCount: number;
}

/** A window belongs to the month of its LATER reading. */
export function reconcileMonth(
  month: string,
  windows: readonly ReconWindow[],
  earliestReadingAt: Date | null,
  timeZone: string = AMSTERDAM,
): MonthReconciliation {
  const mine = windows.filter((w) => monthKeyOf(w.toAt, timeZone) === month);

  // No odometer readings at all, or the first one lands after this month ends:
  // there is nothing to reconcile against, and reporting 0 km unaccounted would
  // claim the month was checked and found complete.
  if (earliestReadingAt === null || monthKeyOf(earliestReadingAt, timeZone) > month) {
    return {
      status: 'not_reconcilable',
      unaccountedKm: 0,
      overLoggedKm: 0,
      windows: [],
      coverageFrom: null,
      settlingCount: 0,
    };
  }

  const judged = mine.filter((w) => w.verdict !== 'settling');
  const unaccountedKm = round1(
    judged.filter((w) => w.verdict === 'unaccounted').reduce((s, w) => s + w.differenceKm, 0),
  );
  const overLoggedKm = round1(
    judged.filter((w) => w.verdict === 'over_logged').reduce((s, w) => s - w.differenceKm, 0),
  );
  const settlingCount = mine.filter((w) => w.verdict === 'settling').length;

  // Coverage began inside this month, so the earlier part of it is unverified
  // however clean the windows that do exist look.
  const partial = monthKeyOf(earliestReadingAt, timeZone) === month;

  let status: MonthStatus;
  if (mine.length === 0) status = partial ? 'partial' : 'not_reconcilable';
  else if (overLoggedKm > 0) status = 'over_logged';
  else if (unaccountedKm > 0) status = 'unaccounted';
  else if (settlingCount === mine.length) status = 'settling';
  else if (partial) status = 'partial';
  else status = 'quiet';

  return {
    status,
    unaccountedKm,
    overLoggedKm,
    windows: [...mine],
    coverageFrom: partial ? earliestReadingAt : null,
    settlingCount,
  };
}
