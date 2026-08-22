/**
 * Applies pending migrations, then exits. Run before the server starts, so a
 * failed migration means the app plainly does not come up rather than serving
 * against a schema it does not expect.
 *
 * Uses drizzle-orm's own migrator, which keeps drizzle-kit a devDependency —
 * it never ships in the runtime image. Generate migrations on your machine
 * with `npm run db:generate`.
 */

import { migrate } from 'drizzle-orm/postgres-js/migrator';

import { db, sql } from './db/client.js';

const migrationsFolder = process.env.MIGRATIONS_FOLDER ?? 'db/migrations';

try {
  console.log(`[migrate] applying migrations from ${migrationsFolder}`);
  await migrate(db, { migrationsFolder });
  console.log('[migrate] up to date');
  await sql.end();
  process.exit(0);
} catch (error) {
  console.error('[migrate] failed:', error);
  await sql.end({ timeout: 5 }).catch(() => {});
  process.exit(1);
}
