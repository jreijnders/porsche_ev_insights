/**
 * Trip ledger — the rittenregistratie view. Prototype for #21.
 *
 * Shape decided on that ticket: two-line rows, keyboard-driven checking,
 * a sticky month header, and uncertainty marked inline rather than hidden.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { formatDay, formatDuration, formatKm, formatMonth, formatTime, isCheckable } from './format';
import type { LedgerTrip, MonthIndexEntry, MonthPayload, Purpose } from './types';

const API = '/api/ledger';

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
  }, [trips, cursor, busy, patch, mergePrevious]);

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
            <div className="mt-2 text-xs text-zinc-500">{progress} · ↑↓ navigeren · b zakelijk · p privé · i factureren · m samenvoegen · ⏎ controleren</div>
          </div>
        )}

        <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {trips.map((trip, index) => (
            <TripRow
              key={trip.id}
              ref={(el) => { rowRefs.current[index] = el; }}
              trip={trip}
              active={index === cursor}
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
  onFocus: () => void;
}

const TripRow = ({ ref, trip, active, onFocus }: TripRowProps & { ref?: React.Ref<HTMLDivElement> }) => {
  const checked = trip.checkedAt !== null;
  const provisional = trip.status === 'provisional';

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
          {trip.startPlace?.label ?? <Unknown />} → {trip.endPlace?.label ?? <Unknown />}
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
      {(provisional || trip.source === 'manual') && (
        <div className="mt-1 text-xs text-zinc-500">
          {provisional && <span title="Kan nog een rit opnemen">● voorlopig — nog niet te controleren</span>}
          {trip.source === 'manual' && <span className="ml-3">✎ handmatig ingevoerd</span>}
        </div>
      )}
      {(trip.avgConsumptionKwh100km !== null || trip.drivingMinutes !== null) && active && (
        <div className="mt-1 font-mono text-xs text-zinc-500">
          {trip.avgConsumptionKwh100km !== null && <>{trip.avgConsumptionKwh100km} kWh/100km · </>}
          {trip.avgSpeedKmh !== null && <>{trip.avgSpeedKmh} km/u · </>}
          {formatDuration(trip.drivingMinutes)} rijtijd
        </div>
      )}
    </div>
  );
};

function Unknown() {
  return <span className="text-amber-700 dark:text-amber-400" title="Nog geen locatie">?</span>;
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
