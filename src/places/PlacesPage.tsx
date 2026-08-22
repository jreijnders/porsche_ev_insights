/**
 * The place book (#28) — see, edit and delete the places matching runs against.
 *
 * Manual-first (#11): every place here exists because you named it. Nothing on
 * this screen talks to Google, and the whole thing works with the network to
 * the outside world unplugged.
 *
 * Deliberately NOT here: the unmatched-place flow — map popup, nearby-company
 * list, fuzzy search. That is still fog on the map and needs the Maps key;
 * building half of it here would pre-empt the decision.
 */

import { useCallback, useEffect, useState } from 'react';

import type { Place, PlaceKind } from './types';

const API = '/api/places';

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Request failed (${response.status})`);
  }
  return (await response.json()) as T;
}

const KINDS: PlaceKind[] = ['home', 'business', 'other'];
const KIND_LABEL: Record<PlaceKind, string> = {
  home: 'thuis',
  business: 'zakelijk',
  other: 'overig',
};

export default function PlacesPage() {
  const [places, setPlaces] = useState<Place[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const { places } = await json<{ places: Place[] }>(API);
      setPlaces(places);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Every mutation re-matches server-side, so the list is reloaded after each. */
  const mutate = useCallback(
    async (fn: () => Promise<unknown>, success?: string) => {
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        await fn();
        if (success) setNotice(success);
        await load();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  const save = (id: number, patch: Partial<Place>) =>
    mutate(
      () =>
        json(`${API}/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        }),
      'Opgeslagen — ritten opnieuw gematcht.',
    ).then(() => setEditing(null));

  const remove = (place: Place) => {
    if (!window.confirm(`"${place.label}" verwijderen?`)) return;
    // The 409 for a checked trip is surfaced, not swallowed: refusing to
    // rewrite verified history is the point, so the reason has to be readable.
    void mutate(() => json(`${API}/${place.id}`, { method: 'DELETE' }), 'Locatie verwijderd.');
  };

  const rematch = () =>
    mutate(async () => {
      const { summary } = await json<{
        summary: { placed: number; ambiguous: number; unmatched: number; preTracking: number };
      }>(`${API}/rematch`, { method: 'POST' });
      setNotice(
        `${summary.placed} geplaatst · ${summary.ambiguous} twijfelachtig · ${summary.unmatched} zonder locatie · ${summary.preTracking} van vóór de locatieregistratie.`,
      );
    });

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <div className="mx-auto max-w-4xl px-4 py-6">
        <header className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="text-xl font-semibold tracking-tight">Locatieboek</h1>
          <div className="flex items-center gap-3 text-sm">
            <a href="/trips" className="text-zinc-500 underline-offset-2 hover:underline">
              ← ritten
            </a>
            <button
              type="button"
              onClick={rematch}
              disabled={busy}
              className="rounded-lg border border-zinc-300 px-3 py-1.5 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              opnieuw matchen
            </button>
          </div>
        </header>

        {error && (
          <div className="mb-4 rounded-lg border border-amber-400/60 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-200">
            {error}
          </div>
        )}
        {notice && !error && (
          <div className="mb-4 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
            {notice}
          </div>
        )}

        <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {places.map((place) =>
            editing === place.id ? (
              <PlaceEditor
                key={place.id}
                place={place}
                busy={busy}
                onCancel={() => setEditing(null)}
                onSave={(patch) => void save(place.id, patch)}
              />
            ) : (
              <PlaceRow
                key={place.id}
                place={place}
                busy={busy}
                onEdit={() => setEditing(place.id)}
                onDelete={() => remove(place)}
              />
            ),
          )}
          {places.length === 0 && !error && (
            <p className="py-10 text-center text-sm text-zinc-500">
              Nog geen locaties. Noem er een vanuit een rit met <kbd className="font-mono">n</kbd> in het
              rittenoverzicht — dan neemt hij de coördinaat van die rit over.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function PlaceRow({
  place,
  busy,
  onEdit,
  onDelete,
}: {
  place: Place;
  busy: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="px-3 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium">
          {place.label}{' '}
          <span className="text-xs font-normal text-zinc-500">{KIND_LABEL[place.kind]}</span>
        </span>
        <span className="flex items-center gap-2 text-xs">
          <button
            type="button"
            onClick={onEdit}
            disabled={busy}
            className="rounded border border-zinc-300 px-2 py-0.5 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            bewerken
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={busy}
            className="rounded border border-zinc-300 px-2 py-0.5 text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-zinc-700 dark:text-red-400 dark:hover:bg-red-950/40"
          >
            verwijderen
          </button>
        </span>
      </div>

      <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1 font-mono text-xs text-zinc-500">
        <span>
          {place.lat.toFixed(5)}, {place.lon.toFixed(5)}
        </span>
        <span>straal {place.matchRadiusM} m</span>
        <span>
          {place.usage.trips} rit{place.usage.trips === 1 ? '' : 'ten'}
          {place.usage.checkedTrips > 0 && ` (${place.usage.checkedTrips} gecontroleerd)`}
        </span>
        <RadiusReality place={place} />
      </div>
    </div>
  );
}

/**
 * The radius measured against what actually happened, so widening or narrowing
 * is an informed act rather than a guess (#11: the radius never grows on its own).
 */
function RadiusReality({ place }: { place: Place }) {
  const { nearestMatchM, farthestMatchM } = place.usage;
  if (farthestMatchM === null || nearestMatchM === null) {
    return <span className="text-zinc-400">nog geen gemeten match</span>;
  }

  const headroom = place.matchRadiusM - farthestMatchM;
  const tight = headroom <= 15;
  const loose = headroom >= place.matchRadiusM * 0.75;

  return (
    <span className={tight ? 'text-amber-700 dark:text-amber-400' : undefined}>
      matches op {nearestMatchM}–{farthestMatchM} m
      {tight && ' · krap, één slechte parkeerplek van missen'}
      {loose && ' · ruim; kan strakker'}
    </span>
  );
}

function PlaceEditor({
  place,
  busy,
  onCancel,
  onSave,
}: {
  place: Place;
  busy: boolean;
  onCancel: () => void;
  onSave: (patch: Partial<Place>) => void;
}) {
  const [label, setLabel] = useState(place.label);
  const [kind, setKind] = useState<PlaceKind>(place.kind);
  const [radius, setRadius] = useState(String(place.matchRadiusM));

  const field =
    'rounded-lg border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900';

  return (
    <div className="space-y-2 bg-zinc-100/60 px-3 py-3 dark:bg-zinc-900/60">
      <div className="flex flex-wrap items-center gap-2">
        <input value={label} onChange={(e) => setLabel(e.target.value)} className={`${field} flex-1`} />
        <select value={kind} onChange={(e) => setKind(e.target.value as PlaceKind)} className={field}>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-xs text-zinc-500">
          straal
          <input
            type="number"
            min={1}
            value={radius}
            onChange={(e) => setRadius(e.target.value)}
            className={`${field} w-20`}
          />
          m
        </label>
      </div>

      <div className="flex items-center gap-2 text-xs">
        <button
          type="button"
          disabled={busy || label.trim() === '' || Number(radius) <= 0}
          onClick={() => onSave({ label: label.trim(), kind, matchRadiusM: Number(radius) })}
          className="rounded border border-zinc-300 px-2 py-0.5 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          opslaan
        </button>
        <button type="button" onClick={onCancel} className="text-zinc-500 hover:underline">
          annuleren
        </button>
        <span className="text-zinc-400">
          Coördinaat wijzigen kan alleen via de API — er is nog geen kaartkiezer.
        </span>
      </div>
    </div>
  );
}
