/**
 * Authenticated reads against api.ppa.porsche.com.
 *
 * Uses the STORED read path — `mf=` filters only, never `wakeUpJob` — which
 * per the GPS research (#3) does not wake the vehicle. Repeated wakes are a
 * documented 12V-drain hazard. Keep it that way.
 */

import { CONFIG } from './config.js';
import { getValidAccessToken } from './tokens.js';

export class PorscheApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function porscheGet<T>(path: string): Promise<T> {
  const accessToken = await getValidAccessToken();
  const response = await fetch(`${CONFIG.API_BASE_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': CONFIG.USER_AGENT,
      'x-client-id': CONFIG.X_CLIENT_ID,
    },
  });

  if (!response.ok) {
    throw new PorscheApiError(response.status, `Porsche API ${response.status} for ${path}`);
  }
  return (await response.json()) as T;
}

/** Builds the repeated `mf=` query the vehicle endpoint expects. */
export function measurementQuery(measurements: readonly string[]): string {
  return measurements.map((m) => `mf=${m}`).join('&');
}
