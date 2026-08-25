/**
 * Browser-facing configuration (#30).
 *
 * The Places UI Kit runs in the browser, so it needs the Maps key there. One
 * key cannot serve both sides: an HTTP-referrer restriction blocks this
 * server's own calls, which send no referrer. A second, referrer-locked
 * browser key was weighed and rejected — single user, private network, no
 * authentication, free IDs-Only SKUs — so the existing key is served here.
 *
 * That choice leans entirely on the API restriction decided in #7 (Places API
 * (New) only), which as of writing is NOT applied. Until it is, this endpoint
 * hands out a key that can spend against every API on the project.
 *
 * Served from an endpoint rather than baked into the bundle at build time, so
 * rotating the key is a container restart rather than a rebuild.
 */

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

import { getEnv } from '../env.js';

const configRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.get('/', async () => {
    const env = getEnv();
    return {
      // null, not "", so the client's check is `=== null` rather than a
      // falsy test that a whitespace key would sneak past. env.ts already
      // trims blanks to null; this preserves that distinction over the wire.
      googleMapsApiKey: env.googleMapsApiKey,
    };
  });
};

export default configRoutes;
