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

export interface NamingEvidence {
  at: { lat: number; lon: number };
  address: string | null;
  candidates: NamingCandidate[];
  currentPlaceId?: number | null;
  ceilingM: number;
}

export interface NamePlacePanelProps {
  evidence: NamingEvidence;
  busy: boolean;
  /** Create a place here. `googlePlaceId` is null unless one was picked. */
  onCreate: (input: { label: string; kind: 'home' | 'business' | 'other'; googlePlaceId: string | null }) => void;
  /** Widen an existing place to reach this fix. */
  onWiden: (placeId: number, override: boolean) => void;
  onClose: () => void;
}

const KINDS: { value: 'home' | 'business' | 'other'; label: string }[] = [
  { value: 'business', label: 'zakelijk adres' },
  { value: 'home', label: 'thuis' },
  { value: 'other', label: 'overig' },
];

export default function NamePlacePanel({
  evidence,
  busy,
  onCreate,
  onWiden,
  onClose,
}: NamePlacePanelProps) {
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState<'home' | 'business' | 'other'>('business');
  const [googlePlaceId, setGooglePlaceId] = useState<string | null>(null);
  const [googleOpen, setGoogleOpen] = useState(false);

  return (
    <div className="mt-2 rounded-lg border border-zinc-300 bg-white p-3 text-sm dark:border-zinc-700 dark:bg-zinc-900">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium">
            {evidence.address ?? (
              <span className="font-mono text-zinc-500">
                {evidence.at.lat.toFixed(5)}, {evidence.at.lon.toFixed(5)}
              </span>
            )}
          </div>
          {evidence.address && (
            <div className="font-mono text-xs text-zinc-500">
              {evidence.at.lat.toFixed(5)}, {evidence.at.lon.toFixed(5)}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded px-2 py-0.5 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          sluiten
        </button>
      </div>

      {/* Known places first. Half of all unmatched arrivals are a place you
          already have, sitting just outside its radius — offering "create new"
          without saying so is how you end up with two places for one spot. */}
      <div className="mt-3">
        <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">Bekende locaties in de buurt</div>
        {evidence.candidates.length === 0 ? (
          <p className="mt-1 text-xs text-zinc-500">Geen bekende locatie binnen 1 km — dit is een nieuwe plek.</p>
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
                    <span className="text-xs text-zinc-500">huidige keuze</span>
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
                    <span className="text-xs text-zinc-500" title="Bereikt deze plek ook — pas de straal aan in het locatieboek om de dubbelzinnigheid op te lossen">
                      bereikt deze plek ook
                    </span>
                  )
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onWiden(c.placeId, c.widenNeedsOverride)}
                    title={
                      c.widenNeedsOverride
                        ? `Boven ${evidence.ceilingM} m gaat een locatie de buren opslokken`
                        : undefined
                    }
                    className={[
                      'rounded border px-2 py-0.5 text-xs disabled:opacity-50',
                      // The size is the button's headline, and above the
                      // ceiling it stops looking like an ordinary action (#30).
                      c.widenNeedsOverride
                        ? 'border-amber-400 text-amber-800 hover:bg-amber-50 dark:border-amber-500/50 dark:text-amber-300 dark:hover:bg-amber-950/40'
                        : 'border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800',
                    ].join(' ')}
                  >
                    {c.widenNeedsOverride ? '⚠ ' : ''}
                    {c.label} oprekken naar {c.widenToM} m
                  </button>
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
            Twee locaties liggen bijna even dichtbij. Verklein in het{' '}
            <a href="/places" className="underline underline-offset-2">
              locatieboek
            </a>{' '}
            de straal van de verkeerde — een handmatige keuze hier zou bij de volgende match weer verdwijnen.
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
            placeholder="Naam voor deze locatie"
            className="min-w-0 flex-1 rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-950"
          />
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as 'home' | 'business' | 'other')}
            className="rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-950"
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
            className="rounded bg-zinc-900 px-3 py-1 text-xs font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
          >
            opslaan
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
      </div>

      {/* Google, last and on demand. */}
      <div className="mt-3">
        {googleOpen ? (
          <GooglePanel
            at={evidence.at}
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
            wie zit hier? (Google)
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
    <div className="rounded border border-zinc-200 p-2 dark:border-zinc-800">
      <div className="mb-2 flex items-center justify-between gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="zoek op naam (leeg = in de buurt)"
          className="min-w-0 flex-1 rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-950"
        />
        <button type="button" onClick={onClose} className="text-xs text-zinc-500 hover:underline">
          verbergen
        </button>
      </div>

      {state === 'loading' && <p className="text-xs text-zinc-500">Google laden…</p>}
      {state === 'unavailable' && (
        // Naming still works. This is a missing convenience, not a failure.
        <p className="text-xs text-zinc-500">
          Google is niet beschikbaar (geen sleutel of geen verbinding) — typ de naam zelf hierboven.
        </p>
      )}
      <div ref={host} className={state === 'ready' ? 'max-h-64 overflow-y-auto' : 'hidden'} />
      {picked && <p className="mt-1 text-xs text-zinc-500">Gekozen id: <span className="font-mono">{picked}</span></p>}
    </div>
  );
}
