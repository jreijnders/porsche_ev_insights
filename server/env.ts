/**
 * Environment parsing. Fails loudly at boot rather than producing undefined
 * behaviour three layers in — a misconfigured container should not start.
 *
 * `parseEnv` takes its source as an argument so it is testable without
 * mutating the real process environment.
 */

export interface Env {
  databaseUrl: string;
  port: number;
  host: string;
  nodeEnv: string;
  /** Poll interval for the position harvester. 15 min default — see #21 on the map. */
  pollIntervalMinutes: number;
  isProduction: boolean;
}

type Source = Record<string, string | undefined>;

function required(source: Source, name: string): string {
  const value = source[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function optionalInt(source: Source, name: string, fallback: number): number {
  const raw = source[name];
  if (raw === undefined || raw === '') return fallback;
  if (!/^-?\d+$/.test(raw)) throw new Error(`${name} must be an integer, got: ${raw}`);
  return Number.parseInt(raw, 10);
}

export function parseEnv(source: Source): Env {
  const nodeEnv = source.NODE_ENV ?? 'development';
  const pollIntervalMinutes = optionalInt(source, 'POLL_INTERVAL_MINUTES', 15);
  if (pollIntervalMinutes < 1) {
    throw new Error(`POLL_INTERVAL_MINUTES must be at least 1, got: ${pollIntervalMinutes}`);
  }
  return {
    databaseUrl: required(source, 'DATABASE_URL'),
    port: optionalInt(source, 'PORT', 3001),
    host: source.HOST ?? '0.0.0.0',
    nodeEnv,
    pollIntervalMinutes,
    isProduction: nodeEnv === 'production',
  };
}

let cached: Env | undefined;

/**
 * Lazily parsed, memoized. Deliberately not a module-level constant: that
 * made importing this file for `parseEnv` throw when the environment was not
 * configured, which broke the tests and would have broken any future test
 * that transitively imported it.
 */
export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
