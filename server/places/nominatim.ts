/**
 * Reverse geocoding via Nominatim (#30).
 *
 * Why this exists at all: #5 found Google names and addresses may never be
 * cached, but OSMF's Geocoding Guideline EXPRESSLY PERMITS permanent storage
 * of Nominatim results. And #5's OSM failure was company NAMES, not addresses
 * — Dutch addresses come from the BAG import and are effectively complete. So
 * this is the one recognisable string the ledger may keep forever, for free,
 * with no key and no billing.
 *
 * Server-side rather than in the browser (#30): one User-Agent we control and
 * ONE place to enforce the usage policy. Nominatim is a donated public
 * resource and its policy asks for at most 1 request per second and a real
 * identifying User-Agent; a browser-side call has neither a queue nor an
 * identity, and abusing it gets the whole service blocked, not one page.
 *
 * Every failure here is soft. Naming a place must work when Nominatim is
 * unreachable (#30) — the panel falls back to showing the coordinate.
 */

const ENDPOINT = 'https://nominatim.openstreetmap.org/reverse';
const SEARCH_ENDPOINT = 'https://nominatim.openstreetmap.org/search';

/** The policy asks for one request a second. Enforced by a serialised queue. */
const MIN_GAP_MS = 1_100;

/**
 * Identifies this deployment, as the policy requires. A generic agent string
 * is what gets a client blocked, so this names the project rather than a
 * library.
 */
const USER_AGENT = 'porsche-rittenregistratie/1.0 (self-hosted; https://github.com/jreijnders/porsche_ev_insights)';

const TIMEOUT_MS = 8_000;

export interface ReverseResult {
  /** A Dutch address line: "Giessenweg 5, 3044 AK Rotterdam". */
  address: string;
  source: 'nominatim';
}

interface NominatimAddress {
  road?: string;
  house_number?: string;
  postcode?: string;
  city?: string;
  town?: string;
  village?: string;
  municipality?: string;
}

/**
 * Build our own line rather than using `display_name`.
 *
 * `display_name` is a comma-salad that repeats the country twice and includes
 * the neighbourhood and province — "152, Groothandelsmarkt, Spaanse Polder,
 * Rotterdam, Zuid-Holland, Nederland, 3044 HE, Nederland". Composing from the
 * structured fields gives a line that reads like an address someone would
 * write down, which is the whole point of showing it.
 */
export function formatAddress(address: NominatimAddress): string | null {
  const street = [address.road, address.house_number].filter(Boolean).join(' ');
  const city = address.city ?? address.town ?? address.village ?? address.municipality;
  const line = [street || null, [address.postcode, city].filter(Boolean).join(' ') || null]
    .filter(Boolean)
    .join(', ');
  return line || null;
}

/* ------------------------------------------------------------------ queue */

let nextSlot = 0;

/**
 * Serialises calls at least MIN_GAP_MS apart, across every caller in the
 * process. A per-call sleep would not do it: two concurrent requests would
 * each wait and then fire together, which is exactly the burst the policy
 * forbids.
 */
async function takeSlot(): Promise<void> {
  const now = Date.now();
  const at = Math.max(now, nextSlot);
  nextSlot = at + MIN_GAP_MS;
  const wait = at - now;
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
}

/* ------------------------------------------------------------------ cache */

/**
 * Keyed on the coordinate rounded to ~11 m. Two arrivals in one car park
 * should not be two calls, and an address does not change between them.
 * Unbounded on purpose: one entry per distinct spot the car has ever stopped,
 * which is a few hundred over the life of this deployment.
 */
const cache = new Map<string, ReverseResult | null>();

const cacheKey = (lat: number, lon: number): string => `${lat.toFixed(4)},${lon.toFixed(4)}`;

/**
 * The address at a coordinate, or null if Nominatim could not say.
 *
 * Never throws. A null here means "no address to show", and every caller
 * treats that as "show the coordinate instead" rather than as an error —
 * naming a place may not depend on a third party being up (#30).
 */
export async function reverseGeocode(lat: number, lon: number): Promise<ReverseResult | null> {
  const key = cacheKey(lat, lon);
  if (cache.has(key)) return cache.get(key) ?? null;

  await takeSlot();

  const url = `${ENDPOINT}?format=jsonv2&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`;
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'nl' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      // Deliberately NOT cached: a 429 or a 503 is a statement about right
      // now, and caching it would turn a minute of throttling into a
      // permanently address-less place.
      return null;
    }
    const body = (await response.json()) as { address?: NominatimAddress };
    const address = body.address ? formatAddress(body.address) : null;
    const result = address ? ({ address, source: 'nominatim' } as const) : null;
    cache.set(key, result);
    return result;
  } catch {
    return null;
  }
}

/** Test seam — the cache is process-wide and would otherwise leak between tests. */
export function clearReverseCache(): void {
  cache.clear();
  nextSlot = 0;
}

/* ----------------------------------------------------------- forward search */

export interface GeocodeHit {
  address: string;
  lat: number;
  lon: number;
}

/**
 * Text to coordinates, for trips that predate position tracking (#30).
 *
 * Those trips have no fix, so there is no coordinate to name — the only way to
 * give one a destination is to say where it was. Nominatim is the right source
 * for that and not just the convenient one: OSMF permits permanent storage, so
 * the coordinate this returns may become a durable place. Google's may not —
 * its lat/lng caching allowance is 30 days (#5), which is no basis for a
 * coordinate that has to keep matching trips for years.
 *
 * Restricted to the countries the car is actually driven in, so "Marnixstraat"
 * does not return a street in Jakarta above the one in Haarlem.
 */
export async function searchPlaces(query: string, limit = 6): Promise<GeocodeHit[]> {
  const q = query.trim();
  if (q === '') return [];

  await takeSlot();

  const url =
    `${SEARCH_ENDPOINT}?format=jsonv2&addressdetails=1&limit=${limit}` +
    `&countrycodes=nl,be,de,fr,lu&q=${encodeURIComponent(q)}`;

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'nl' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return [];
    const body = (await response.json()) as {
      lat: string;
      lon: string;
      display_name?: string;
      address?: NominatimAddress;
    }[];

    return body
      .map((hit) => ({
        // Our own composed line where the structured fields allow it, falling
        // back to display_name: a search hit may be a whole city, which has no
        // road or house number to compose from.
        address: (hit.address ? formatAddress(hit.address) : null) ?? hit.display_name ?? '',
        lat: Number(hit.lat),
        lon: Number(hit.lon),
      }))
      .filter((hit) => hit.address !== '' && Number.isFinite(hit.lat) && Number.isFinite(hit.lon));
  } catch {
    return [];
  }
}
