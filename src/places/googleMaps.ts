/**
 * Lazy loader for the Maps JavaScript API (#30).
 *
 * Loaded on first panel open and never on page load. The ledger is the screen
 * you sit on while checking a month of your own trips, and it should not
 * contact Google to render them — someone who never opens the naming panel
 * never talks to Google at all.
 *
 * The key comes from /api/config rather than the build, so rotating it is a
 * container restart rather than a rebuild. A null key is not an error: the
 * panel simply has no Google button (#30), and naming by hand still works.
 */

const CONFIG = '/api/config';

declare global {
  interface Window {
    google?: {
      maps?: {
        importLibrary?: (name: string) => Promise<unknown>;
      };
    };
  }
}

let loading: Promise<boolean> | null = null;

/** Makes each attempt's global callback name unique. See loadPlacesUiKit. */
let callbackSeq = 0;

/**
 * How long to wait for Google's callback before calling it unavailable.
 *
 * A rejected key is the case this exists for: the bootstrap stub loads and
 * runs, so `onerror` never fires, but google.maps is never built and the
 * callback is never called. Without a deadline the panel would sit on
 * "loading" for the rest of the session — the one outcome worse than saying
 * Google is unavailable, because it never lets you fall back to typing.
 */
const CALLBACK_TIMEOUT_MS = 10_000;

async function fetchKey(): Promise<string | null> {
  try {
    const response = await fetch(CONFIG);
    if (!response.ok) return null;
    const body = (await response.json()) as { googleMapsApiKey: string | null };
    return body.googleMapsApiKey;
  } catch {
    return null;
  }
}

/**
 * Ensure the Places UI Kit elements are defined.
 *
 * Resolves false — never rejects — when there is no key, when the script will
 * not load, or when Google is unreachable. Every caller treats false as "no
 * Google button", because a naming flow that can fail is a naming flow that
 * can stop you recording where you were (#30).
 *
 * Memoized on the PROMISE, not on the result: two rows opened in quick
 * succession must share one script tag, and a second <script> for the same
 * bootstrap makes the API log a duplicate-loader warning and can double-define
 * the custom elements.
 */
export function loadPlacesUiKit(): Promise<boolean> {
  loading ??= (async () => {
    if (window.google?.maps?.importLibrary) {
      await window.google.maps.importLibrary('places');
      return true;
    }

    const key = await fetchKey();
    if (!key) return false;

    const ok = await new Promise<boolean>((resolve) => {
      const script = document.createElement('script');

      // The `callback` parameter is load-bearing, not ceremony. The script the
      // bootstrap URL returns is a tiny stub: `onload` fires as soon as THAT
      // has run, which is before google.maps exists. Resolving on `onload`
      // therefore reads importLibrary as undefined and every caller concludes
      // "no Google button" — a silent degradation, because this function is
      // deliberately written never to throw. Measured: onload sees undefined,
      // the callback sees a function, and it arrives ~100 ms later.
      const done = `__placesUiKitReady_${(callbackSeq += 1)}`;
      const globals = window as unknown as Record<string, unknown>;
      let deadline: ReturnType<typeof setTimeout> | undefined;

      const settle = (value: boolean) => {
        clearTimeout(deadline);
        delete globals[done];
        resolve(value);
      };

      globals[done] = () => settle(true);
      deadline = setTimeout(() => settle(false), CALLBACK_TIMEOUT_MS);

      script.src =
        `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}` +
        `&v=weekly&libraries=places&loading=async&callback=${done}`;
      script.async = true;
      // `onload` can no longer mean success, but it still cannot mean failure:
      // the stub loads fine when the key is rejected. Only `onerror` is a
      // verdict, and only the callback is a success.
      script.onerror = () => settle(false);
      document.head.appendChild(script);
    });

    if (!ok || !window.google?.maps?.importLibrary) return false;

    try {
      await window.google.maps.importLibrary('places');
      return true;
    } catch {
      return false;
    }
  })();

  return loading;
}

/** Test seam. The module-level promise would otherwise persist across tests. */
export function resetPlacesUiKit(): void {
  loading = null;
}
