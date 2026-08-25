/**
 * Trip ledger — the rittenregistratie view. Prototype for #21.
 *
 * Shape decided on that ticket: two-line rows, a sticky month header, and
 * uncertainty marked inline rather than hidden.
 *
 * Control is by POINTER (#30), reversing that ticket's keyboard-driven
 * decision. The shortcuts were removed rather than kept alongside: two paths
 * to every action is two things to keep in sync and two ways for them to
 * disagree.
 *
 * Checking stays one deliberate act per row. There is no select-all, because
 * bulk-checking is a way to verify nothing while marking everything verified,
 * and #14 makes the checked flag the thing that lets a kilometre count.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import NamePlacePanel, { type NamingEvidence } from '../places/NamePlacePanel';

import { formatDay, formatDuration, formatKm, formatMonth, formatTime, isCheckable } from './format';
import type { LedgerTrip, MonthIndexEntry, MonthPayload, PlaceConfidence, Purpose, Reconciliation } from './types';

const API = '/api/ledger';
const PLACES = '/api/places';

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Request failed (${response.status})`);
  }
  return (await response.json()) as T;
}

export default function LedgerPage() {
  const [months, setMonths] = useState<MonthIndexEntry[]>([]);
  const [month, setMonth] = useState<string | null>(null);
  const [data, setData] = useState<MonthPayload | null>(null);
  /** Which row is expanded. A click, not a cursor — nothing navigates now. */
  const [expanded, setExpanded] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Which row has its naming panel open, and the evidence fetched for it. */
  const [namingTripId, setNamingTripId] = useState<number | null>(null);
  const [naming, setNaming] = useState<NamingEvidence | null>(null);

  useEffect(() => {
    json<{ months: MonthIndexEntry[] }>(`${API}/months`)
      .then((r) => {
        setMonths(r.months);
        setMonth((current) => current ?? r.months[0]?.month ?? null);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const load = useCallback(async (target: string) => {
    try {
      setData(await json<MonthPayload>(`${API}/month/${target}`));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    if (month) void load(month);
  }, [month, load]);

  const trips = data?.trips ?? [];

  // A month change or a merge can remove the expanded row out from under us.
  useEffect(() => {
    if (expanded !== null && expanded >= trips.length) setExpanded(null);
  }, [trips.length, expanded]);

  const patch = useCallback(
    async (trip: LedgerTrip, body: Record<string, unknown>) => {
      setBusy(true);
      try {
        await json(`${API}/trip/${trip.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (month) await load(month);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [month, load],
  );

  const mergePrevious = useCallback(
    async (trip: LedgerTrip) => {
      setBusy(true);
      try {
        await json(`${API}/trip/${trip.id}/merge-previous`, { method: 'POST' });
        if (month) await load(month);
        setExpanded(null);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [month, load],
  );

  /**
   * Open the naming panel for a trip (#30).
   *
   * One call fetches the whole panel — arrival coordinate, Nominatim address
   * and nearby known places — because the panel opens INLINE in the row, and
   * filling it in stages would make the row grow under the pointer while you
   * are aiming at it.
   *
   * Replaces the two chained window.prompts the prototype used, which could
   * ask for a name but could never show you that the place you meant already
   * exists 240 m away.
   */
  const openNaming = useCallback(async (trip: LedgerTrip) => {
    setNamingTripId(trip.id);
    setNaming(null);
    try {
      setNaming(await json<NamingEvidence>(`${PLACES}/naming/${trip.id}`));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
      setNamingTripId(null);
    }
  }, []);

  const closeNaming = useCallback(() => {
    setNamingTripId(null);
    setNaming(null);
  }, []);

  /** Create the place the panel was opened for, from the trip's own fix. */
  const createPlace = useCallback(
    async (tripId: number, input: { label: string; kind: string; googlePlaceId: string | null }) => {
      setBusy(true);
      try {
        await json(`${PLACES}/from-trip/${tripId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        });
        closeNaming();
        if (month) await load(month);
        setError(null);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [month, load, closeNaming],
  );

  /**
   * Accept-and-widen. The server recomputes the distance and judges the size.
   *
   * `override` comes from the candidate the panel offered: above the ceiling
   * the server refuses without it (#30), so neither a stale screen nor a
   * mis-click can quietly grow a place to a kilometre.
   */
  const widenForTrip = useCallback(
    async (tripId: number, placeId: number, override: boolean) => {
      setBusy(true);
      try {
        const result = await json<{ place: { label: string } | null; widenedFrom: number; widenedTo: number; fixDistanceM: number }>(
          `${PLACES}/widen-for-trip/${tripId}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ placeId, override }),
          },
        );
        setError(
          `${result.place?.label ?? 'Locatie'} opgerekt van ${result.widenedFrom} naar ${result.widenedTo} m (fix lag op ${result.fixDistanceM} m).`,
        );
        closeNaming();
        if (month) await load(month);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [month, load, closeNaming],
  );

  const acknowledgeGap = useCallback(
    async (fromAt: string, toAt: string, km: number) => {
      if (!window.confirm(`${km} km als handmatige rit toevoegen om dit gat te erkennen?`)) return;
      setBusy(true);
      try {
        const result = await json<{ tripId: number; distanceKm: number }>(`${API}/acknowledge-gap`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fromAt, toAt }),
        });
        setError(`Gat erkend: rit ${result.tripId} toegevoegd met ${result.distanceKm} km.`);
        if (month) await load(month);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [month, load],
  );

  /** Re-run matching over every unchecked trip. */
  const rematch = useCallback(async () => {
    setBusy(true);
    try {
      const { summary } = await json<{ summary: { placed: number; ambiguous: number; unmatched: number; preTracking: number } }>(
        `${PLACES}/rematch`,
        { method: 'POST' },
      );
      setError(
        `Opnieuw gematcht: ${summary.placed} geplaatst, ${summary.ambiguous} twijfelachtig, ${summary.unmatched} zonder locatie, ${summary.preTracking} van vóór de locatieregistratie.`,
      );
      if (month) await load(month);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [month, load]);

  /**
   * Check or uncheck a trip.
   *
   * The one action with a guard in front of it: a provisional trip may still
   * absorb another leg (#8), so checking it would verify a row that is about
   * to change. The refusal is stated rather than the control being hidden,
   * because "why can't I check this?" is the question a hidden button leaves.
   */
  const toggleChecked = useCallback(
    (trip: LedgerTrip) => {
      if (!isCheckable(trip.status)) {
        setError('Een voorlopige rit kan niet gecontroleerd worden — er kan nog een traject bij komen.');
        return;
      }
      void patch(trip, { checked: trip.checkedAt === null });
    },
    [patch],
  );

  const summary = data?.summary;
  const progress = useMemo(() => {
    if (!summary) return null;
    return `${summary.trips - summary.unchecked} of ${summary.trips} checked`;
  }, [summary]);

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <div className="mx-auto max-w-4xl px-4 py-6">
        <header className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="text-xl font-semibold tracking-tight">
            Rittenregistratie{' '}
            <a href="/places" className="text-sm font-normal text-zinc-500 underline-offset-2 hover:underline">
              locatieboek →
            </a>
          </h1>
          <select
            value={month ?? ''}
            onChange={(e) => { setMonth(e.target.value); setExpanded(null); closeNaming(); }}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          >
            {months.map((m) => (
              <option key={m.month} value={m.month}>
                {formatMonth(m.month)} — {m.trips} ritten{m.unchecked > 0 ? ` (${m.unchecked} ongecontroleerd)` : ''}
              </option>
            ))}
          </select>
        </header>

        {error && (
          <div className="mb-4 rounded-lg border border-amber-400/60 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-200">
            {error}
          </div>
        )}

        {summary && month && (
          <div className="sticky top-0 z-10 mb-3 rounded-xl border border-zinc-200 bg-white/95 p-4 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95">
            <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
              <div className="text-sm font-medium">{formatMonth(month)}</div>
              <Metric label="totaal" value={formatKm(summary.totalKm)} />
              <Metric label="te factureren" value={formatKm(summary.invoiceableKm)} strong />
              {summary.uncheckedFlagged > 0 && (
                <Warn>
                  {summary.uncheckedFlagged} gemarkeerd maar ongecontroleerd — {summary.uncheckedFlaggedKm} km niet
                  meegeteld
                </Warn>
              )}
              {summary.unchecked > summary.uncheckedFlagged && (
                <span className="text-xs text-zinc-500">
                  {summary.unchecked - summary.uncheckedFlagged} overig ongecontroleerd
                </span>
              )}
              {summary.unplaced > 0 && <Warn>{summary.unplaced} zonder locatie</Warn>}
              <ReconBadge recon={data?.reconciliation ?? null} readings={summary.odometerReadings} />
            </div>
            <ReconWindows
              recon={data?.reconciliation ?? null}
              busy={busy}
              onAcknowledge={acknowledgeGap}
            />
            <div className="mt-2 flex items-center gap-3 text-xs text-zinc-500">
              <span>{progress}</span>
              {/* The one month-level action. Idempotent, and it never touches a
                  checked trip (#22), so it is safe to press at any time. */}
              <button
                type="button"
                disabled={busy}
                onClick={() => void rematch()}
                className="rounded border border-zinc-300 px-2 py-0.5 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                locaties opnieuw matchen
              </button>
            </div>
          </div>
        )}

        <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {trips.map((trip, index) => (
            <TripRow
              key={trip.id}
              trip={trip}
              expanded={index === expanded}
              first={index === 0}
              busy={busy}
              trackingSince={data?.positionTrackingSince ?? null}
              onToggle={() => setExpanded((e) => (e === index ? null : index))}
              onPurpose={(purpose) => void patch(trip, { purpose })}
              onInvoice={() => void patch(trip, { invoiceMonthly: !trip.invoiceMonthly })}
              onCheck={() => toggleChecked(trip)}
              onMerge={() => void mergePrevious(trip)}
              onName={() => void openNaming(trip)}
              naming={
                namingTripId === trip.id
                  ? {
                      evidence: naming,
                      onClose: closeNaming,
                      onCreate: (input) => void createPlace(trip.id, input),
                      onWiden: (placeId, override) => void widenForTrip(trip.id, placeId, override),
                    }
                  : null
              }
            />
          ))}
          {trips.length === 0 && !error && (
            <p className="py-10 text-center text-sm text-zinc-500">Geen ritten in deze maand.</p>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Reconciliation, stated in the direction it actually fails (#12).
 *
 * The two directions are never collapsed into one "discrepancy": too FEW
 * logged kilometres costs you money, too MANY puts kilometres you did not
 * drive into a figure you invoice. And settling is never dressed up as clean —
 * "nothing wrong yet" and "not judged yet" are different claims.
 */
function ReconBadge({ recon, readings }: { recon: Reconciliation | null; readings: number }) {
  if (!recon || recon.status === 'not_reconcilable') {
    return (
      <span className="text-xs text-zinc-500" title="Zonder twee tellerstanden valt er niets te controleren">
        niet controleerbaar ({readings} tellerstanden)
      </span>
    );
  }

  switch (recon.status) {
    case 'over_logged':
      return (
        <Warn>
          {recon.overLoggedKm} km te veel geboekt — zit al in het factuurtotaal
          {recon.unaccountedKm > 0 && ` · ${recon.unaccountedKm} km niet verantwoord`}
        </Warn>
      );
    case 'unaccounted':
      return <Warn>{recon.unaccountedKm} km niet verantwoord — mogelijk een ontbrekende rit</Warn>;
    case 'settling':
      return (
        <span className="text-xs text-zinc-500" title="Nog geen latere rit die bewijst dat de historie voorbij dit venster is">
          nog niet te beoordelen ({recon.settlingCount} venster{recon.settlingCount === 1 ? '' : 's'})
        </span>
      );
    case 'partial':
      return (
        <span className="text-xs text-zinc-500">
          deels gedekt — tellerstanden vanaf {recon.coverageFrom ? formatDay(recon.coverageFrom) : '?'}
        </span>
      );
    default:
      return <span className="text-xs text-emerald-700 dark:text-emerald-400">✓ sluitend</span>;
  }
}

/**
 * The windows behind a flagged month, so a number can be traced to the span
 * that caused it rather than being a month-level verdict you cannot argue with.
 */
function ReconWindows({
  recon,
  busy,
  onAcknowledge,
}: {
  recon: Reconciliation | null;
  busy: boolean;
  onAcknowledge: (fromAt: string, toAt: string, km: number) => void;
}) {
  if (!recon || (recon.status !== 'unaccounted' && recon.status !== 'over_logged')) return null;
  const flagged = recon.windows.filter((w) => w.verdict === 'unaccounted' || w.verdict === 'over_logged');
  if (flagged.length === 0) return null;

  return (
    <div className="mt-2 space-y-1 border-t border-zinc-200 pt-2 dark:border-zinc-800">
      {flagged.map((w) => (
        <div key={`${w.fromAt}-${w.toAt}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs">
          <span className="text-zinc-500">
            {formatDay(w.fromAt)}–{formatDay(w.toAt)}
          </span>
          <span className="tabular-nums">
            teller {w.odometerDeltaKm} km · geboekt {w.loggedKm} km ({w.tripCount} ritten)
          </span>
          <span className={w.verdict === 'over_logged' ? 'font-semibold text-red-700 dark:text-red-400' : 'font-semibold text-amber-700 dark:text-amber-400'}>
            {w.differenceKm > 0 ? `+${w.differenceKm}` : w.differenceKm} km
          </span>
          <span className="text-zinc-400">tolerantie {w.toleranceKm} km</span>
          {w.verdict === 'unaccounted' && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onAcknowledge(w.fromAt, w.toAt, w.differenceKm)}
              className="rounded border border-zinc-300 px-2 py-0.5 font-sans hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              erken als rit
            </button>
          )}
          {w.verdict === 'over_logged' && (
            <span className="font-sans text-zinc-500">verwijder de dubbele rit — een handmatige rit maakt dit erger</span>
          )}
        </div>
      ))}
    </div>
  );
}

function Metric({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className={strong ? 'text-base font-semibold' : 'text-sm'}>{value}</span>
      <span className="text-xs text-zinc-500">{label}</span>
    </div>
  );
}

function Warn({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-md bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-950/60 dark:text-amber-200">
      ⚠ {children}
    </span>
  );
}

interface TripRowProps {
  trip: LedgerTrip;
  expanded: boolean;
  /** The first row of the month has nothing to merge backwards into. */
  first: boolean;
  busy: boolean;
  /** When position tracking began; trips older than this were never placeable. */
  trackingSince: string | null;
  onToggle: () => void;
  onPurpose: (purpose: Purpose | null) => void;
  onInvoice: () => void;
  onCheck: () => void;
  onMerge: () => void;
  onName: () => void;
  naming: {
    evidence: NamingEvidence | null;
    onClose: () => void;
    onCreate: (input: { label: string; kind: 'home' | 'business' | 'other'; googlePlaceId: string | null }) => void;
    onWiden: (placeId: number, override: boolean) => void;
  } | null;
}

function TripRow({
  trip,
  expanded,
  first,
  busy,
  trackingSince,
  onToggle,
  onPurpose,
  onInvoice,
  onCheck,
  onMerge,
  onName,
  naming,
}: TripRowProps) {
  const checked = trip.checkedAt !== null;
  const provisional = trip.status === 'provisional';
  // A trip from before tracking began has no evidence to match against. Saying
  // "no location" there blames the algorithm for a gap in the data (#11).
  const preTracking =
    trackingSince !== null && Date.parse(trip.endedAt) < Date.parse(trackingSince);
  // The panel opens on an unmatched arrival AND on a low-confidence one: a
  // wrong place is worse than no place, because it looks settled (#30).
  const nameable = !preTracking && (trip.endPlace === null || trip.endPlaceConfidence === 'low');

  return (
    <div
      className={[
        'px-3 py-2.5 transition-colors',
        expanded ? 'bg-zinc-100/70 dark:bg-zinc-900/60' : '',
        checked ? 'opacity-70' : '',
      ].join(' ')}
    >
      {/* Line 1 — the journey and the distance. Clicking it expands the row;
          it is deliberately NOT a control, so a stray click changes nothing. */}
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-baseline justify-between gap-3 text-left font-mono text-sm"
      >
        <span className="text-zinc-500">
          {formatDay(trip.startedAt)}{' '}
          <span className="text-zinc-900 dark:text-zinc-100">
            {formatTime(trip.startedAt)}
            {trip.startedAtDerived && <span title="Starttijd berekend — de API levert er geen">~</span>}
            –{formatTime(trip.endedAt)}
          </span>
        </span>
        <span className="tabular-nums font-medium">{formatKm(trip.distanceKm)}</span>
      </button>

      {/* Line 2 — places and the controls */}
      <div className="mt-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-sm">
        <span className="text-zinc-600 dark:text-zinc-400">
          <Place place={trip.startPlace} confidence={trip.startPlaceConfidence} preTracking={preTracking} />
          {' → '}
          <Place place={trip.endPlace} confidence={trip.endPlaceConfidence} preTracking={preTracking} />
          {nameable && (
            <button
              type="button"
              disabled={busy}
              onClick={onName}
              className="ml-2 rounded border border-zinc-300 px-2 py-0.5 text-xs hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              {trip.endPlace === null ? 'locatie noemen' : 'locatie corrigeren'}
            </button>
          )}
        </span>
        <span className="flex flex-wrap items-center gap-1.5 text-xs">
          {/* Purpose is a label, not a control — it gates nothing since #24/#25.
              Both values toggle off, because null is "unclassified", which is
              an absence rather than a third answer. */}
          <Toggle on={trip.purpose === 'business'} busy={busy} onClick={() => onPurpose(trip.purpose === 'business' ? null : 'business')}>
            zakelijk
          </Toggle>
          <Toggle on={trip.purpose === 'private'} busy={busy} onClick={() => onPurpose(trip.purpose === 'private' ? null : 'private')}>
            privé
          </Toggle>
          <Toggle on={trip.invoiceMonthly} busy={busy} onClick={onInvoice}>
            factureren
          </Toggle>
          {/* Checking is per-row and per-click. No select-all: bulk-checking
              would let you mark a month verified without reading it, and the
              checked flag is what lets a kilometre count (#14/#30). */}
          <Toggle on={checked} busy={busy} onClick={onCheck} title={checked ? `Gecontroleerd ${trip.checkedAt}` : 'Nog niet gecontroleerd'}>
            {checked ? '☑ gecontroleerd' : '☐ controleren'}
          </Toggle>
        </span>
      </div>

      {/* Uncertainty, inline and visible */}
      {(provisional || trip.source === 'manual' || preTracking) && (
        <div className="mt-1 text-xs text-zinc-500">
          {provisional && <span title="Kan nog een rit opnemen">● voorlopig — nog niet te controleren</span>}
          {trip.source === 'manual' && <span className="ml-3">✎ handmatig ingevoerd</span>}
          {preTracking && (
            <span className="ml-3" title="Er werd nog geen positie vastgelegd toen deze rit plaatsvond">
              ○ van vóór de locatieregistratie — noteer de locatie handmatig
            </span>
          )}
        </div>
      )}

      {naming &&
        (naming.evidence ? (
          <NamePlacePanel
            evidence={naming.evidence}
            busy={busy}
            onCreate={naming.onCreate}
            onWiden={naming.onWiden}
            onClose={naming.onClose}
          />
        ) : (
          <p className="mt-2 text-xs text-zinc-500">Locatiegegevens laden…</p>
        ))}

      {expanded && (
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-zinc-500">
          {trip.avgConsumptionKwh100km !== null && <span>{trip.avgConsumptionKwh100km} kWh/100km</span>}
          {trip.avgSpeedKmh !== null && <span>{trip.avgSpeedKmh} km/u</span>}
          <span>{formatDuration(trip.drivingMinutes)} rijtijd</span>
          {trip.endFixDeltaMinutes !== null && (
            <span title="Tijd tussen aankomst en de positiemeting waarop de locatie berust">
              fix +{trip.endFixDeltaMinutes} min
            </span>
          )}
          {/* Merge lives behind the expander rather than on the row: it is
              destructive, it is rare, and #8 made it the escape hatch for
              charging stops rather than an everyday control. */}
          {!first && (
            <button
              type="button"
              disabled={busy}
              onClick={onMerge}
              className="rounded border border-zinc-300 px-2 py-0.5 font-sans hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              samenvoegen met vorige rit
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * A control that is on or off, and says which by looking pressed.
 *
 * `aria-pressed` rather than a checkbox: these are toggles on a row, and a
 * screen reader announcing "pressed" is the truth of what they do.
 */
function Toggle({
  on,
  busy,
  onClick,
  title,
  children,
}: {
  on: boolean;
  busy: boolean;
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      title={title}
      disabled={busy}
      onClick={onClick}
      className={[
        'rounded px-1.5 py-0.5 transition-colors disabled:opacity-50',
        on
          ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
          : 'text-zinc-500 hover:bg-zinc-200 dark:text-zinc-500 dark:hover:bg-zinc-800',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

/**
 * A place, with its uncertainty attached rather than hidden.
 *
 * The three "no place" cases are deliberately NOT one symbol: a trip from
 * before tracking, a trip that matched nothing, and a trip never matched are
 * different problems with different fixes.
 */
function Place({
  place,
  confidence,
  preTracking,
}: {
  place: { label: string } | null;
  confidence: PlaceConfidence | null;
  preTracking: boolean;
}) {
  if (place) {
    return (
      <span className={confidence === 'low' ? 'text-amber-700 dark:text-amber-400' : undefined}>
        {place.label}
        {confidence === 'low' && <span title="Twee locaties liggen bijna even dichtbij — controleer deze">~</span>}
      </span>
    );
  }
  if (preTracking) return <span className="text-zinc-400" title="Geen positiegegevens uit die periode">—</span>;
  if (confidence === null) return <span className="text-zinc-400" title="Nog niet gematcht">·</span>;
  return <span className="text-amber-700 dark:text-amber-400" title="Geen locatie binnen bereik — n om te noemen, w om op te rekken">?</span>;
}

function Badge({ on, dim, children }: { on: boolean; dim?: boolean; children: React.ReactNode }) {
  return (
    <span
      className={[
        'rounded px-1.5 py-0.5',
        on
          ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
          : dim
            ? 'text-zinc-400 dark:text-zinc-600'
            : 'text-zinc-500 dark:text-zinc-500',
      ].join(' ')}
    >
      {children}
    </span>
  );
}
