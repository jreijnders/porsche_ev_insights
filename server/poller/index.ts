/**
 * The harvester loop (#13, #20).
 *
 * One setInterval in-process, immediate poll on boot. A restart mid-interval
 * polls early, which cannot lose data: position is pushed on events, so an
 * early read costs one request and no information.
 */

import type { FastifyBaseLogger } from 'fastify';

import { NotAuthenticatedError } from '../porsche/tokens.js';
import { PorscheApiError, measurementQuery, porscheGet } from '../porsche/client.js';
import { OVERVIEW_MEASUREMENTS, TRIP_MEASUREMENTS } from '../porsche/measurements.js';
import { classify, reactionFor, retryDelayMs } from './backoff.js';
import {
  ingestTrips,
  needsInitialTripSync,
  pruneSegments,
  recordPoll,
  upsertVehicle,
  writeObservations,
} from './ingest.js';
import type { MeasurementPayload } from './parse.js';

/**
 * Cycles to keep reading trip history after the odometer moves.
 *
 * Not 1: trip history lags the drive. A trip only enters
 * TRIP_STATISTICS_SHORT_TERM_HISTORY when the NEXT trip begins (#15 probe), so
 * a strict "only when the odometer changed" check would miss it entirely.
 */
const STICKY_TRIP_CYCLES = 4;

interface VehicleListItem {
  vin: string;
  modelName?: string;
  modelType?: { code?: string };
}

export class Harvester {
  private timer: NodeJS.Timeout | null = null;
  private stickyCycles = 0;
  private skipCycles = 0;
  private running = false;

  constructor(
    private readonly log: FastifyBaseLogger,
    private readonly intervalMinutes: number,
  ) {}

  start(): void {
    if (this.timer) return;
    this.log.info({ intervalMinutes: this.intervalMinutes }, '[harvester] starting');
    this.timer = setInterval(() => void this.tick(), this.intervalMinutes * 60_000);
    void this.tick();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    this.log.info('[harvester] stopped');
  }

  /** Called after a successful login so polling resumes without a restart. */
  restart(): void {
    this.stop();
    this.skipCycles = 0;
    this.start();
  }

  private async tick(): Promise<void> {
    if (this.running) {
      this.log.warn('[harvester] previous cycle still running, skipping');
      return;
    }
    if (this.skipCycles > 0) {
      this.skipCycles -= 1;
      this.log.info({ remaining: this.skipCycles }, '[harvester] backing off');
      return;
    }

    this.running = true;
    const now = new Date();
    try {
      await this.cycle(now);
    } catch (error) {
      await this.handleFailure(error, now);
    } finally {
      this.running = false;
    }
  }

  private async cycle(now: Date): Promise<void> {
    const vehicles = await porscheGet<VehicleListItem[]>('/connect/v1/vehicles');
    const list = Array.isArray(vehicles) ? vehicles : [];
    if (list.length === 0) {
      this.log.warn('[harvester] no vehicles returned');
      return;
    }

    for (const vehicle of list) {
      const vin = vehicle.vin;
      if (!vin) continue;

      // Must come first: every ledger table has a FK to vehicle.vin.
      await upsertVehicle(vin, vehicle.modelName ?? null, vehicle.modelType?.code ?? null);

      const overview = await porscheGet<MeasurementPayload>(
        `/connect/v1/vehicles/${vin}?${measurementQuery(OVERVIEW_MEASUREMENTS)}`,
      );
      const writes = await writeObservations(vin, overview);

      // Odometer movement means a new trip started, which is exactly the event
      // that flushes the previous one into history.
      if (writes.odometerMoved) this.stickyCycles = STICKY_TRIP_CYCLES;

      // A vehicle with no watermark has never been synced: pull whatever
      // history the API still holds, or the ledger stays empty until the next
      // drive.
      if (this.stickyCycles === 0 && (await needsInitialTripSync(vin))) {
        this.log.info({ vin }, '[harvester] initial trip sync');
        this.stickyCycles = 1;
      }

      let ingest = null;
      if (this.stickyCycles > 0) {
        const trips = await porscheGet<MeasurementPayload>(
          `/connect/v1/vehicles/${vin}?${measurementQuery(TRIP_MEASUREMENTS)}`,
        );
        ingest = await ingestTrips(vin, trips, now);
        this.stickyCycles -= 1;
      }

      await recordPoll(vin, true, 'healthy', null, now);
      this.log.info(
        {
          vin,
          samples: writes.samplesWritten,
          odometer: writes.odometerWritten,
          moved: writes.odometerMoved,
          sticky: this.stickyCycles,
          ingest,
        },
        '[harvester] cycle complete',
      );
    }

    const pruned = await pruneSegments(now);
    if (pruned > 0) this.log.info({ pruned }, '[harvester] pruned expired segments');
  }

  private async handleFailure(error: unknown, now: Date): Promise<void> {
    const isAuth = error instanceof NotAuthenticatedError;
    const status = error instanceof PorscheApiError ? error.status : null;
    const cause = classify(status, isAuth);
    const reaction = reactionFor(cause);
    const detail = error instanceof Error ? error.message : String(error);

    this.log.error({ cause, status, detail }, '[harvester] cycle failed');
    await recordPoll('', false, reaction.health, `${cause}: ${detail}`, now).catch(() => {
      // sync_state is keyed by vin; a pre-vehicle failure has nowhere to land.
    });

    if (reaction.stop) {
      this.log.error('[harvester] auth rejected — stopping. Re-authenticate to resume.');
      this.stop();
      return;
    }
    if (reaction.skipIntervals > 0) this.skipCycles = reaction.skipIntervals;

    for (let attempt = 0; attempt < reaction.retriesInCycle; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs(attempt)));
      try {
        await this.cycle(new Date());
        this.log.info({ attempt }, '[harvester] recovered on retry');
        return;
      } catch {
        // keep retrying until the budget is spent
      }
    }
  }
}

let harvester: Harvester | null = null;

export function initHarvester(log: FastifyBaseLogger, intervalMinutes: number): Harvester {
  harvester ??= new Harvester(log, intervalMinutes);
  return harvester;
}

export function getHarvester(): Harvester | null {
  return harvester;
}
