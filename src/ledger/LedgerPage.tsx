/**
 * Trip ledger — the rittenregistratie view. Prototype for #21.
 *
 * Shape decided on that ticket: two-line rows, keyboard-driven checking,
 * a sticky month header, and uncertainty marked inline rather than hidden.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { formatDay, formatDuration, formatKm, formatMonth, formatTime, isCheckable } from './format';
import type { LedgerTrip, MonthIndexEntry, MonthPayload, PlaceConfidence, Purpose } from './types';

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
  const [cursor, setCursor] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const rowRefs = useRef<Array<HTMLDivElement | null>>([]);

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
  const current = trips[cursor];

  useEffect(() => {
    if (cursor >= trips.length) setCursor(Math.max(0, trips.length - 1));
  }, [trips.length, cursor]);

  useEffect(() => {
    rowRefs.current[cursor]?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

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
        setCursor((c) => Math.max(0, c - 1));
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [month, load],
  );

  /**
   * Name the place this trip arrived at, from the trip's own fix.
   *
   * window.prompt rather than a modal on purpose: the unmatched-place flow —
   * map popup, nearby list, fuzzy search — is explicitly still fog (#11/#22),
   * and building half of it here would pre-empt that decision. This is the one
   * action the ticket does ask for, kept to one keystroke.
   */
  const namePlace = useCallback(
    async (trip: LedgerTrip) => {
      const label = window.prompt(`Naam voor de bestemming van deze rit (${formatDay(trip.startedAt)}):`);
      if (!label?.trim()) return;
      const kind = window.prompt('Soort — home, business of other:', 'business')?.trim();
      if (kind !== 'home' && kind !== 'business' && kind !== 'other') {
        setError('Soort moet home, business of other zijn.');
        return;
      }

      setBusy(true);
      try {
        await json(`${PLACES}/from-trip/${trip.id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ label: label.trim(), kind }),
        });
        if (month) await load(month);
        setError(null);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [month, load],
  );

  /** Accept-and-widen. The server recomputes the distance and asks before growing. */
  const widenForTrip = useCallback(
    async (trip: LedgerTrip) => {
      setBusy(true);
      try {
        const result = await json<{ place: { label: string } | null; widenedFrom: number; widenedTo: number; fixDistanceM: number }>(
          `${PLACES}/widen-for-trip/${trip.id}`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
        );
        setError(
          `${result.place?.label ?? 'Locatie'} opgerekt van ${result.widenedFrom} naar ${result.widenedTo} m (fix lag op ${result.fixDistanceM} m).`,
        );
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

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const trip = trips[cursor];

      switch (event.key) {
        case 'ArrowDown':
        case 'j':
          event.preventDefault();
          setCursor((c) => Math.min(trips.length - 1, c + 1));
          return;
        case 'ArrowUp':
        case 'k':
          event.preventDefault();
          setCursor((c) => Math.max(0, c - 1));
          return;
      }
      if (!trip || busy) return;

      switch (event.key) {
        case 'b':
          void patch(trip, { purpose: trip.purpose === 'business' ? null : 'business' });
          break;
        case 'p':
          void patch(trip, { purpose: trip.purpose === 'private' ? null : 'private' });
          break;
        case 'i':
          void patch(trip, { invoiceMonthly: !trip.invoiceMonthly });
          break;
        case 'm':
          void mergePrevious(trip);
          break;
        case 'n':
          void namePlace(trip);
          break;
        case 'w':
          void widenForTrip(trip);
          break;
        case 'r':
          void rematch();
          break;
        case 'Enter':
          event.preventDefault();
          if (!isCheckable(trip.status)) {
            setError('A provisional trip cannot be checked — it may still absorb another leg.');
            return;
          }
          void patch(trip, { checked: trip.checkedAt === null }).then(() =>
            setCursor((c) => Math.min(trips.length - 1, c + 1)),
          );
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [trips, cursor, busy, patch, mergePrevious, namePlace, widenForTrip, rematch]);

  const summary = data?.summary;
  const progress = useMemo(() => {
    if (!summary) return null;
    return `${summary.trips - summary.unchecked} of ${summary.trips} checked`;
  }, [summary]);

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <div className="mx-auto max-w-4xl px-4 py-6">
        <header className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="text-xl font-semibold tracking-tight">Rittenregistratie</h1>
          <select
            value={month ?? ''}
            onChange={(e) => { setMonth(e.target.value); setCursor(0); }}
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
              {summary.unchecked > 0 && <Warn>{summary.unchecked} ongecontroleerd</Warn>}
              {summary.unplaced > 0 && <Warn>{summary.unplaced} zonder locatie</Warn>}
              {summary.unaccountedKm === null ? (
                <span className="text-xs text-zinc-500">
                  niet-verantwoorde km: onbekend ({summary.odometerReadings} tellerstanden)
                </span>
              ) : (
                summary.unaccountedKm !== 0 && <Warn>{summary.unaccountedKm} km niet verantwoord</Warn>
              )}
            </div>
            <div className="mt-2 text-xs text-zinc-500">{progress} · ↑↓ navigeren · b zakelijk · p privé · i factureren · m samenvoegen · n locatie noemen · w oprekken · r hermatchen · ⏎ controleren</div>
          </div>
        )}

        <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {trips.map((trip, index) => (
            <TripRow
              key={trip.id}
              ref={(el) => { rowRefs.current[index] = el; }}
              trip={trip}
              active={index === cursor}
              trackingSince={data?.positionTrackingSince ?? null}
              onFocus={() => setCursor(index)}
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
  active: boolean;
  /** When position tracking began; trips older than this were never placeable. */
  trackingSince: string | null;
  onFocus: () => void;
}

const TripRow = ({ ref, trip, active, trackingSince, onFocus }: TripRowProps & { ref?: React.Ref<HTMLDivElement> }) => {
  const checked = trip.checkedAt !== null;
  const provisional = trip.status === 'provisional';
  // A trip from before tracking began has no evidence to match against. Saying
  // "no location" there blames the algorithm for a gap in the data (#11).
  const preTracking =
    trackingSince !== null && Date.parse(trip.endedAt) < Date.parse(trackingSince);

  return (
    <div
      ref={ref}
      onClick={onFocus}
      className={[
        'cursor-default px-3 py-2.5 transition-colors',
        active ? 'bg-red-50 ring-1 ring-inset ring-red-500/40 dark:bg-red-950/30' : '',
        checked ? 'opacity-70' : '',
      ].join(' ')}
    >
      {/* Line 1 — the journey and the distance */}
      <div className="flex items-baseline justify-between gap-3 font-mono text-sm">
        <span className="text-zinc-500">
          {formatDay(trip.startedAt)}{' '}
          <span className="text-zinc-900 dark:text-zinc-100">
            {formatTime(trip.startedAt)}
            {trip.startedAtDerived && <span title="Starttijd berekend — de API levert er geen">~</span>}
            –{formatTime(trip.endedAt)}
          </span>
        </span>
        <span className="tabular-nums font-medium">{formatKm(trip.distanceKm)}</span>
      </div>

      {/* Line 2 — places and the controls */}
      <div className="mt-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm">
        <span className="text-zinc-600 dark:text-zinc-400">
          <Place place={trip.startPlace} confidence={trip.startPlaceConfidence} preTracking={preTracking} />
          {' → '}
          <Place place={trip.endPlace} confidence={trip.endPlaceConfidence} preTracking={preTracking} />
        </span>
        <span className="flex items-center gap-2 text-xs">
          <Badge on={trip.purpose === 'business'} dim={trip.purpose === null}>
            {trip.purpose === 'business' ? 'zakelijk' : trip.purpose === 'private' ? 'privé' : 'niet geclassificeerd'}
          </Badge>
          <Badge on={trip.invoiceMonthly}>{trip.invoiceMonthly ? 'factureren' : 'niet factureren'}</Badge>
          <span title={checked ? `Gecontroleerd ${trip.checkedAt}` : 'Nog niet gecontroleerd'}>
            {checked ? '☑' : '☐'}
          </span>
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
      {(trip.avgConsumptionKwh100km !== null || trip.drivingMinutes !== null) && active && (
        <div className="mt-1 font-mono text-xs text-zinc-500">
          {trip.avgConsumptionKwh100km !== null && <>{trip.avgConsumptionKwh100km} kWh/100km · </>}
          {trip.avgSpeedKmh !== null && <>{trip.avgSpeedKmh} km/u · </>}
          {formatDuration(trip.drivingMinutes)} rijtijd
          {trip.endFixDeltaMinutes !== null && (
            <span title="Tijd tussen aankomst en de positiemeting waarop de locatie berust">
              {' · fix +'}{trip.endFixDeltaMinutes} min
            </span>
          )}
        </div>
      )}
    </div>
  );
};

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
