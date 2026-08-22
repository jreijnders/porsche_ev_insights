/**
 * Fastify bootstrap: serves the API and, in production, the built SPA.
 *
 * Replaces both the Vercel functions (api/porsche/**) and the Express dev
 * proxy (server/index.js). Neither has moved yet — the Porsche routes arrive
 * in #18, and the old files are deleted there. Until then this serves the
 * dashboard and /api/health only.
 */

import { fileURLToPath } from 'node:url';
import path from 'node:path';

import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { sql } from 'drizzle-orm';

import { db } from './db/client.js';
import { getEnv } from './env.js';
import porscheRoutes from './routes/porsche.js';

const env = getEnv();

const here = path.dirname(fileURLToPath(import.meta.url));
/** dist-server/server/index.js -> repo root */
const repoRoot = path.resolve(here, '..', '..');

const app = Fastify({
  logger: {
    level: env.isProduction ? 'info' : 'debug',
    transport: env.isProduction ? undefined : { target: 'pino-pretty' },
  },
});

app.get('/api/health', async () => {
  // Prove the database is actually reachable, not just that the process is up.
  await db.execute(sql`select 1`);
  return { ok: true, env: env.nodeEnv };
});

await app.register(porscheRoutes, { prefix: '/api/porsche' });

if (env.isProduction) {
  const dist = path.join(repoRoot, 'dist');
  await app.register(fastifyStatic, { root: dist });

  // SPA fallback: anything not under /api and not a real file gets index.html.
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/')) {
      return reply.status(404).send({ error: 'Not found' });
    }
    return reply.sendFile('index.html');
  });
}

async function shutdown(signal: string) {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

try {
  await app.listen({ port: env.port, host: env.host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
