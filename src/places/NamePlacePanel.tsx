/**
 * The naming panel (#30) — one component, both surfaces.
 *
 * The ledger asks "where did THIS trip end?" and the place book asks "which
 * spots do I keep going to without a name?". Same evidence, same actions, two
 * entry points, so this takes its evidence as props rather than fetching it.
 *
 * Layering, in the order it appears on screen:
 *   1. the address, from Nominatim — ours to keep forever, no key, no billing
 *   2. places you already know within 1 km, with widen offered per candidate
 *   3. "wie zit hier?" — Google's own component, on demand, never automatic
 *
 * Google contributes a place_id and NOTHING else. You type the label having
 * read the name on screen: reading displayName out of the UI Kit element into
 * our own field and saving it is caching a Google name with extra steps, and
 * #5 found no permission for that at any duration.
 */

import { useEffect, useRef, useState } from 'react';

import { PillButton } from '../components/layout/LedgerShell';

import { loadPlacesUiKit } from './googleMaps';

export interface NamingCandidate {
  placeId: number;
  label: string;
  kind: 'home' | 'business' | 'other';
  distanceM: number;
  matchRadiusM: number;
  withinRadius: boolean;
  widenToM: number | null;
  widenNeedsOverride: boolean;
}

/** A place as offered by manual mode's picker — the whole book, unfiltered. */
export interface BookPlace {
  id: number;
  label: string;
  kind: 'home' | 'business' | 'other';
  address: string | null;
  lat: number;
  lon: number;
}

export interface NamingEvidence {
  /**
   * 'fix' — the trip has an arrival coordinate, so geometry decides and the
   * panel offers nearby places and widening.
   *
   * 'manual' — the trip predates position tracking (#22), so there is no
   * coordinate and never will be. Nothing to widen towards and nothing nearby;
   * you either point at a place you have or name one by address. Matching
   * skips these trips entirely, so the answer sticks.
   */
  mode?: 'fix' | 'manual';
  at: { lat: number; lon: number } | null;
  address: string | null;
  candidates: NamingCandidate[];
  /** Manual mode only. */
  places?: BookPlace[];
  currentPlaceId?: number | null;
  ceilingM: number;
}

export interface NamePlacePanelProps {
  evidence: NamingEvidence;
  busy: boolean;
  /** Create a place here. `googlePlaceId` is null unless one was picked. */
  onCreate: (input: { label: string; kind: 'home' | 'business' | 'other'; googlePlaceId: string | null }) => void;
  /** Widen an existing place to reach this fix. Fix mode only. */
  onWiden: (placeId: number, override: boolean) => void;
  /** Manual mode: point the trip at a place that already exists. */
  onAttach?: (placeId: number) => void;
  /** Manual mode: create a place at the geocoded address and point the trip at it. */
  onCreateAt?: (input: {
    label: string;
    kind: 'home' | 'business' | 'other';
    query: string;
    googlePlaceId: string | null;
  }) => void;
  onClose: () => void;
}

const KINDS: { value: 'home' | 'business' | 'other'; label: string }[] = [
  { value: 'business', label: 'business address' },
  { value: 'home', label: 'home' },
  { value: 'other', label: 'other' },
];

export default function NamePlacePanel({
  evidence,
  busy,
  onCreate,
  onWiden,
  onAttach,
  onCreateAt,
  onClose,
}: NamePlacePanelProps) {
  if (evidence.mode === 'manual') {
    return (
      <ManualPanel
        evidence={evidence}
        busy={busy}
        onAttach={onAttach}
        onCreateAt={onCreateAt}
        onClose={onClose}
      />
    );
  }

  const [label, setLabel] = useState('');
  const [kind, setKind] = useState<'home' | 'business' | 'other'>('business');
  const [googlePlaceId, setGooglePlaceId] = useState<string | null>(null);
  const [googleOpen, setGoogleOpen] = useState(false);

  return (
    <div className="mt-2 rounded-xl border border-sky-500/30 bg-sky-500/5 p-3 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium">
            {evidence.address ?? (
              <span className="font-mono text-zinc-500">
                {evidence.at?.lat.toFixed(5)}, {evidence.at?.lon.toFixed(5)}
              </span>
            )}
          </div>
          {evidence.address && evidence.at && (
            <div className="font-mono text-xs text-zinc-500">
              {evidence.at.lat.toFixed(5)}, {evidence.at.lon.toFixed(5)}
            </div>
          )}
        </div>
        <PillButton onClick={onClose}>close</PillButton>
      </div>

      {/* Known places first. Half of all unmatched arrivals are a place you
          already have, sitting just outside its radius — offering "create new"
          without saying so is how you end up with two places for one spot. */}
      <div className="mt-3">
        <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">Places you already know nearby</div>
        {evidence.candidates.length === 0 ? (
          <p className="mt-1 text-xs text-zinc-500">No known place within 1 km — this is a new spot.</p>
        ) : (
          <ul className="mt-1 space-y-1">
            {evidence.candidates.map((c) => (
              <li key={c.placeId} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-medium">{c.label}</span>
                <span className="font-mono text-xs tabular-nums text-zinc-500">
                  {c.distanceM} m · straal {c.matchRadiusM} m
                </span>
                {c.withinRadius ? (
                  c.placeId === evidence.currentPlaceId ? (
                    <span className="text-xs text-zinc-500">current choice</span>
                  ) : (
                    // Deliberately NOT a "use this one" button.
                    //
                    // Matching owns an unchecked trip's place: geometry is the
                    // source of truth and re-deriving is safe (#29), so a
                    // hand-picked place would be silently overwritten by the
                    // next re-match — and a re-match runs after every change to
                    // the place book. A control that quietly undoes itself is
                    // worse than no control.
                    //
                    // The durable fix for an ambiguity is geometric: make one
                    // of the two circles stop reaching here.
                    <span className="text-xs text-zinc-500" title="Reaches this spot too — adjust its radius in the place book to resolve the ambiguity">
                      reaches this spot too
                    </span>
                  )
                ) : (
                  <PillButton
                    disabled={busy}
                    onClick={() => onWiden(c.placeId, c.widenNeedsOverride)}
                    // The size is the button's headline, and above the ceiling
                    // it stops looking like an ordinary action (#30).
                    tone={c.widenNeedsOverride ? 'warn' : 'plain'}
                    title={
                      c.widenNeedsOverride
                        ? `Past ${evidence.ceilingM} m a place starts swallowing its neighbours`
                        : undefined
                    }
                  >
                    {c.widenNeedsOverride ? '⚠ ' : ''}
                    widen {c.label} to {c.widenToM} m
                  </PillButton>
                )}
              </li>
            ))}
          </ul>
        )}
        {/* The low-confidence case, said out loud. Picking one by hand here
            would not last: matching owns an unchecked trip's place (#29), so
            the next re-match would put the ambiguity straight back. */}
        {evidence.currentPlaceId != null && evidence.candidates.length > 1 && (
          <p className="mt-1 text-xs text-zinc-500">
            Two places are almost equally close. Shrink the wrong one’s radius in the{' '}
            <a href="/places" className="underline underline-offset-2">
              place book
            </a>{' '}
            — a manual choice here would disappear again at the next re-match.
          </p>
        )}
      </div>

      {/* Naming. Always available, whatever else is unreachable (#30). */}
      <div className="mt-3 border-t border-zinc-200 pt-3 dark:border-zinc-800">
        <div className="flex flex-wrap items-center gap-2">
          <input
            autoFocus
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Name for this place"
            className="min-w-0 flex-1 rounded-xl border border-zinc-200 bg-white px-3 py-1.5 dark:border-zinc-800 dark:bg-zinc-950"
          />
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as 'home' | 'business' | 'other')}
            className="rounded-xl border border-zinc-200 bg-white px-2 py-1.5 text-xs dark:border-zinc-800 dark:bg-zinc-950"
          >
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={busy || label.trim() === ''}
            onClick={() => onCreate({ label: label.trim(), kind, googlePlaceId })}
            className="rounded-xl bg-sky-500 px-3 py-1.5 text-xs font-medium text-white transition-all hover:bg-sky-600 disabled:opacity-40"
          >
            save
          </button>
        </div>
        {googlePlaceId && (
          <p className="mt-1 text-xs text-zinc-500">
            Google place linked (id kept, name not — you type that yourself).{' '}
            <button type="button" onClick={() => setGooglePlaceId(null)} className="underline underline-offset-2">
              unlink
            </button>
          </p>
        )}
      </div>

      {/* Google, last and on demand. */}
      <div className="mt-3">
        {googleOpen ? (
          <GooglePanel
            at={evidence.at ?? { lat: 0, lon: 0 }}
            onPick={(id) => setGooglePlaceId(id)}
            picked={googlePlaceId}
            onClose={() => setGoogleOpen(false)}
          />
        ) : (
          <button
            type="button"
            onClick={() => setGoogleOpen(true)}
            className="text-xs text-zinc-500 underline underline-offset-2 hover:text-zinc-800 dark:hover:text-zinc-200"
          >
            who is here? (Google)
          </button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ Google panel */

/**
 * The Places UI Kit, rendering Google's own content.
 *
 * Google's markup, Google's attribution, our zero strings — that is what makes
 * this permitted (#5, EEA §15.3). We read `place.id` off the selection event
 * and nothing else.
 *
 * Nearby first, because you are here because a trip ended here. The text field
 * is for the case the nearby list misses.
 */
function GooglePanel({
  at,
  picked,
  onPick,
  onClose,
}: {
  at: { lat: number; lon: number };
  picked: string | null;
  onPick: (placeId: string) => void;
  onClose: () => void;
}) {
  const host = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    void loadPlacesUiKit().then((ok) => {
      if (!cancelled) setState(ok ? 'ready' : 'unavailable');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (state !== 'ready' || !host.current) return;
    const mount = host.current;
    mount.replaceChildren();

    const search = document.createElement('gmp-place-search');
    search.setAttribute('selectable', '');

    const content = document.createElement('gmp-place-all-content');
    search.appendChild(content);

    // Nearby unless you typed something. Both are Place Search requests, so
    // switching modes is one element swap rather than a second widget.
    const request = document.createElement(
      query.trim() === '' ? 'gmp-place-nearby-search-request' : 'gmp-place-text-search-request',
    ) as HTMLElement & {
      locationRestriction?: unknown;
      locationBias?: unknown;
      textQuery?: string;
    };

    if (query.trim() === '') {
      request.locationRestriction = { center: { lat: at.lat, lng: at.lon }, radius: 150 };
    } else {
      request.textQuery = query.trim();
      request.locationBias = { center: { lat: at.lat, lng: at.lon }, radius: 2_000 };
    }
    search.appendChild(request);

    const onSelect = (event: Event) => {
      // The ID is all we take. Reading displayName here and putting it in the
      // label field would be caching a Google name (#5) — the human types it.
      const place = (event as CustomEvent<{ place?: { id?: string } }>).detail?.place
        ?? (event as unknown as { place?: { id?: string } }).place;
      if (place?.id) onPick(place.id);
    };
    search.addEventListener('gmp-select', onSelect);
    mount.appendChild(search);

    return () => {
      search.removeEventListener('gmp-select', onSelect);
      mount.replaceChildren();
    };
  }, [state, at.lat, at.lon, query, onPick]);

  return (
    <div className="rounded-xl border border-zinc-200 bg-white/60 p-2 dark:border-zinc-800 dark:bg-zinc-950/40">
      <div className="mb-2 flex items-center justify-between gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="search by name (empty = nearby)"
          className="min-w-0 flex-1 rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-xs dark:border-zinc-800 dark:bg-zinc-950"
        />
        <button type="button" onClick={onClose} className="text-xs text-zinc-500 hover:underline">
          hide
        </button>
      </div>

      {state === 'loading' && <p className="text-xs text-zinc-500">Loading Google…</p>}
      {state === 'unavailable' && (
        // Naming still works. This is a missing convenience, not a failure.
        <p className="text-xs text-zinc-500">
          Google is unavailable (no key, or no connection) — type the name yourself above.
        </p>
      )}
      <div ref={host} className={state === 'ready' ? 'max-h-64 overflow-y-auto' : 'hidden'} />
      {picked && <p className="mt-1 text-xs text-zinc-500">Chosen id: <span className="font-mono">{picked}</span></p>}
    </div>
  );
}

/* ------------------------------------------------------ manual mode (#30) */

/**
 * Naming a trip that predates position tracking.
 *
 * These trips have no coordinate and never will: the car was not reporting
 * position when they happened. The rest of the panel is built on geometry —
 * nearest place, distance, widen-to-reach — and none of it applies, so this is
 * a different screen rather than the same one with the numbers blanked out.
 *
 * Two answers, in the order you will usually want them:
 *   1. a place you already have — no new geometry, nothing to get wrong
 *   2. a new place, geocoded from an address you type
 *
 * Both stick. plan.ts skips pre-tracking trips before it emits any update, so
 * unlike a hand-picked place on a matchable trip, a re-match cannot undo this.
 */
function ManualPanel({
  evidence,
  busy,
  onAttach,
  onCreateAt,
  onClose,
}: {
  evidence: NamingEvidence;
  busy: boolean;
  onAttach?: (placeId: number) => void;
  onCreateAt?: (input: {
    label: string;
    kind: 'home' | 'business' | 'other';
    query: string;
    googlePlaceId: string | null;
  }) => void;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState('');
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState<'home' | 'business' | 'other'>('business');
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<{ address: string; lat: number; lon: number }[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [googlePlaceId, setGooglePlaceId] = useState<string | null>(null);
  const [googleOpen, setGoogleOpen] = useState(false);

  const book = evidence.places ?? [];
  const needle = filter.trim().toLowerCase();
  const shown = needle === ''
    ? book
    : book.filter(
        (p) => p.label.toLowerCase().includes(needle) || (p.address ?? '').toLowerCase().includes(needle),
      );

  const search = async () => {
    if (query.trim() === '') return;
    setSearching(true);
    try {
      const response = await fetch(`/api/places/geocode?q=${encodeURIComponent(query.trim())}`);
      const body = (await response.json()) as { hits: { address: string; lat: number; lon: number }[] };
      setHits(body.hits);
    } catch {
      // Naming must survive the geocoder being unreachable, so an empty result
      // and a failed request look the same on screen: no hits, type again.
      setHits([]);
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="mt-2 rounded-xl border border-sky-500/30 bg-sky-500/5 p-3 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-medium">Set the place by hand</div>
          <p className="text-xs text-zinc-500">
            This trip predates position tracking — no position was ever recorded, so you say where it ended.
            That sticks: matching leaves these trips alone.
          </p>
        </div>
        <PillButton onClick={onClose}>close</PillButton>
      </div>

      {/* 1. A place you already have. */}
      <div className="mt-3">
        <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">Pick a place you already have</div>
        {book.length === 0 ? (
          <p className="mt-1 text-xs text-zinc-500">The place book is still empty — create one below.</p>
        ) : (
          <>
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="filter by name or address"
              className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-xs dark:border-zinc-800 dark:bg-zinc-950"
            />
            <ul className="mt-1 max-h-40 space-y-1 overflow-y-auto">
              {shown.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3">
                  <span className="min-w-0">
                    <span className="font-medium">{p.label}</span>
                    {p.address && <span className="ml-2 text-xs text-zinc-500">{p.address}</span>}
                  </span>
                  <PillButton
                    on={p.id === evidence.currentPlaceId}
                    disabled={busy || !onAttach}
                    onClick={() => onAttach?.(p.id)}
                  >
                    {p.id === evidence.currentPlaceId ? 'current' : 'pick'}
                  </PillButton>
                </li>
              ))}
              {shown.length === 0 && <li className="text-xs text-zinc-500">Nothing found.</li>}
            </ul>
          </>
        )}
      </div>

      {/* 2. A new place, from an address. */}
      <div className="mt-3 border-t border-zinc-200/60 pt-3 dark:border-zinc-800/60">
        <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">New place from an address</div>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void search();
            }}
            placeholder="address or town, e.g. Giessenweg 5 Rotterdam"
            className="min-w-0 flex-1 rounded-xl border border-zinc-200 bg-white px-3 py-1.5 dark:border-zinc-800 dark:bg-zinc-950"
          />
          <PillButton disabled={busy || searching || query.trim() === ''} onClick={() => void search()}>
            {searching ? 'searching…' : 'find address'}
          </PillButton>
        </div>

        {hits !== null && (
          <ul className="mt-1 space-y-0.5 text-xs">
            {hits.map((hit) => (
              <li key={`${hit.lat},${hit.lon}`}>
                <button
                  type="button"
                  onClick={() => setQuery(hit.address)}
                  className="text-left text-zinc-600 underline-offset-2 hover:underline dark:text-zinc-400"
                >
                  {hit.address}
                </button>
              </li>
            ))}
            {hits.length === 0 && !searching && <li className="text-zinc-500">No address found.</li>}
          </ul>
        )}

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Name for this place"
            className="min-w-0 flex-1 rounded-xl border border-zinc-200 bg-white px-3 py-1.5 dark:border-zinc-800 dark:bg-zinc-950"
          />
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as 'home' | 'business' | 'other')}
            className="rounded-xl border border-zinc-200 bg-white px-2 py-1.5 text-xs dark:border-zinc-800 dark:bg-zinc-950"
          >
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={busy || !onCreateAt || label.trim() === '' || query.trim() === ''}
            onClick={() => onCreateAt?.({ label: label.trim(), kind, query: query.trim(), googlePlaceId })}
            className="rounded-xl bg-sky-500 px-3 py-1.5 text-xs font-medium text-white transition-all hover:bg-sky-600 disabled:opacity-40"
          >
            create
          </button>
        </div>
        {googlePlaceId && (
          <p className="mt-1 text-xs text-zinc-500">
            Google-locatie gekoppeld (id bewaard, naam niet — die typ je zelf).{' '}
            <button type="button" onClick={() => setGooglePlaceId(null)} className="underline underline-offset-2">
              loskoppelen
            </button>
          </p>
        )}
        <p className="mt-1 text-xs text-zinc-500">
          The coordinate comes from OpenStreetMap, not from the car — so it points at the address, not at where you
          actually parked. For future trips you can adjust the radius in the place book.
        </p>
      </div>

      {/* Google, for finding the business by name rather than by address. */}
      <div className="mt-3">
        {googleOpen ? (
          <GooglePanel
            // No coordinate to search around, so the text search carries this
            // panel; the bias below just keeps Dutch results above foreign ones.
            at={{ lat: 52.1, lon: 5.3 }}
            onPick={(id) => setGooglePlaceId(id)}
            picked={googlePlaceId}
            onClose={() => setGoogleOpen(false)}
          />
        ) : (
          <button
            type="button"
            onClick={() => setGoogleOpen(true)}
            className="text-xs text-zinc-500 underline underline-offset-2 hover:text-zinc-800 dark:hover:text-zinc-200"
          >
            search by business name (Google)
          </button>
        )}
      </div>
    </div>
  );
}
