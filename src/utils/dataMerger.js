// ========== BACKUP RESTORE SHIM ==========
// What survives of the CSV merger (#26). Restoring an old backup that predates
// rawData still needs its processed trips put back into the row shape the
// dashboard reads, so this one function stays; the import path it was written
// for is gone.

/**
 * Reconstructs raw data format from processed trips (rawTrips from backup).
 * This allows old backups without rawData to still support merging.
 * Creates objects in the format that processUploadedData expects.
 * @param {Array} rawTrips - Processed trip objects from backup.data.rawTrips
 * @returns {Array} - Data in a format compatible with both merging and processing
 */
export function reconstructRawDataFromTrips(rawTrips = []) {
  return rawTrips.map(trip => ({
    // Use the standard CSV header format that processUploadedData expects
    'arrival time': trip.date,
    'distance (km)': String(trip.distance),
    'avg. consumption (kwh/100 km)': String(trip.consumption),
    'average speed (km/h)': String(trip.speed || 0),
    // Also keep the simple keys for fingerprinting
    date: trip.date,
    distance: trip.distance,
    consumption: trip.consumption,
    speed: trip.speed
  }));
}

/**
 * Sorts raw data by arrival time (newest first for display, oldest first for processing)
 * @param {Array} data - Raw CSV rows
 * @param {string} order - 'asc' or 'desc'
 * @returns {Array} - Sorted data
 */
