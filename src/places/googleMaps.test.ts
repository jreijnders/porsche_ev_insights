/**
 * @vitest-environment jsdom
 *
 * The Places UI Kit loader (#30).
 *
 * These tests exist because of a defect that shipped and could not be seen:
 * the loader resolved on the script's `onload`, which fires when Google's
 * bootstrap STUB has run — before `google.maps` is built. `importLibrary` read
 * as undefined, the loader returned false, and every caller quietly rendered
 * "no Google button". Nothing threw and nothing logged, so the Google half of
 * the naming flow was simply absent in every real browser.
 *
 * The fix is the `callback` parameter. What is pinned here is the ORDERING —
 * a fake bootstrap that fires `onload` first and the callback afterwards, the
 * way the real one does.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadPlacesUiKit, resetPlacesUiKit } from './googleMaps.js';

/** Pulls the callback name out of the src the loader built. */
function callbackNameOf(src: string): string {
  return new URL(src).searchParams.get('callback') ?? '';
}

/**
 * Stands in for Google's bootstrap.
 *
 * `onload` first with google.maps still absent, then — a tick later — define
 * importLibrary and call the callback. That order is the whole bug.
 */
function fakeBootstrap(options: { fireCallback: boolean } = { fireCallback: true }) {
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof HTMLScriptElement)) continue;
        const name = callbackNameOf(node.src);

        node.onload?.(new Event('load'));

        if (!options.fireCallback) continue;
        queueMicrotask(() => {
          window.google = { maps: { importLibrary: vi.fn().mockResolvedValue({}) } };
          (window as unknown as Record<string, () => void>)[name]?.();
        });
      }
    }
  });
  observer.observe(document.head, { childList: true });
  return observer;
}

describe('loadPlacesUiKit', () => {
  let observer: MutationObserver | undefined;

  beforeEach(() => {
    resetPlacesUiKit();
    delete window.google;
    // jsdom keeps one document for the whole file, so a script appended by an
    // earlier test would still be here and the "no key" case would read as if
    // it had loaded one.
    document.head.replaceChildren();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ googleMapsApiKey: 'AIza-test' }) }),
    );
  });

  afterEach(() => {
    observer?.disconnect();
    observer = undefined;
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('waits for the callback rather than onload', async () => {
    observer = fakeBootstrap();

    await expect(loadPlacesUiKit()).resolves.toBe(true);
    expect(window.google?.maps?.importLibrary).toHaveBeenCalledWith('places');
  });

  it('asks for the callback by name in the bootstrap URL', async () => {
    observer = fakeBootstrap();
    await loadPlacesUiKit();

    const script = document.head.querySelector('script');
    const src = script?.src ?? '';
    expect(callbackNameOf(src)).not.toBe('');
    expect(src).toContain('loading=async');
    expect(src).toContain('libraries=places');
  });

  it('cleans the callback off window once it has fired', async () => {
    observer = fakeBootstrap();
    await loadPlacesUiKit();

    const name = callbackNameOf(document.head.querySelector('script')?.src ?? '');
    expect(name in window).toBe(false);
  });

  /**
   * A rejected key loads the stub fine, so `onerror` never fires and the
   * callback never comes. Without the deadline the panel would sit on
   * "loading" forever instead of falling back to naming by hand.
   */
  it('gives up rather than hanging when the callback never comes', async () => {
    vi.useFakeTimers();
    observer = fakeBootstrap({ fireCallback: false });

    const pending = loadPlacesUiKit();
    await vi.advanceTimersByTimeAsync(11_000);

    await expect(pending).resolves.toBe(false);
  });

  it('reports unavailable rather than throwing when there is no key', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ googleMapsApiKey: null }) }));

    await expect(loadPlacesUiKit()).resolves.toBe(false);
    expect(document.head.querySelector('script')).toBeNull();
  });
});
