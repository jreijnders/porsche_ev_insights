/**
 * Token persistence and the just-in-time refresh (#18).
 *
 * The refresh token now lives in Postgres rather than the browser, because the
 * poller needs it while no browser is open. Stored in plaintext, knowingly:
 * the container is LAN/VPN-only with no auth and the DB password is in .env on
 * the same host, so a key beside the data is ceremony. The real controls are
 * network isolation and host disk encryption.
 */

import { eq } from 'drizzle-orm';

import { porscheSession } from '../../db/schema.js';
import { db } from '../db/client.js';
import { RefreshRejectedError, refresh, type PorscheTokens } from './auth.js';

/** Refresh this far ahead of expiry — the same 60s the original used. */
const EXPIRY_BUFFER_MS = 60_000;

export type AuthHealth = 'healthy' | 'degraded' | 'reauth_required';

export interface SessionRow {
  accountEmail: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  health: AuthHealth;
  lastError: string | null;
}

export class NotAuthenticatedError extends Error {
  constructor(public readonly reason: 'no_session' | 'reauth_required') {
    super(reason);
  }
}

export async function getSession(): Promise<SessionRow | null> {
  const rows = await db.select().from(porscheSession).limit(1);
  return (rows[0] as SessionRow | undefined) ?? null;
}

export async function saveTokens(tokens: PorscheTokens): Promise<void> {
  await db
    .insert(porscheSession)
    .values({
      accountEmail: tokens.email,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      health: 'healthy',
      lastError: null,
      lastRefreshAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: porscheSession.accountEmail,
      set: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
        health: 'healthy',
        lastError: null,
        lastRefreshAt: new Date(),
        updatedAt: new Date(),
      },
    });
}

export async function clearSession(): Promise<void> {
  await db.delete(porscheSession);
}

async function setHealth(email: string, health: AuthHealth, error: string): Promise<void> {
  await db
    .update(porscheSession)
    .set({ health, lastError: error, updatedAt: new Date() })
    .where(eq(porscheSession.accountEmail, email));
}

/**
 * Single-flight guard: without it two concurrent callers can both refresh, and
 * whichever lands second may invalidate the first's token. All waiters share
 * one in-flight promise.
 */
let inFlight: Promise<string> | null = null;

export async function getValidAccessToken(): Promise<string> {
  const session = await getSession();
  if (!session) throw new NotAuthenticatedError('no_session');
  if (session.health === 'reauth_required') throw new NotAuthenticatedError('reauth_required');

  if (session.expiresAt.getTime() - Date.now() > EXPIRY_BUFFER_MS) {
    return session.accessToken;
  }

  inFlight ??= doRefresh(session).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function doRefresh(session: SessionRow): Promise<string> {
  try {
    const next = await refresh(session.refreshToken);
    await saveTokens({ ...next, email: session.accountEmail });
    return next.accessToken;
  } catch (error) {
    if (error instanceof RefreshRejectedError) {
      // Terminal: only a hand-solved captcha recovers from here. Never retried.
      await setHealth(session.accountEmail, 'reauth_required', error.message);
      throw new NotAuthenticatedError('reauth_required');
    }
    // Transient — the caller may try again later; polling continues.
    await setHealth(session.accountEmail, 'degraded', (error as Error).message);
    throw error;
  }
}
