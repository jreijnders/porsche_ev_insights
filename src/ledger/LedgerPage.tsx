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

import LedgerShell, { Card, PillButton } from '../components/layout/LedgerShell';
import NamePlacePanel, { type NamingEvidence } from '../places/NamePlacePanel';

import { formatDay, formatDuration, formatKm, formatKmNumber, formatMonth, formatTime, isCheckable } from './format';
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

  /** Manual mode: point a pre-tracking trip at a place that already exists. */
  const attachPlace = useCallback(
    async (tripId: number, placeId: number) => {
      setBusy(true);
      try {
        await json(`${PLACES}/attach/${tripId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ placeId }),
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

  /** Manual mode: create a place at a geocoded address and attach it. */
  const createPlaceAt = useCallback(
    async (
      tripId: number,
      input: { label: string; kind: string; query: string; googlePlaceId: string | null },
    ) => {
      setBusy(true);
      try {
        const result = await json<{ geocodedTo: { address: string } }>(`${PLACES}/from-address/${tripId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        });
        // Say where it actually landed. The geocoder may have resolved the
        // typed text to something other than what was meant, and finding that
        // out later — from a trip matched to the wrong place — is worse.
        setError(`"${input.label}" aangemaakt op ${result.geocodedTo.address}.`);
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
  /** Counted once for the footnote, instead of stamped on every row. */
  const preTrackingCount = useMemo(() => {
    const since = data?.positionTrackingSince;
    if (!since) return 0;
    return trips.filter((t) => Date.parse(t.endedAt) < Date.parse(since)).length;
  }, [trips, data?.positionTrackingSince]);
  const progress = useMemo(() => {
    if (!summary) return null;
    return `${summary.trips - summary.unchecked} van ${summary.trips} gecontroleerd`;
  }, [summary]);

  return (
    <LedgerShell
      title="Rittenregistratie"
      subtitle="Zakelijke kilometers per rit"
      active="/trips"
      actions={
        <select
          value={month ?? ''}
          onChange={(e) => { setMonth(e.target.value); setExpanded(null); closeNaming(); }}
          className="rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
        >
          {months.map((m) => (
            <option key={m.month} value={m.month}>
              {formatMonth(m.month)} — {m.trips} ritten{m.unchecked > 0 ? ` (${m.unchecked} ongecontroleerd)` : ''}
            </option>
          ))}
        </select>
      }
    >
      <div className="mx-auto max-w-6xl">
        {error && (
          <div className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
            {error}
          </div>
        )}

        {summary && month && (
          <Card className="sticky top-16 z-10 mb-3 bg-white/95 p-4 backdrop-blur dark:bg-zinc-900/95">
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
            <div className="mt-3 flex items-center gap-3 text-xs text-zinc-500">
              <span>{progress}</span>
              {/* The one month-level action. Idempotent, and it never touches a
                  checked trip (#22), so it is safe to press at any time. */}
              <PillButton disabled={busy} onClick={() => void rematch()}>
                locaties opnieuw matchen
              </PillButton>
            </div>
          </Card>
        )}

        <Card className="overflow-hidden">
          {/* A real table, so every column lines up down the page. The old
              flex rows put the date at the left margin, the distance at the
              right and the controls somewhere in between, which read as three
              unrelated lists rather than one ledger. */}
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-xs font-medium uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
                  <th className="px-3 py-2 font-medium">Datum</th>
                  <th className="px-3 py-2 font-medium">Tijd</th>
                  <th className="px-3 py-2 font-medium">Route</th>
                  <th className="px-3 py-2 text-right font-medium">Afstand&nbsp;(km)</th>
                  <th className="px-3 py-2 font-medium">Doel</th>
                  <th className="px-3 py-2 font-medium">Factuur</th>
                  <th className="px-3 py-2 font-medium">Controle</th>
                </tr>
              </thead>
              <tbody>
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
                            onAttach: (placeId) => void attachPlace(trip.id, placeId),
                            onCreateAt: (input) => void createPlaceAt(trip.id, input),
                          }
                        : null
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>
          {trips.length === 0 && !error && (
            <p className="py-10 text-center text-sm text-zinc-500">Geen ritten in deze maand.</p>
          )}
        </Card>

        {/* Said once, at the foot, rather than repeated on every row. Fourteen
            identical "van vóór de locatieregistratie" lines drowned out the
            rows that actually needed attention. */}
        {preTrackingCount > 0 && (
          <p className="mt-2 text-xs text-zinc-500">
            ○ {preTrackingCount} rit{preTrackingCount === 1 ? '' : 'ten'} van vóór de locatieregistratie — daar bestaat
            geen positie van, dus stel je de locatie zelf in met “noemen”. Die keuze blijft staan.
          </p>
        )}
      </div>
    </LedgerShell>
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
            <span className="font-sans">
              <PillButton disabled={busy} onClick={() => onAcknowledge(w.fromAt, w.toAt, w.differenceKm)}>
                erken als rit
              </PillButton>
            </span>
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
    <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
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
    onAttach: (placeId: number) => void;
    onCreateAt: (input: {
      label: string;
      kind: 'home' | 'business' | 'other';
      query: string;
      googlePlaceId: string | null;
    }) => void;
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
  // Pre-tracking trips are nameable too now (#30): they have no coordinate, so
  // the panel opens in manual mode instead of refusing.
  const nameable = trip.endPlace === null || trip.endPlaceConfidence === 'low' || preTracking;
  const cell = 'px-3 py-2 align-middle';

  return (
    <>
      <tr
        className={[
          'border-b border-zinc-100 transition-colors dark:border-zinc-800/70',
          expanded ? 'bg-sky-500/5' : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/30',
          checked ? 'text-zinc-400 dark:text-zinc-500' : '',
        ].join(' ')}
      >
        <td className={cell}>
          {/* The date opens the row. It is the one cell with nothing else to
              do, so it carries the disclosure rather than an extra column. */}
          <button
            type="button"
            onClick={onToggle}
            className="whitespace-nowrap font-mono text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
            title={expanded ? 'Details verbergen' : 'Details tonen'}
          >
            <span className="mr-1 inline-block w-2 text-zinc-400">{expanded ? '▾' : '▸'}</span>
            {formatDay(trip.startedAt)}
          </button>
        </td>

        <td className={`${cell} whitespace-nowrap font-mono text-xs tabular-nums`}>
          {formatTime(trip.startedAt)}
          {trip.startedAtDerived && (
            <span className="text-zinc-400" title="Starttijd berekend — de API levert er geen">
              ~
            </span>
          )}
          <span className="text-zinc-400">–</span>
          {formatTime(trip.endedAt)}
        </td>

        <td className={cell}>
          <span className="flex items-center gap-1.5">
            <Place place={trip.startPlace} confidence={trip.startPlaceConfidence} preTracking={preTracking} />
            <span className="text-zinc-300 dark:text-zinc-600">→</span>
            <Place place={trip.endPlace} confidence={trip.endPlaceConfidence} preTracking={preTracking} />
            {nameable && (
              <PillButton disabled={busy} onClick={onName}>
                {trip.endPlace === null ? 'noemen' : 'corrigeren'}
              </PillButton>
            )}
            {provisional && (
              <span className="text-amber-600 dark:text-amber-400" title="Kan nog een rit opnemen — nog niet te controleren">
                ●
              </span>
            )}
            {trip.source === 'manual' && (
              <span className="text-zinc-400" title="Handmatig ingevoerd">
                ✎
              </span>
            )}
          </span>
        </td>

        {/* The strongest thing in the row: it is the number that becomes an
            invoice, and it was reading dimmer than the buttons beside it. */}
        <td className={`${cell} whitespace-nowrap text-right font-mono font-semibold tabular-nums text-zinc-900 dark:text-zinc-100`}>
          {formatKmNumber(trip.distanceKm)}
        </td>

        {/* Purpose is a label, not a control — it gates nothing since #24/#25.
            Both values toggle off, because null is "unclassified", which is an
            absence rather than a third answer. */}
        <td className={cell}>
          <span className="flex gap-1">
            <PillButton
              on={trip.purpose === 'business'}
              disabled={busy}
              title="Zakelijk"
              onClick={() => onPurpose(trip.purpose === 'business' ? null : 'business')}
            >
              zakelijk
            </PillButton>
            <PillButton
              on={trip.purpose === 'private'}
              disabled={busy}
              title="Privé"
              onClick={() => onPurpose(trip.purpose === 'private' ? null : 'private')}
            >
              privé
            </PillButton>
          </span>
        </td>

        <td className={cell}>
          <PillButton on={trip.invoiceMonthly} disabled={busy} onClick={onInvoice}>
            {trip.invoiceMonthly ? 'ja' : 'nee'}
          </PillButton>
        </td>

        {/* Checking is per-row and per-click. No select-all: bulk-checking
            would let you mark a month verified without reading it, and the
            checked flag is what lets a kilometre count (#14/#30). */}
        <td className={cell}>
          <PillButton
            on={checked}
            disabled={busy}
            onClick={onCheck}
            title={checked ? `Gecontroleerd ${trip.checkedAt}` : 'Nog niet gecontroleerd'}
          >
            {checked ? '☑' : '☐'}
          </PillButton>
        </td>
      </tr>

      {naming && (
        <tr className="border-b border-zinc-100 bg-sky-500/5 dark:border-zinc-800/70">
          <td colSpan={7} className="px-3 pb-3">
            {naming.evidence ? (
              <NamePlacePanel
                evidence={naming.evidence}
                busy={busy}
                onCreate={naming.onCreate}
                onWiden={naming.onWiden}
                onAttach={naming.onAttach}
                onCreateAt={naming.onCreateAt}
                onClose={naming.onClose}
              />
            ) : (
              <p className="pt-2 text-xs text-zinc-500">Locatiegegevens laden…</p>
            )}
          </td>
        </tr>
      )}

      {expanded && (
        <tr className="border-b border-zinc-100 bg-sky-500/5 dark:border-zinc-800/70">
          <td colSpan={7} className="px-3 pb-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs text-zinc-500">
              {trip.avgConsumptionKwh100km !== null && <span>{trip.avgConsumptionKwh100km} kWh/100km</span>}
              {trip.avgSpeedKmh !== null && <span>{trip.avgSpeedKmh} km/u</span>}
              <span>{formatDuration(trip.drivingMinutes)} rijtijd</span>
              {trip.endFixDeltaMinutes !== null && (
                <span title="Tijd tussen aankomst en de positiemeting waarop de locatie berust">
                  fix +{trip.endFixDeltaMinutes} min
                </span>
              )}
              {preTracking && <span title="Er werd nog geen positie vastgelegd">○ vóór de locatieregistratie</span>}
              {/* Merge lives behind the expander rather than in a column: it is
                  destructive, it is rare, and #8 made it the escape hatch for
                  charging stops rather than an everyday control. */}
              {!first && (
                <span className="font-sans">
                  <PillButton disabled={busy} onClick={onMerge}>
                    samenvoegen met vorige rit
                  </PillButton>
                </span>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

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
