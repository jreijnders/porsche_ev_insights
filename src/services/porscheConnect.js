/**
 * Porsche Connect API Service
 *
 * Handles communication with the Porsche Connect proxy server
 * for live data retrieval from Porsche vehicles.
 */

import { PORSCHE_EV_MODELS } from '../constants/porscheEvModels';

// The server holds the Porsche session (#18). In development Vite proxies
// /api to Fastify, so the API is same-origin in both environments — the old
// IS_DEV / Vercel path juggling is gone, as is the x-session-id header.
const API_BASE = '/api/porsche';

/**
 * Ask the server whether we are authenticated.
 *
 * Async by necessity: the session lives in Postgres, not localStorage. Returns
 * null when there is no usable session, otherwise the session descriptor. A
 * `reauth_required` health means the refresh chain is broken and only a
 * hand-solved captcha recovers it.
 *
 * @returns {Promise<{email: string, expiresAt: string, health: string} | null>}
 */
export async function getStoredSession() {
  try {
    const response = await fetch(`${API_BASE}/session`);
    if (!response.ok) return null;
    const data = await response.json();
    return data.authenticated ? data : null;
  } catch {
    return null;
  }
}

/**
 * Full session state including the not-authenticated reason, for the UI to
 * distinguish "never logged in" from "needs re-authentication".
 * @returns {Promise<{authenticated: boolean, reason?: string, lastError?: string}>}
 */
export async function getSessionState() {
  try {
    const response = await fetch(`${API_BASE}/session`);
    if (!response.ok) return { authenticated: false, reason: 'unreachable' };
    return await response.json();
  } catch {
    return { authenticated: false, reason: 'unreachable' };
  }
}

/**
 * Check the server is up.
 */
export async function checkServerAvailable() {
  try {
    const response = await fetch('/api/health', { signal: AbortSignal.timeout(5000) });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Log in to Porsche Connect.
 *
 * The captcha round-trip now passes an opaque `captchaId`; the cookie jar and
 * PKCE verifier stay on the server rather than being handed to the browser.
 *
 * @param {string} email
 * @param {string} password
 * @param {{code: string, id: string} | null} captcha
 * @returns {Promise<{authenticated: true, email: string} | {captchaRequired: true, captchaImage: string, captchaId: string}>}
 */
export async function login(email, password, captcha = null) {
  const body = { email, password };
  if (captcha?.code) {
    body.captchaCode = captcha.code;
    body.captchaId = captcha.id;
  }

  const response = await fetch(`${API_BASE}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const contentType = response.headers.get('content-type');
  if (!contentType || !contentType.includes('application/json')) {
    throw new Error('Server returned an invalid response');
  }

  const data = await response.json();

  if (data.captchaRequired) {
    return {
      captchaRequired: true,
      captchaImage: data.captchaImage,
      captchaId: data.captchaId
    };
  }

  if (!response.ok) {
    throw new Error(data.error || 'Login failed');
  }

  return data;
}

/**
 * Log out — clears the server-side session.
 */
export async function logout() {
  try {
    await fetch(`${API_BASE}/logout`, { method: 'POST' });
  } catch {
    // Ignore: nothing useful to do if the server is unreachable.
  }
}

/** Kept as an alias so callers reading as "forget the session" still work. */
export const clearSession = logout;

/**
 * Authenticated API request. No headers and no client-side refresh: the server
 * holds the token and refreshes it just-in-time behind a single-flight lock.
 * @param {string} endpoint - path under /api/porsche
 */
async function apiRequest(endpoint) {
  const response = await fetch(`${API_BASE}${endpoint}`);

  if (!response.ok) {
    let payload = {};
    try {
      payload = await response.json();
    } catch {
      // non-JSON error body
    }
    if (response.status === 401) {
      const error = new Error(payload.reason === 'reauth_required'
        ? 'Re-authentication required'
        : 'Not authenticated');
      error.reason = payload.reason;
      throw error;
    }
    throw new Error(payload.error || 'Request failed');
  }

  return response.json();
}

/**
 * Get list of vehicles
 * @returns {Promise<Array<Vehicle>>}
 */
export async function getVehicles() {
  const endpoint = '/vehicles';
  return apiRequest(endpoint);
}

/**
 * Get vehicle overview (status, battery, location)
 * @param {string} vin - Vehicle identification number
 * @returns {Promise<VehicleOverview>}
 */
export async function getVehicleOverview(vin) {
  const endpoint = `/vehicle/${vin}/overview`;
  return apiRequest(endpoint);
}

/**
 * Get trip statistics.
 *
 * The old `type` parameter is gone: it was appended as ?type= but no handler
 * ever read it. The route returns all TRIP_STATISTICS_* measurements.
 *
 * @param {string} vin - Vehicle identification number
 * @returns {Promise<TripStatistics>}
 */
export async function getTripStatistics(vin) {
  const endpoint = `/vehicle/${vin}/trips`;
  return apiRequest(endpoint);
}

/**
 * Get full vehicle status (all measurements)
 * @param {string} vin - Vehicle identification number
 * @returns {Promise<VehicleStatus>}
 */
export async function getVehicleStatus(vin) {
  const endpoint = `/vehicle/${vin}/status`;
  return apiRequest(endpoint);
}

/**
 * Get vehicle capabilities
 * @param {string} vin - Vehicle identification number
 * @returns {Promise<VehicleCapabilities>}
 */
export async function getVehicleCapabilities(vin) {
  const endpoint = `/vehicle/${vin}/capabilities`;
  return apiRequest(endpoint);
}

/**
 * Get vehicle pictures
 * @param {string} vin - Vehicle identification number
 * @returns {Promise<VehiclePictures>}
 */
export async function getVehiclePictures(vin) {
  const endpoint = `/vehicle/${vin}/pictures`;
  return apiRequest(endpoint);
}

/**
 * Transform API trip data to match the CSV format used by the app
 * @param {Object} tripData - Raw trip data from API
 * @returns {Array} - Array of trip rows in CSV format
 */
export function transformTripDataToCSV(tripData) {
  const trips = [];

  // Extract measurements from the API response
  const measurements = tripData.measurements || [];

  // Look for trip history data (contains list of past trips)
  const shortTermHistory = measurements.find(m => m.key === 'TRIP_STATISTICS_SHORT_TERM_HISTORY');
  // Note: longTermHistory contains lifetime totals, not individual trips - not used for trip data
  const cyclicHistory = measurements.find(m => m.key === 'TRIP_STATISTICS_CYCLIC_HISTORY');

  // Also get current trip data (not in history yet)
  const shortTerm = measurements.find(m => m.key === 'TRIP_STATISTICS_SHORT_TERM');
  // Note: longTerm and cyclic are cumulative totals, not used for trip processing

  // Process history entries (array in value.list)
  const processHistoryTrips = (historyData, tripType) => {
    // The API uses 'list' not 'entries'
    const entries = historyData?.value?.list || historyData?.value?.entries || [];
    if (!Array.isArray(entries)) return;

    // Log first entry to understand the data structure
    if (entries.length > 0) {
      console.log(`[Transform] ${tripType} first entry keys:`, Object.keys(entries[0]));
      console.log(`[Transform] ${tripType} first entry:`, entries[0]);
    }

    for (const entry of entries) {
      try {
        // Extract trip data - new API format uses flat properties
        const trip = {
          // Date/time - look for tripEndTime or timestamp
          date: entry.tripEndTime ? new Date(entry.tripEndTime) :
                entry.timestamp ? new Date(entry.timestamp) : null,

          // Distance in km - look for distanceKm or tripMileage
          distance: entry.distanceKm ||
                   entry.tripMileage?.valueInKilometers ||
                   entry.tripMileage?.value ||
                   0,

          // Consumption in kWh/100km
          consumption: entry.avgKwhPerHundredKm ||
                      entry.averageElectricEngineConsumption?.valueKwhPer100Km ||
                      entry.averageElectricEngineConsumption?.value ||
                      0,

          // Duration in minutes
          duration: entry.drivingTimeMinutes ||
                   entry.travelTime ||
                   0,

          // Average speed in km/h
          avgSpeed: entry.avgSpeedKmh ||
                   entry.averageSpeed?.valueInKmh ||
                   entry.averageSpeed?.value ||
                   0,

          // Zero emission distance
          zeroEmissionDistance: entry.zeroEmissionDistance?.valueInKilometers ||
                               entry.zeroEmissionDistance?.value ||
                               0,

          // Trip ID for deduplication
          tripId: entry.id || `${tripType}-${entry.tripEndTime || entry.timestamp}`,
          tripType
        };

        // Only include trips with valid data
        if (trip.distance > 0 && trip.date) {
          trips.push(trip);
        }
      } catch (e) {
        console.warn('Failed to parse trip entry:', e);
      }
    }
  };

  // Process current trip data (single entry, not in a list)
  const processCurrentTrip = (tripData, tripType) => {
    if (!tripData?.value) return;
    const v = tripData.value;

    // Skip if no meaningful data
    if (!v.distanceKm && !v.tripMileage) return;

    try {
      const trip = {
        date: v.tripEndTime ? new Date(v.tripEndTime) : new Date(),
        distance: v.distanceKm || v.tripMileage?.valueInKilometers || 0,
        consumption: v.avgKwhPerHundredKm || v.averageElectricEngineConsumption?.valueKwhPer100Km || 0,
        duration: v.drivingTimeMinutes || v.travelTime || 0,
        avgSpeed: v.avgSpeedKmh || v.averageSpeed?.valueInKmh || 0,
        zeroEmissionDistance: 0,
        tripId: `${tripType}-current-${v.tripEndTime || Date.now()}`,
        tripType
      };

      if (trip.distance > 0) {
        trips.push(trip);
      }
    } catch (e) {
      console.warn('Failed to parse current trip:', e);
    }
  };

  // Process SHORT_TERM_HISTORY only - these are individual trips
  // CYCLIC_HISTORY contains "since charge" aggregates, not individual trips
  // LONG_TERM_HISTORY contains lifetime totals, not individual trips
  processHistoryTrips(shortTermHistory, 'SHORT_TERM');

  // Process current short-term trip (may not be in history yet)
  // Don't process LONG_TERM or CYCLIC as they are cumulative totals, not trips
  processCurrentTrip(shortTerm, 'SHORT_TERM');

  // Sort by date (newest first)
  trips.sort((a, b) => b.date - a.date);

  // Extract charge cycle data from CYCLIC_HISTORY
  // These represent "since charge" aggregates - each entry is a charge cycle
  const cyclicEntries = cyclicHistory?.value?.list || [];
  const chargeData = cyclicEntries.map(entry => ({
    // Create minimal charge entry with date (enough for counting)
    date: entry.tripEndTime ? new Date(entry.tripEndTime) : null,
    'arrival time': entry.tripEndTime || '',
    distance: entry.distanceKm || 0,
    consumption: entry.avgKwhPerHundredKm || 0,
    source: 'porsche_connect_charge'
  })).filter(entry => entry.date);

  // Convert to the format expected by processUploadedData
  const formattedTrips = trips.map(trip => ({
    // Match CSV format columns
    date: trip.date,
    distance: trip.distance,
    consumption: trip.consumption,
    avgSpeed: trip.avgSpeed,
    duration: trip.duration,
    zeroEmissionDistance: trip.zeroEmissionDistance,
    startMileage: trip.startMileage,
    endMileage: trip.endMileage,
    // Extra fields for deduplication
    tripId: trip.tripId,
    source: 'porsche_connect'
  }));

  // Return trips and charge data
  return {
    trips: formattedTrips,
    chargeData
  };
}

/**
 * Get all data needed for the dashboard
 * @param {string} vin - Vehicle identification number
 * @param {Function} onProgress - Progress callback
 * @returns {Promise<{trips: Array, vehicleInfo: Object}>}
 */
export async function fetchAllData(vin, onProgress = () => {}) {
  onProgress({ step: 'vehicles', message: 'Fetching vehicle info...' });

  // Get vehicle details
  const vehicles = await getVehicles();
  const vehicle = vehicles.find(v => v.vin === vin) || vehicles[0];

  if (!vehicle) {
    throw new Error('No vehicles found');
  }

  // Log vehicle info for debugging
  console.log('\n========== VEHICLE INFO ==========');
  console.log('VIN:', vehicle.vin);
  console.log('Model Name:', vehicle.modelName);
  console.log('Model Type:', JSON.stringify(vehicle.modelType, null, 2));
  console.log('System Info:', JSON.stringify(vehicle.systemInfo, null, 2));
  console.log('Color:', vehicle.color);
  console.log('Connect:', JSON.stringify(vehicle.connect, null, 2));
  console.log('Vehicle User Type:', vehicle.vehicleUserType);
  console.log('Timestamp:', vehicle.timestamp);
  console.log('Commands:', vehicle.commands?.map(c => c.id || c).join(', '));
  console.log('All vehicle keys:', Object.keys(vehicle));
  console.log('===================================\n');

  onProgress({ step: 'overview', message: 'Fetching vehicle status...' });

  // Get current vehicle overview
  const overview = await getVehicleOverview(vehicle.vin);

  // Fetch full status, capabilities, and pictures (for server-side logging)
  onProgress({ step: 'status', message: 'Fetching full vehicle status...' });

  let fullStatus = null;
  let capabilities = null;
  let pictures = null;

  try {
    fullStatus = await getVehicleStatus(vehicle.vin);
  } catch (e) {
    console.warn('Failed to fetch full status:', e.message);
  }

  try {
    capabilities = await getVehicleCapabilities(vehicle.vin);
  } catch (e) {
    console.warn('Failed to fetch capabilities:', e.message);
  }

  try {
    pictures = await getVehiclePictures(vehicle.vin);
  } catch (e) {
    console.warn('Failed to fetch pictures:', e.message);
  }

  onProgress({ step: 'trips', message: 'Fetching trip data...' });

  // Get trip statistics
  const tripData = await getTripStatistics(vehicle.vin);

  onProgress({ step: 'transform', message: 'Processing data...' });

  // Transform to CSV format
  const { trips, chargeData } = transformTripDataToCSV(tripData);

  // Build vehicle info
  // Try to get battery capacity from overview or use known values based on model
  const batteryCapacityMeasurement = overview.measurements?.find(m =>
    m.key === 'BATTERY_CAPACITY' || m.key === 'BATTERY_GROSS_CAPACITY'
  );
  const batteryCapacity = batteryCapacityMeasurement?.value?.valueInKwh ||
                          batteryCapacityMeasurement?.value?.value ||
                          vehicle.batteryCapacity ||
                          null;

  const vehicleInfo = {
    vin: vehicle.vin,
    modelName: vehicle.modelName || 'Porsche',
    modelYear: vehicle.modelType?.year,
    engineType: vehicle.modelType?.engine, // BEV, PHEV, COMBUSTION
    batteryCapacity: batteryCapacity, // Gross battery capacity in kWh
    batteryLevel: overview.measurements?.find(m => m.key === 'BATTERY_LEVEL')?.value?.percent,
    range: overview.measurements?.find(m => m.key === 'E_RANGE')?.value?.valueInKilometers,
    mileage: overview.measurements?.find(m => m.key === 'MILEAGE')?.value?.valueInKilometers
  };

  onProgress({ step: 'complete', message: 'Done!' });

  return {
    trips,
    chargeData,
    vehicleInfo,
    raw: { tripData, overview }
  };
}

/**
 * Map Porsche model names to our vehicle database
 * Uses the model name, year, and battery capacity to find the best match
 * @param {string} modelName - Model name from API (e.g., "Taycan 4 Cross Turismo")
 * @param {string} engineType - Engine type (BEV, PHEV, COMBUSTION)
 * @param {number} modelYear - Model year from API
 * @param {number} batteryCapacity - Gross battery capacity in kWh (optional)
 * @returns {string|null} - Vehicle ID from our database or null
 */
export function mapModelToVehicleId(modelName, engineType, modelYear = null, batteryCapacity = null) {
  if (!modelName) return null;

  console.log('[Vehicle Match] Trying to match:', modelName, 'engineType:', engineType, 'year:', modelYear, 'battery:', batteryCapacity);

  // Only process electric vehicles
  if (engineType !== 'BEV') {
    console.log('[Vehicle Match] Not a BEV, returning null');
    return null;
  }

  const nameLower = modelName.toLowerCase();

  // Determine battery type from capacity
  // J1.1 (2020-2024): PB = 79.2 kWh, PB+ = 93.4 kWh
  // J1.2 (2025+): PB = 89.0 kWh, PB+ = 105.0 kWh
  let batteryType = null;
  if (batteryCapacity) {
    if (batteryCapacity >= 100) batteryType = 'pb+';
    else if (batteryCapacity >= 90) batteryType = 'pb';  // 2025+ smaller battery
    else if (batteryCapacity >= 85) batteryType = 'pb+'; // J1.1 PB+
    else batteryType = 'pb'; // J1.1 PB
  }

  // Determine generation from year
  const is2025Plus = modelYear && modelYear >= 2025;

  // Build search criteria
  let candidates = [...PORSCHE_EV_MODELS];

  // Filter by model line
  if (nameLower.includes('macan')) {
    candidates = candidates.filter(v => v.name.toLowerCase().includes('macan'));
  } else if (nameLower.includes('cayenne')) {
    candidates = candidates.filter(v => v.name.toLowerCase().includes('cayenne'));
  } else if (nameLower.includes('cross turismo') || nameLower.includes('crossturismo')) {
    candidates = candidates.filter(v => v.name.includes('Cross Turismo'));
  } else if (nameLower.includes('sport turismo')) {
    candidates = candidates.filter(v => v.name.includes('Sport Turismo'));
  } else if (nameLower.includes('taycan')) {
    // Regular Taycan sedan (exclude Cross and Sport Turismo)
    candidates = candidates.filter(v => v.name.includes('Taycan') && !v.name.includes('Cross') && !v.name.includes('Sport'));
  }

  // Filter by variant
  if (nameLower.includes('turbo gt')) {
    candidates = candidates.filter(v => v.name.includes('Turbo GT'));
  } else if (nameLower.includes('turbo s')) {
    candidates = candidates.filter(v => v.name.includes('Turbo S'));
  } else if (nameLower.includes('turbo') && !nameLower.includes('turbo s') && !nameLower.includes('turbo gt')) {
    candidates = candidates.filter(v => v.name.includes('Turbo') && !v.name.includes('Turbo S') && !v.name.includes('Turbo GT'));
  } else if (nameLower.includes('gts')) {
    candidates = candidates.filter(v => v.name.includes('GTS'));
  } else if (nameLower.includes('4s')) {
    candidates = candidates.filter(v => v.name.includes('4S'));
  } else if (nameLower.match(/\b4\b/) && !nameLower.includes('4s')) {
    // Match "4" but not "4S"
    candidates = candidates.filter(v => (v.name.includes(' 4 ') || v.name.includes(' 4 PB')));
  } else if (nameLower.includes('base') || nameLower.includes('rwd')) {
    candidates = candidates.filter(v => v.name.includes('Base'));
  }

  // Filter by battery type if known (only for Taycan, not Macan/Cayenne)
  if (batteryType && !nameLower.includes('macan') && !nameLower.includes('cayenne')) {
    if (batteryType === 'pb+') {
      // Prefer PB+ models, or models without battery suffix (GTS, Turbo, etc.)
      const pbPlusCandidates = candidates.filter(v => v.name.includes('PB+') || (!v.name.includes('PB') && v.grossBattery >= 93));
      if (pbPlusCandidates.length > 0) candidates = pbPlusCandidates;
    } else {
      // Prefer PB models
      const pbCandidates = candidates.filter(v => v.name.includes('PB') && !v.name.includes('PB+'));
      if (pbCandidates.length > 0) candidates = pbCandidates;
    }
  }

  // Filter by generation
  if (is2025Plus) {
    const newerCandidates = candidates.filter(v => v.name.includes('2025') || v.name.includes('2026'));
    if (newerCandidates.length > 0) candidates = newerCandidates;
  } else {
    // Prefer older generation (2020-2024)
    const olderCandidates = candidates.filter(v => !v.name.includes('2025') && !v.name.includes('2026'));
    if (olderCandidates.length > 0) candidates = olderCandidates;
  }

  // Return the best match
  if (candidates.length > 0) {
    const matched = candidates[0];
    console.log('[Vehicle Match] Matched to:', matched.id, '(' + matched.name + ')');
    return matched.id;
  }

  console.log('[Vehicle Match] No match found');
  return null;
}
