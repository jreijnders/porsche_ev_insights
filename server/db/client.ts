import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from '../../db/schema.js';
import { getEnv } from '../env.js';

/**
 * One long-lived pool for the process. postgres.js is pure JS — nothing to
 * compile in the Debian-slim image.
 */
export const sql = postgres(getEnv().databaseUrl, { max: 10 });

export const db = drizzle(sql, { schema });

export type Db = typeof db;
