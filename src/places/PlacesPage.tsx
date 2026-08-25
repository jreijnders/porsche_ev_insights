/**
 * The place book (#28) — see, edit and delete the places matching runs against.
 *
 * Manual-first (#11): every place here exists because you named it. Nothing on
 * this screen talks to Google, and the whole thing works with the network to
 * the outside world unplugged.
 *
 * The naming flow lives here too (#30), as "onbenoemde plekken": arrivals that
 * matched nothing, grouped into spots. The ledger asks "where did THIS trip
 * end?"; this asks "which spots do I keep going to without a name?" — same
 * evidence, different cut, and naming one spot places every trip in it.
 *
 * Still deliberately absent: any coordinate picker. Every place is born from a
 * position the car actually reported, never from a point typed or clicked on a
 * map.
 */

import { Fragment, useCallback, useEffect, useState } from 'react';

import LedgerShell, { Card, PillButton } from '../components/layout/LedgerShell';

import NamePlacePanel from './NamePlacePanel';
import type { ArrivalCluster, Place, PlaceKind } from './types';

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
  const [clusters, setClusters] = useState<ArrivalCluster[]>([]);
  /** Index of the cluster whose naming panel is open. */
  const [naming, setNaming] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const { places } = await json<{ places: Place[] }>(API);
      setPlaces(places);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
    // Separate and non-fatal: the unnamed list costs Nominatim lookups, so a
    // failure here must not blank the place book itself.
    try {
      const { clusters } = await json<{ clusters: ArrivalCluster[] }>(`${API}/unnamed`);
      setClusters(clusters);
    } catch {
      setClusters([]);
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

  const nameCluster = (
    cluster: ArrivalCluster,
    input: { label: string; kind: PlaceKind; googlePlaceId: string | null },
  ) =>
    mutate(async () => {
      const { tripsInCluster } = await json<{ tripsInCluster: number }>(`${API}/from-cluster`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...input, tripIds: cluster.tripIds }),
      });
      setNotice(`"${input.label}" aangemaakt — ${tripsInCluster} rit(ten) gematcht.`);
      setNaming(null);
    });

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
    <LedgerShell
      title="Locatieboek"
      subtitle="De plekken waar ritten tegen gematcht worden"
      active="/places"
      actions={
        <PillButton disabled={busy} onClick={rematch}>
          opnieuw matchen
        </PillButton>
      }
    >
      <div className="mx-auto max-w-6xl">
        {error && (
          <div className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
            {error}
          </div>
        )}
        {notice && !error && (
          <div className="mb-4 rounded-xl border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-sm text-sky-700 dark:text-sky-300">
            {notice}
          </div>
        )}

        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">Locaties</h2>

        {/* No table at all when there is nothing in it. A header row over zero
            rows advertises columns of data that do not exist. */}
        {places.length === 0 && !error ? (
          <Card className="p-4">
            <p className="text-sm text-zinc-500">
              Nog geen locaties. Noem er een hieronder bij een onbenoemde plek, of vanuit een rit in het
              rittenoverzicht — dan neemt hij de coördinaat van die rit over.
            </p>
          </Card>
        ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-xs font-medium uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
                  <th className="px-3 py-2 font-medium">Locatie</th>
                  <th className="px-3 py-2 font-medium">Soort</th>
                  <th className="px-3 py-2 text-right font-medium">Straal</th>
                  <th className="px-3 py-2 font-medium">In werkelijkheid</th>
                  <th className="px-3 py-2 text-right font-medium">Ritten</th>
                  <th className="px-3 py-2 font-medium">Coördinaat</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
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
              </tbody>
            </table>
          </div>
        </Card>
        )}

        {/* Onbenoemde plekken (#30). Empty until the poller has collected
            enough positions for trips to have arrivals that match nothing. */}
        <section className="mt-8">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">Onbenoemde plekken</h2>
          {clusters.length === 0 ? (
            <Card className="p-4">
              <p className="text-sm text-zinc-500">
                Geen aankomsten zonder locatie — alles wat een positie heeft, heeft een naam.
              </p>
            </Card>
          ) : (
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-zinc-200 text-left text-xs font-medium uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
                      <th className="px-3 py-2 font-medium">Adres</th>
                      <th className="px-3 py-2 text-right font-medium">Ritten</th>
                      <th className="px-3 py-2 text-right font-medium">Spreiding</th>
                      <th className="px-3 py-2 font-medium">Laatst</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {clusters.map((cluster, index) => (
                      <Fragment key={`${cluster.lat},${cluster.lon}`}>
                        <tr className="border-b border-zinc-100 dark:border-zinc-800/70">
                          <td className="px-3 py-2">
                            {cluster.address ?? (
                              <span className="font-mono text-xs text-zinc-500">
                                {cluster.lat.toFixed(5)}, {cluster.lon.toFixed(5)}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-xs tabular-nums">
                            {cluster.tripIds.length}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-xs tabular-nums text-zinc-500">
                            {cluster.spreadM} m
                          </td>
                          <td className="px-3 py-2 font-mono text-xs tabular-nums text-zinc-500">
                            {new Date(cluster.latestAt).toLocaleDateString('nl-NL')}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <PillButton disabled={busy} onClick={() => setNaming(index)}>
                              benoemen
                            </PillButton>
                          </td>
                        </tr>
                        {naming === index && (
                          <tr className="border-b border-zinc-100 bg-sky-500/5 dark:border-zinc-800/70">
                            <td colSpan={5} className="px-3 pb-3">
                              <NamePlacePanel
                                // The place book's cut has no per-trip candidates
                                // to offer: this spot matched nothing, so widening
                                // is not one of the answers here — naming is.
                                evidence={{
                                  at: { lat: cluster.lat, lon: cluster.lon },
                                  address: cluster.address,
                                  candidates: [],
                                  ceilingM: 250,
                                }}
                                busy={busy}
                                onCreate={(input) => void nameCluster(cluster, input)}
                                onWiden={() => undefined}
                                onClose={() => setNaming(null)}
                              />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </section>
      </div>
    </LedgerShell>
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
    <tr className="border-b border-zinc-100 hover:bg-zinc-50 dark:border-zinc-800/70 dark:hover:bg-zinc-800/30">
      <td className="px-3 py-2 font-medium">
        {place.label}
        {place.address && <div className="text-xs font-normal text-zinc-500">{place.address}</div>}
      </td>
      <td className="px-3 py-2 text-xs text-zinc-500">{KIND_LABEL[place.kind]}</td>
      <td className="px-3 py-2 text-right font-mono text-xs tabular-nums">{place.matchRadiusM} m</td>
      <td className="px-3 py-2 text-xs">
        <RadiusReality place={place} />
      </td>
      <td className="px-3 py-2 text-right font-mono text-xs tabular-nums">
        {place.usage.trips}
        {place.usage.checkedTrips > 0 && (
          <span className="text-zinc-500" title={`${place.usage.checkedTrips} gecontroleerd`}>
            {' '}
            ({place.usage.checkedTrips}☑)
          </span>
        )}
      </td>
      <td className="px-3 py-2 font-mono text-xs tabular-nums text-zinc-500">
        {place.lat.toFixed(5)}, {place.lon.toFixed(5)}
      </td>
      <td className="px-3 py-2">
        <span className="flex items-center justify-end gap-2">
          <PillButton disabled={busy} onClick={onEdit}>
            bewerken
          </PillButton>
          {/* Destructive, so it carries red rather than the neutral border —
              the delete refusal for a checked trip is the safety net, not this. */}
          <button
            type="button"
            onClick={onDelete}
            disabled={busy}
            className="rounded-lg border border-red-500/30 px-2.5 py-1 text-xs font-medium text-red-600 transition-all hover:bg-red-500/10 disabled:opacity-40 dark:text-red-400"
          >
            verwijderen
          </button>
        </span>
      </td>
    </tr>
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
    'rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-sm dark:border-zinc-800 dark:bg-zinc-950';

  return (
    <tr className="border-b border-zinc-100 bg-sky-500/5 dark:border-zinc-800/70">
      <td colSpan={7} className="space-y-2 px-3 py-3">
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
          className="rounded-xl bg-sky-500 px-3 py-1.5 text-xs font-medium text-white transition-all hover:bg-sky-600 disabled:opacity-40"
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
      </td>
    </tr>
  );
}
