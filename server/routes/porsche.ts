/**
 * HTTP surface for Porsche Connect. Contains no auth logic — that lives in
 * server/porsche/auth.ts (#18).
 *
 * There is no client session: the server holds the token and any request just
 * uses it. `GET /api/porsche/session` exists only so the UI can learn whether
 * a login is needed. This is sound because the container is LAN/VPN-only with
 * no auth (#16) — and it is why CORS is NOT wildcarded here as it was in
 * api/porsche/_utils.js: same-origin now, and a wildcard on an unauthenticated
 * API would let any page the browser visits call this one.
 */

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

import { login } from '../porsche/auth.js';
import * as captchaStore from '../porsche/captchaStore.js';
import { PorscheApiError, measurementQuery, porscheGet } from '../porsche/client.js';
import {
  ALL_MEASUREMENTS,
  OVERVIEW_MEASUREMENTS,
  TRIP_MEASUREMENTS,
} from '../porsche/measurements.js';
import { NotAuthenticatedError, clearSession, getSession } from '../porsche/tokens.js';
import { saveTokens } from '../porsche/tokens.js';

interface LoginBody {
  email?: string;
  password?: string;
  captchaCode?: string;
  captchaId?: string;
}

const porscheRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.get('/session', async () => {
    const session = await getSession();
    if (!session) return { authenticated: false, reason: 'no_session' as const };
    if (session.health === 'reauth_required') {
      return {
        authenticated: false,
        reason: 'reauth_required' as const,
        email: session.accountEmail,
        lastError: session.lastError,
      };
    }
    return {
      authenticated: true,
      email: session.accountEmail,
      expiresAt: session.expiresAt.toISOString(),
      health: session.health,
      lastError: session.lastError,
    };
  });

  app.post<{ Body: LoginBody }>('/login', async (request, reply) => {
    const { email, password, captchaCode, captchaId } = request.body ?? {};
    if (!email || !password) {
      return reply.status(400).send({ error: 'Email and password required' });
    }

    // Resuming after a captcha: the cookie jar and PKCE verifier come from the
    // server-side store, keyed by the opaque id the browser was given.
    let pending;
    if (captchaCode && captchaId) {
      const taken = captchaStore.take(captchaId);
      if (!taken) {
        return reply.status(400).send({ error: 'Captcha expired — please try again' });
      }
      pending = taken;
    }

    const result = await login({ email, password, captchaCode, pending });

    if (result.kind === 'captcha') {
      return reply.status(400).send({
        error: 'Captcha required',
        captchaRequired: true,
        captchaImage: result.image,
        captchaId: captchaStore.put(result.pending),
      });
    }
    if (result.kind === 'error') {
      return reply.status(result.status).send({ error: result.message });
    }

    await saveTokens(result.tokens);
    return { authenticated: true, email: result.tokens.email };
  });

  app.post('/logout', async () => {
    await clearSession();
    return { ok: true };
  });

  app.get('/vehicles', async () => porscheGet('/connect/v1/vehicles'));

  const vehiclePaths = {
    overview: () => measurementQuery(OVERVIEW_MEASUREMENTS),
    status: () => measurementQuery(ALL_MEASUREMENTS),
    trips: () => measurementQuery(TRIP_MEASUREMENTS),
  } as const;

  for (const [name, query] of Object.entries(vehiclePaths)) {
    app.get<{ Params: { vin: string } }>(`/vehicle/:vin/${name}`, async (request) =>
      porscheGet(`/connect/v1/vehicles/${request.params.vin}?${query()}`),
    );
  }

  app.get<{ Params: { vin: string } }>('/vehicle/:vin/capabilities', async (request) =>
    porscheGet(`/connect/v1/vehicles/${request.params.vin}/capabilities`),
  );

  app.get<{ Params: { vin: string } }>('/vehicle/:vin/pictures', async (request) =>
    porscheGet(`/connect/v1/vehicles/${request.params.vin}/pictures`),
  );

  // One place to translate domain errors into HTTP, so no route repeats it.
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof NotAuthenticatedError) {
      return reply.status(401).send({ error: 'Not authenticated', reason: error.reason });
    }
    if (error instanceof PorscheApiError) {
      return reply.status(error.status).send({ error: error.message });
    }
    app.log.error(error);
    return reply.status(500).send({ error: 'Internal error' });
  });
};

export default porscheRoutes;
