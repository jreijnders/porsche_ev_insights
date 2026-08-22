/**
 * Server-side holding pen for a login paused on a captcha (#18).
 *
 * The browser only ever sees an opaque id. The cookie jar and PKCE verifier
 * stay here — they are cryptographic material the browser has no business
 * holding, and the only reason the original implementation shipped them to the
 * client was that Vercel functions have no memory.
 *
 * In-memory on purpose: these entries are valid for minutes. A container
 * restart mid-captcha means logging in again, which is fine.
 */

import crypto from 'node:crypto';

import type { PendingLogin } from './auth.js';

const TTL_MS = 5 * 60 * 1000;

interface Entry {
  pending: PendingLogin;
  expiresAt: number;
}

const entries = new Map<string, Entry>();

function prune(now: number): void {
  for (const [id, entry] of entries) {
    if (entry.expiresAt <= now) entries.delete(id);
  }
}

export function put(pending: PendingLogin): string {
  const now = Date.now();
  prune(now);
  const id = crypto.randomBytes(16).toString('base64url');
  entries.set(id, { pending, expiresAt: now + TTL_MS });
  return id;
}

/** Single-use: taking an entry removes it, so a code cannot be replayed. */
export function take(id: string): PendingLogin | null {
  const now = Date.now();
  prune(now);
  const entry = entries.get(id);
  if (!entry) return null;
  entries.delete(id);
  return entry.pending;
}

export function size(): number {
  prune(Date.now());
  return entries.size;
}
