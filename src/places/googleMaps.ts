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
      // `loading=async` is what makes the bootstrap define importLibrary
      // instead of blocking on a global callback.
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&libraries=places&loading=async`;
      script.async = true;
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
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
