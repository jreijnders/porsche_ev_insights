/**
 * Pure helpers for the Auth0 login walk, lifted unchanged from
 * api/porsche/login.js.
 *
 * They live apart from the flow itself for one reason: they are the parts a
 * porting mistake would silently break, and here they can be tested without
 * touching the network (#18).
 */

import crypto from 'node:crypto';

import { JSDOM } from 'jsdom';

export function generatePKCEVerifier(): string {
  return crypto.randomBytes(64).toString('base64url');
}

export function buildPKCEChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

export function generateState(): string {
  return Math.random().toString(36).substring(2, 15);
}

export interface UniversalLoginContext {
  state?: string;
  transaction?: { state?: string };
  screen?: {
    captcha?: { image?: string };
    errors?: Array<{ message?: string }>;
    error?: { message?: string };
  };
}

/**
 * Auth0's Universal Login pages embed their context as base64 JSON inside an
 * `atob("...")` call. This is how the captcha image and the transaction state
 * are recovered.
 */
export function extractUniversalLoginContext(html: string): UniversalLoginContext | null {
  const match = html.match(/atob\("([A-Za-z0-9+/=]+)"\)/);
  if (!match?.[1]) return null;
  try {
    return JSON.parse(Buffer.from(match[1], 'base64').toString('utf-8')) as UniversalLoginContext;
  } catch {
    return null;
  }
}

/**
 * Cookie jar: merges by name so a later Set-Cookie replaces an earlier value
 * rather than accumulating duplicates.
 */
export function mergeCookies(existingCookieStr: string, response: Response): string {
  const jar = new Map<string, string>();
  if (existingCookieStr) {
    for (const pair of existingCookieStr.split('; ')) {
      const eqIdx = pair.indexOf('=');
      if (eqIdx > 0) jar.set(pair.substring(0, eqIdx), pair);
    }
  }
  const setCookies = response.headers.getSetCookie?.() ?? [];
  for (const raw of setCookies) {
    const nameValue = raw.split(';')[0] ?? '';
    const eqIdx = nameValue.indexOf('=');
    if (eqIdx > 0) jar.set(nameValue.substring(0, eqIdx), nameValue);
  }
  return Array.from(jar.values()).join('; ');
}

export function resolveUrl(location: string | null, baseUrl: string): string | null {
  if (!location) return null;
  if (location.startsWith('http://') || location.startsWith('https://')) {
    return location;
  }
  try {
    return new URL(location, baseUrl).toString();
  } catch {
    return null;
  }
}

/** Reads a hidden form input's value out of an HTML page. */
export function readInputValue(html: string, name: string): string | null {
  const dom = new JSDOM(html);
  const input = dom.window.document.querySelector(`input[name="${name}"]`);
  return input?.getAttribute('value') ?? null;
}

/** Legacy (pre-ACUL) captcha: a plain <img alt="captcha">. */
export function readLegacyCaptchaSrc(html: string): string | null {
  const dom = new JSDOM(html);
  return dom.window.document.querySelector('img[alt="captcha"]')?.getAttribute('src') ?? null;
}
