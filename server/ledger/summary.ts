/**
 * The monthly figure (#14).
 *
 * Pure, because this is the number that becomes money. #9 put it in the
 * must-test set, and a rule that decides what you bill should be provable
 * without standing up a database.
 */

export interface SummarisableTrip {
  distanceKm: number;
  /** Null when unchecked. Anything else means a human verified this row. */
  checkedAt: Date | string | null;
  /** The billing selection — a deliberate act, and the only selector. */
  invoiceMonthly: boolean;
  /** Tax classification. Present for the unclassified count ONLY; it does not select. */
  purpose: 'business' | 'private' | null;
  startPlaceId: number | null;
  endPlaceId: number | null;
}

export interface LedgerSummary {
  trips: number;
  totalKm: number;
  /** Checked AND flagged. Two conditions, not three. */
  invoiceableKm: number;
  unchecked: number;
  /** Flagged for billing but not yet checked — excluded, and excluded loudly. */
  uncheckedFlagged: number;
  /** The kilometres those trips represent. The count alone does not say whether it matters. */
  uncheckedFlaggedKm: number;
  unclassified: number;
  unplaced: number;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

/**
 * Two conditions, not three: `checked AND invoiceMonthly`.
 *
 * `purpose` is deliberately NOT part of this. The flag is the billing
 * selection — something you chose — while purpose is tax classification.
 * While both were in the filter they could disagree, and when they did the
 * trip vanished from the figure with no visible cause. A trip you flagged but
 * classified privé still counts; the misclassification then shows up AS a
 * misclassification rather than as a quietly smaller number.
 *
 * `checked` stays required: nothing unverified reaches a billing total.
 */
export function summarise(trips: readonly SummarisableTrip[]): LedgerSummary {
  const checked = (t: SummarisableTrip): boolean => t.checkedAt !== null;

  const invoiceable = trips.filter((t) => checked(t) && t.invoiceMonthly);
  const flaggedButUnchecked = trips.filter((t) => !checked(t) && t.invoiceMonthly);

  return {
    trips: trips.length,
    totalKm: round1(trips.reduce((sum, t) => sum + t.distanceKm, 0)),
    invoiceableKm: round1(invoiceable.reduce((sum, t) => sum + t.distanceKm, 0)),
    unchecked: trips.filter((t) => !checked(t)).length,
    uncheckedFlagged: flaggedButUnchecked.length,
    uncheckedFlaggedKm: round1(flaggedButUnchecked.reduce((sum, t) => sum + t.distanceKm, 0)),
    unclassified: trips.filter((t) => t.purpose === null).length,
    unplaced: trips.filter((t) => t.startPlaceId === null || t.endPlaceId === null).length,
  };
}
