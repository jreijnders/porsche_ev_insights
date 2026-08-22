/**
 * Probe what the Porsche API's trip history actually returns (#15).
 *
 * Exists because the eviction question cannot be answered by one call: whether
 * history is capped by COUNT or by AGE only shows up by comparing the same
 * probe taken days apart. Run it, keep the output, run it again later.
 *
 *   npx tsx --env-file=.env scripts/probe-trip-history.ts [out.json]
 *
 * ONE call, no retries. Uses the stored-read path (`mf=` filters only, never
 * wakeUpJob) — the same path the poller already uses every 15 minutes, so this
 * costs one extra read against a budget measured at ~96/day.
 *
 * If it fails, STOP. Never re-run on an auth failure: the one documented
 * account block came from a login retry loop, not from reading too often.
 */

import { writeFileSync } from 'node:fs';

import { vehicle } from '../db/schema.js';
import { db } from '../server/db/client.js';
import { measurementQuery, porscheGet } from '../server/porsche/client.js';
import { TRIP_MEASUREMENTS } from '../server/porsche/measurements.js';

interface Measurement {
  key: string;
  status?: { isEnabled?: boolean; isAvailable?: boolean };
  value?: { list?: unknown[] } & Record<string, unknown>;
}

const rows = await db.select({ vin: vehicle.vin }).from(vehicle);
if (rows.length === 0) throw new Error('no vehicle row — nothing to probe');
const vin = rows[0].vin;

// TRIP_MEASUREMENTS plus the key this ticket asks about, which is absent from
// the app's own list. Probed here rather than added there — see measurements.ts.
const probe = [...TRIP_MEASUREMENTS, 'TRIP_STATISTICS_MONTHLY_REPORT'];

const payload = await porscheGet<{ measurements?: Measurement[] }>(
  `/connect/v1/vehicles/${vin}?${measurementQuery(probe)}`,
);

const measurements = payload.measurements ?? [];
console.log(`VIN …${vin.slice(-6)} · probed ${new Date().toISOString()}\n`);

for (const m of measurements.sort((a, b) => a.key.localeCompare(b.key))) {
  const disabled = m.status?.isEnabled === false;
  console.log(`── ${m.key}${disabled ? '  [isEnabled:false]' : ''}`);

  if (!m.value) {
    console.log('   no value\n');
    continue;
  }

  // History keys carry their array under `list` — the same key production reads
  // (server/poller/parse.ts). Singular keys carry one flat object.
  const list = Array.isArray(m.value.list) ? (m.value.list as Record<string, unknown>[]) : null;
  if (!list) {
    console.log(`   single: ${JSON.stringify(m.value)}\n`);
    continue;
  }

  const times = list.map((e) => String(e.tripEndTime ?? '')).filter(Boolean);
  const sorted = [...times].sort();
  console.log(`   ${list.length} entries`);
  if (sorted.length) {
    console.log(`   oldest ${sorted[0]}`);
    console.log(`   newest ${sorted[sorted.length - 1]}`);
  }
  if (list.length) console.log(`   entry keys: ${Object.keys(list[0]).join(', ')}`);
  // Observed unordered on 2026-08-22. The sorts in parse/merge depend on this.
  const descending = times.every((t, i) => i === 0 || t <= times[i - 1]);
  console.log(`   returned order: ${descending ? 'newest first' : 'NOT sorted by time'}`);
  console.log();
}

const out = process.argv[2];
if (out) {
  writeFileSync(out, JSON.stringify(payload, null, 2));
  console.log(`full payload → ${out}`);
}

console.log(
  '\nCompare `entries` and `oldest` against the previous run:\n' +
    '  oldest moved forward, count steady  → time-based eviction\n' +
    '  count capped, oldest drops per trip → count-based eviction\n' +
    '  both unchanged                      → nothing evicted yet; probe again later',
);

process.exit(0);
