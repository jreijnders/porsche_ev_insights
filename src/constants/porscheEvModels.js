// ========== PORSCHE ELECTRIC VEHICLE SPECIFICATIONS ==========
// Complete database of Porsche EV models with battery and range specifications
//
// Notes:
// - PB = Performance Battery (smaller)
// - PB+ = Performance Battery Plus (larger)
// - Sport Turismo was introduced in 2022, hence starts from 2022
// - Cross Turismo was introduced in 2021
// - Turbo GT is only available as a sedan (no Cross Turismo or Sport Turismo version)
// - Sport Turismo has a base RWD version; Cross Turismo does not (all Cross Turismo are AWD)
// - Macan Electric GTS announced October 2025, available 2025+
// - WLTP values are official European test cycle ratings
// - EPA values are official US Environmental Protection Agency ratings (used for imperial_us)
// - MPGe = Miles Per Gallon equivalent (33.7 kWh = 1 gallon of gasoline)
//
// Total: 54 model variants

export const PORSCHE_EV_MODELS = [
  // ========== TAYCAN SEDAN ==========

  // Taycan Sedan - Base RWD
  // EPA data: 2020-2024 base PB ~83 MPGe, 206 mi; PB+ ~82 MPGe, 246 mi
  // EPA data: 2025+ base PB ~91 MPGe, 274 mi; PB+ ~88 MPGe, 318 mi
  { id: 'taycan-base-rwd-pb-2020', name: 'Taycan Base RWD PB (2020-2024)', grossBattery: 79.2, usableBattery: 71.0, wltpRange: 431, wltpConsumption: 21.6, epaRange: 206, epaMpge: 83, generation: 'J1.1', bodyStyle: 'sedan' },
  { id: 'taycan-base-rwd-pb-2025', name: 'Taycan Base RWD PB (2025+)', grossBattery: 89.0, usableBattery: 82.3, wltpRange: 547, wltpConsumption: 17.9, epaRange: 274, epaMpge: 91, generation: 'J1.2', bodyStyle: 'sedan' },
  { id: 'taycan-base-rwd-pb+-2020', name: 'Taycan Base RWD PB+ (2020-2024)', grossBattery: 93.4, usableBattery: 83.7, wltpRange: 458, wltpConsumption: 22.2, epaRange: 246, epaMpge: 82, generation: 'J1.1', bodyStyle: 'sedan' },
  { id: 'taycan-base-rwd-pb+-2025', name: 'Taycan Base RWD PB+ (2025+)', grossBattery: 105.0, usableBattery: 97.0, wltpRange: 638, wltpConsumption: 18.2, epaRange: 318, epaMpge: 88, generation: 'J1.2', bodyStyle: 'sedan' },

  // Taycan Sedan - 4
  // EPA data: 2020-2024 4 PB ~79 MPGe, 199 mi; PB+ ~78 MPGe, 227 mi
  // EPA data: 2025+ 4 PB ~87 MPGe, 258 mi; PB+ ~85 MPGe, 303 mi
  { id: 'taycan-4-pb-2020', name: 'Taycan 4 PB (2020-2024)', grossBattery: 79.2, usableBattery: 71.0, wltpRange: 410, wltpConsumption: 22.4, epaRange: 199, epaMpge: 79, generation: 'J1.1', bodyStyle: 'sedan' },
  { id: 'taycan-4-pb-2025', name: 'Taycan 4 PB (2025+)', grossBattery: 89.0, usableBattery: 82.3, wltpRange: 517, wltpConsumption: 18.8, epaRange: 258, epaMpge: 87, generation: 'J1.2', bodyStyle: 'sedan' },
  { id: 'taycan-4-pb+-2020', name: 'Taycan 4 PB+ (2020-2024)', grossBattery: 93.4, usableBattery: 83.7, wltpRange: 436, wltpConsumption: 23.2, epaRange: 227, epaMpge: 78, generation: 'J1.1', bodyStyle: 'sedan' },
  { id: 'taycan-4-pb+-2025', name: 'Taycan 4 PB+ (2025+)', grossBattery: 105.0, usableBattery: 97.0, wltpRange: 580, wltpConsumption: 19.1, epaRange: 303, epaMpge: 85, generation: 'J1.2', bodyStyle: 'sedan' },

  // Taycan Sedan - 4S
  // EPA data: 2020-2024 4S PB ~82 MPGe, 203 mi; PB+ ~80 MPGe, 227 mi
  // EPA data: 2025+ 4S PB ~93 MPGe, 252 mi; PB+ ~88 MPGe, 295 mi
  { id: 'taycan-4s-pb-2020', name: 'Taycan 4S PB (2020-2024)', grossBattery: 79.2, usableBattery: 71.0, wltpRange: 384, wltpConsumption: 23.5, epaRange: 203, epaMpge: 82, generation: 'J1.1', bodyStyle: 'sedan' },
  { id: 'taycan-4s-pb-2025', name: 'Taycan 4S PB (2025+)', grossBattery: 89.0, usableBattery: 82.3, wltpRange: 492, wltpConsumption: 18.9, epaRange: 252, epaMpge: 93, generation: 'J1.2', bodyStyle: 'sedan' },
  { id: 'taycan-4s-pb+-2020', name: 'Taycan 4S PB+ (2020-2024)', grossBattery: 93.4, usableBattery: 83.7, wltpRange: 426, wltpConsumption: 24.0, epaRange: 227, epaMpge: 80, generation: 'J1.1', bodyStyle: 'sedan' },
  { id: 'taycan-4s-pb+-2025', name: 'Taycan 4S PB+ (2025+)', grossBattery: 105.0, usableBattery: 97.0, wltpRange: 558, wltpConsumption: 18.9, epaRange: 295, epaMpge: 88, generation: 'J1.2', bodyStyle: 'sedan' },

  // Taycan Sedan - GTS
  // EPA data: 2021-2024 GTS ~83 MPGe, 238 mi; 2025+ ~86 MPGe, 288 mi
  { id: 'taycan-gts-2021', name: 'Taycan GTS (2021-2024)', grossBattery: 93.4, usableBattery: 83.7, wltpRange: 405, wltpConsumption: 24.5, epaRange: 238, epaMpge: 83, generation: 'J1.1', bodyStyle: 'sedan' },
  { id: 'taycan-gts-2025', name: 'Taycan GTS (2025+)', grossBattery: 105.0, usableBattery: 97.0, wltpRange: 529, wltpConsumption: 19.0, epaRange: 288, epaMpge: 86, generation: 'J1.2', bodyStyle: 'sedan' },

  // Taycan Sedan - Turbo
  // EPA data: 2020-2024 Turbo ~81 MPGe, 212 mi; 2025+ ~84 MPGe, 292 mi
  { id: 'taycan-turbo-2020', name: 'Taycan Turbo (2020-2024)', grossBattery: 93.4, usableBattery: 83.7, wltpRange: 405, wltpConsumption: 24.5, epaRange: 212, epaMpge: 81, generation: 'J1.1', bodyStyle: 'sedan' },
  { id: 'taycan-turbo-2025', name: 'Taycan Turbo (2025+)', grossBattery: 105.0, usableBattery: 97.0, wltpRange: 532, wltpConsumption: 18.9, epaRange: 292, epaMpge: 84, generation: 'J1.2', bodyStyle: 'sedan' },

  // Taycan Sedan - Turbo S
  // EPA data: 2020-2024 Turbo S ~75 MPGe, 201 mi; 2025+ ~79 MPGe, 266 mi
  { id: 'taycan-turbo-s-2020', name: 'Taycan Turbo S (2020-2024)', grossBattery: 93.4, usableBattery: 83.7, wltpRange: 405, wltpConsumption: 24.5, epaRange: 201, epaMpge: 75, generation: 'J1.1', bodyStyle: 'sedan' },
  { id: 'taycan-turbo-s-2025', name: 'Taycan Turbo S (2025+)', grossBattery: 105.0, usableBattery: 97.0, wltpRange: 549, wltpConsumption: 18.9, epaRange: 266, epaMpge: 79, generation: 'J1.2', bodyStyle: 'sedan' },

  // Taycan Sedan - Turbo GT
  // EPA data: 2025+ Turbo GT ~78 MPGe, 276 mi; Weissach ~77 MPGe, 269 mi
  { id: 'taycan-turbo-gt-2025', name: 'Taycan Turbo GT (2025+)', grossBattery: 105.0, usableBattery: 97.0, wltpRange: 498, wltpConsumption: 20.9, epaRange: 276, epaMpge: 78, generation: 'J1.2', bodyStyle: 'sedan' },

  // ========== TAYCAN CROSS TURISMO ==========

  // Taycan Cross Turismo - 4
  // EPA data: 2021-2024 4 CT PB ~80 MPGe, 215 mi; PB+ ~78 MPGe, 231 mi
  // EPA data: 2025+ 4 CT ~83 MPGe, 277 mi
  { id: 'taycan-ct-4-pb-2021', name: 'Taycan Cross Turismo 4 PB (2021-2024)', grossBattery: 79.2, usableBattery: 71.0, wltpRange: 403, wltpConsumption: 22.8, epaRange: 215, epaMpge: 80, generation: 'J1.1', bodyStyle: 'cross-turismo' },
  { id: 'taycan-ct-4-pb-2025', name: 'Taycan Cross Turismo 4 PB (2025+)', grossBattery: 89.0, usableBattery: 82.3, wltpRange: 509, wltpConsumption: 19.2, epaRange: 260, epaMpge: 85, generation: 'J1.2', bodyStyle: 'cross-turismo' },
  { id: 'taycan-ct-4-pb+-2021', name: 'Taycan Cross Turismo 4 PB+ (2021-2024)', grossBattery: 93.4, usableBattery: 83.7, wltpRange: 428, wltpConsumption: 23.8, epaRange: 231, epaMpge: 78, generation: 'J1.1', bodyStyle: 'cross-turismo' },
  { id: 'taycan-ct-4-pb+-2025', name: 'Taycan Cross Turismo 4 PB+ (2025+)', grossBattery: 105.0, usableBattery: 97.0, wltpRange: 570, wltpConsumption: 19.5, epaRange: 277, epaMpge: 83, generation: 'J1.2', bodyStyle: 'cross-turismo' },

  // Taycan Cross Turismo - 4S
  // EPA data: 2021-2024 4S CT PB ~78 MPGe, 205 mi; PB+ ~76 MPGe, 222 mi
  // EPA data: 2025+ 4S CT ~81 MPGe, 272 mi
  { id: 'taycan-ct-4s-pb-2021', name: 'Taycan Cross Turismo 4S PB (2021-2024)', grossBattery: 79.2, usableBattery: 71.0, wltpRange: 376, wltpConsumption: 24.2, epaRange: 205, epaMpge: 78, generation: 'J1.1', bodyStyle: 'cross-turismo' },
  { id: 'taycan-ct-4s-pb-2025', name: 'Taycan Cross Turismo 4S PB (2025+)', grossBattery: 89.0, usableBattery: 82.3, wltpRange: 482, wltpConsumption: 19.3, epaRange: 255, epaMpge: 83, generation: 'J1.2', bodyStyle: 'cross-turismo' },
  { id: 'taycan-ct-4s-pb+-2021', name: 'Taycan Cross Turismo 4S PB+ (2021-2024)', grossBattery: 93.4, usableBattery: 83.7, wltpRange: 420, wltpConsumption: 24.8, epaRange: 222, epaMpge: 76, generation: 'J1.1', bodyStyle: 'cross-turismo' },
  { id: 'taycan-ct-4s-pb+-2025', name: 'Taycan Cross Turismo 4S PB+ (2025+)', grossBattery: 105.0, usableBattery: 97.0, wltpRange: 548, wltpConsumption: 19.3, epaRange: 272, epaMpge: 81, generation: 'J1.2', bodyStyle: 'cross-turismo' },

  // Taycan Cross Turismo - GTS
  // EPA data: 2021-2024 GTS CT ~80 MPGe, 229 mi; 2025+ ~82 MPGe, 270 mi
  { id: 'taycan-ct-gts-2021', name: 'Taycan Cross Turismo GTS (2021-2024)', grossBattery: 93.4, usableBattery: 83.7, wltpRange: 397, wltpConsumption: 25.2, epaRange: 229, epaMpge: 80, generation: 'J1.1', bodyStyle: 'cross-turismo' },
  { id: 'taycan-ct-gts-2025', name: 'Taycan Cross Turismo GTS (2025+)', grossBattery: 105.0, usableBattery: 97.0, wltpRange: 518, wltpConsumption: 19.5, epaRange: 270, epaMpge: 82, generation: 'J1.2', bodyStyle: 'cross-turismo' },

  // Taycan Cross Turismo - Turbo
  // EPA data: 2021-2024 Turbo CT ~79 MPGe, 222 mi; 2025+ ~80 MPGe, 265 mi
  { id: 'taycan-ct-turbo-2021', name: 'Taycan Cross Turismo Turbo (2021-2024)', grossBattery: 93.4, usableBattery: 83.7, wltpRange: 397, wltpConsumption: 25.2, epaRange: 222, epaMpge: 79, generation: 'J1.1', bodyStyle: 'cross-turismo' },
  { id: 'taycan-ct-turbo-2025', name: 'Taycan Cross Turismo Turbo (2025+)', grossBattery: 105.0, usableBattery: 97.0, wltpRange: 523, wltpConsumption: 19.4, epaRange: 265, epaMpge: 80, generation: 'J1.2', bodyStyle: 'cross-turismo' },

  // Taycan Cross Turismo - Turbo S
  // EPA data: 2021-2024 Turbo S CT ~75 MPGe, 202 mi; 2025+ ~77 MPGe, 261 mi
  { id: 'taycan-ct-turbo-s-2021', name: 'Taycan Cross Turismo Turbo S (2021-2024)', grossBattery: 93.4, usableBattery: 83.7, wltpRange: 393, wltpConsumption: 25.5, epaRange: 202, epaMpge: 75, generation: 'J1.1', bodyStyle: 'cross-turismo' },
  { id: 'taycan-ct-turbo-s-2025', name: 'Taycan Cross Turismo Turbo S (2025+)', grossBattery: 105.0, usableBattery: 97.0, wltpRange: 540, wltpConsumption: 19.3, epaRange: 261, epaMpge: 77, generation: 'J1.2', bodyStyle: 'cross-turismo' },

  // ========== TAYCAN SPORT TURISMO ==========

  // Taycan Sport Turismo - Base RWD
  // EPA data: Similar to sedan, 2022-2024 base ST PB ~83 MPGe, 206 mi; PB+ ~82 MPGe, 246 mi
  // EPA data: 2025+ base ST PB ~91 MPGe, 274 mi; PB+ ~88 MPGe, 318 mi
  { id: 'taycan-st-base-rwd-pb-2022', name: 'Taycan Sport Turismo Base RWD PB (2022-2024)', grossBattery: 79.2, usableBattery: 71.0, wltpRange: 431, wltpConsumption: 21.6, epaRange: 206, epaMpge: 83, generation: 'J1.1', bodyStyle: 'sport-turismo' },
  { id: 'taycan-st-base-rwd-pb-2025', name: 'Taycan Sport Turismo Base RWD PB (2025+)', grossBattery: 89.0, usableBattery: 82.3, wltpRange: 547, wltpConsumption: 17.9, epaRange: 274, epaMpge: 91, generation: 'J1.2', bodyStyle: 'sport-turismo' },
  { id: 'taycan-st-base-rwd-pb+-2022', name: 'Taycan Sport Turismo Base RWD PB+ (2022-2024)', grossBattery: 93.4, usableBattery: 83.7, wltpRange: 458, wltpConsumption: 22.2, epaRange: 246, epaMpge: 82, generation: 'J1.1', bodyStyle: 'sport-turismo' },
  { id: 'taycan-st-base-rwd-pb+-2025', name: 'Taycan Sport Turismo Base RWD PB+ (2025+)', grossBattery: 105.0, usableBattery: 97.0, wltpRange: 638, wltpConsumption: 18.2, epaRange: 318, epaMpge: 88, generation: 'J1.2', bodyStyle: 'sport-turismo' },

  // Taycan Sport Turismo - 4S
  // EPA data: 2022-2024 4S ST PB ~82 MPGe, 203 mi; PB+ ~80 MPGe, 233 mi
  // EPA data: 2025+ 4S ST PB ~93 MPGe, 252 mi; PB+ ~88 MPGe, 295 mi
  { id: 'taycan-st-4s-pb-2022', name: 'Taycan Sport Turismo 4S PB (2022-2024)', grossBattery: 79.2, usableBattery: 71.0, wltpRange: 384, wltpConsumption: 23.5, epaRange: 203, epaMpge: 82, generation: 'J1.1', bodyStyle: 'sport-turismo' },
  { id: 'taycan-st-4s-pb-2025', name: 'Taycan Sport Turismo 4S PB (2025+)', grossBattery: 89.0, usableBattery: 82.3, wltpRange: 492, wltpConsumption: 18.9, epaRange: 252, epaMpge: 93, generation: 'J1.2', bodyStyle: 'sport-turismo' },
  { id: 'taycan-st-4s-pb+-2022', name: 'Taycan Sport Turismo 4S PB+ (2022-2024)', grossBattery: 93.4, usableBattery: 83.7, wltpRange: 443, wltpConsumption: 23.2, epaRange: 233, epaMpge: 80, generation: 'J1.1', bodyStyle: 'sport-turismo' },
  { id: 'taycan-st-4s-pb+-2025', name: 'Taycan Sport Turismo 4S PB+ (2025+)', grossBattery: 105.0, usableBattery: 97.0, wltpRange: 558, wltpConsumption: 18.9, epaRange: 295, epaMpge: 88, generation: 'J1.2', bodyStyle: 'sport-turismo' },

  // Taycan Sport Turismo - GTS
  // EPA data: 2022-2024 GTS ST ~80 MPGe, 233 mi; 2025+ ~86 MPGe, 288 mi
  { id: 'taycan-st-gts-2022', name: 'Taycan Sport Turismo GTS (2022-2024)', grossBattery: 93.4, usableBattery: 83.7, wltpRange: 405, wltpConsumption: 24.5, epaRange: 233, epaMpge: 80, generation: 'J1.1', bodyStyle: 'sport-turismo' },
  { id: 'taycan-st-gts-2025', name: 'Taycan Sport Turismo GTS (2025+)', grossBattery: 105.0, usableBattery: 97.0, wltpRange: 529, wltpConsumption: 19.0, epaRange: 288, epaMpge: 86, generation: 'J1.2', bodyStyle: 'sport-turismo' },

  // Taycan Sport Turismo - Turbo
  // EPA data: 2022-2024 Turbo ST ~79 MPGe, 215 mi; 2025+ ~80 MPGe, 280 mi
  { id: 'taycan-st-turbo-2022', name: 'Taycan Sport Turismo Turbo (2022-2024)', grossBattery: 93.4, usableBattery: 83.7, wltpRange: 397, wltpConsumption: 25.2, epaRange: 215, epaMpge: 79, generation: 'J1.1', bodyStyle: 'sport-turismo' },
  { id: 'taycan-st-turbo-2025', name: 'Taycan Sport Turismo Turbo (2025+)', grossBattery: 105.0, usableBattery: 97.0, wltpRange: 523, wltpConsumption: 19.4, epaRange: 280, epaMpge: 80, generation: 'J1.2', bodyStyle: 'sport-turismo' },

  // Taycan Sport Turismo - Turbo S
  // EPA data: 2022-2024 Turbo S ST ~75 MPGe, 205 mi; 2025+ ~77 MPGe, 282 mi
  { id: 'taycan-st-turbo-s-2022', name: 'Taycan Sport Turismo Turbo S (2022-2024)', grossBattery: 93.4, usableBattery: 83.7, wltpRange: 393, wltpConsumption: 25.5, epaRange: 205, epaMpge: 75, generation: 'J1.1', bodyStyle: 'sport-turismo' },
  { id: 'taycan-st-turbo-s-2025', name: 'Taycan Sport Turismo Turbo S (2025+)', grossBattery: 105.0, usableBattery: 97.0, wltpRange: 577, wltpConsumption: 19.3, epaRange: 282, epaMpge: 77, generation: 'J1.2', bodyStyle: 'sport-turismo' },

  // ========== MACAN ELECTRIC ==========
  // EPA data: Base RWD ~97 MPGe, 315 mi; 4 ~96 MPGe, 308 mi; 4S ~89 MPGe, 288 mi; Turbo ~90 MPGe, 288 mi

  { id: 'macan-base-rwd-2025', name: 'Macan Electric Base RWD (2025+)', grossBattery: 100.0, usableBattery: 95.0, wltpRange: 627, wltpConsumption: 18.0, epaRange: 315, epaMpge: 97, generation: 'Gen1', bodyStyle: 'suv' },
  { id: 'macan-4-2024', name: 'Macan Electric 4 (2024+)', grossBattery: 100.0, usableBattery: 95.0, wltpRange: 570, wltpConsumption: 19.1, epaRange: 308, epaMpge: 96, generation: 'Gen1', bodyStyle: 'suv' },
  { id: 'macan-4s-2025', name: 'Macan Electric 4S (2025+)', grossBattery: 100.0, usableBattery: 95.0, wltpRange: 565, wltpConsumption: 19.1, epaRange: 288, epaMpge: 89, generation: 'Gen1', bodyStyle: 'suv' },
  { id: 'macan-gts-2025', name: 'Macan Electric GTS (2025+)', grossBattery: 100.0, usableBattery: 95.0, wltpRange: 586, wltpConsumption: 19.5, epaRange: 285, epaMpge: 87, generation: 'Gen1', bodyStyle: 'suv' },
  { id: 'macan-turbo-2024', name: 'Macan Electric Turbo (2024+)', grossBattery: 100.0, usableBattery: 95.0, wltpRange: 559, wltpConsumption: 19.5, epaRange: 288, epaMpge: 90, generation: 'Gen1', bodyStyle: 'suv' },

  // ========== CAYENNE ELECTRIC ==========
  // EPA data not yet available for 2026 models - estimates based on WLTP ratio

  { id: 'cayenne-base-2026', name: 'Cayenne Electric Base (2026)', grossBattery: 113.0, usableBattery: 108.0, wltpRange: 642, wltpConsumption: 20.8, epaRange: 350, epaMpge: 85, generation: 'Gen1', bodyStyle: 'suv' },
  { id: 'cayenne-turbo-2026', name: 'Cayenne Electric Turbo (2026)', grossBattery: 113.0, usableBattery: 108.0, wltpRange: 623, wltpConsumption: 21.4, epaRange: 340, epaMpge: 82, generation: 'Gen1', bodyStyle: 'suv' },

  // ========== AUDI E-TRON GT (J1 PLATFORM) ==========
  // Same platform as Taycan, technically similar specs


];

// Default vehicle (Taycan 4 Cross Turismo with Performance Battery Plus, most common configuration)
export const DEFAULT_VEHICLE_ID = 'taycan-ct-4-pb+-2021';

// Get vehicle by ID
export const getVehicleById = (id) => {
  return PORSCHE_EV_MODELS.find(v => v.id === id) || PORSCHE_EV_MODELS.find(v => v.id === DEFAULT_VEHICLE_ID);
};

// Get vehicles grouped by model line
export const getVehiclesGrouped = () => {
  const groups = {
    'Taycan Sedan': [],
    'Taycan Cross Turismo': [],
    'Taycan Sport Turismo': [],
    'Macan Electric': [],
    'Cayenne Electric': []
  };

  PORSCHE_EV_MODELS.forEach(v => {
    if (v.name.includes('Cross Turismo')) {
      groups['Taycan Cross Turismo'].push(v);
    } else if (v.name.includes('Sport Turismo')) {
      groups['Taycan Sport Turismo'].push(v);
    } else if (v.name.includes('Macan')) {
      groups['Macan Electric'].push(v);
    } else if (v.name.includes('Cayenne')) {
      groups['Cayenne Electric'].push(v);
    } else if (v.name.includes('Taycan')) {
      groups['Taycan Sedan'].push(v);
    }
  });

  return groups;
};
