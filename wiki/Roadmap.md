# Roadmap

Feature roadmap for Porsche EV Insights, based on Porsche Connect API capabilities (via [pyporscheconnectapi](https://github.com/CJNE/pyporscheconnectapi)) and inspiration from Tessie's Tesla driver features.

---

## Phase 1 — Show Data We Already Fetch

These features require **UI work only** — the API data is already being fetched by the `/status` and `/trips` endpoints but not displayed in the My Car tab.

### 1.1 Trip History Display
- Show recent trips from `TRIP_STATISTICS_SHORT_TERM_HISTORY` in My Car tab
- Each trip: date, distance, consumption, avg speed, duration
- Show charge cycle data from `TRIP_STATISTICS_CYCLIC_HISTORY`
- Link to import trip data into the main analytics dashboard

### 1.2 Charging Status & Sessions
- Display `BATTERY_CHARGING_STATE` — whether currently charging or not
- Show `CHARGING_RATE` — current charge speed (kW or km/min)
- Show `CHARGING_SUMMARY` — energy added, session duration
- Display `CHARGING_SETTINGS` — current target SOC percentage
- Show `CHARGING_PROFILES` — configured charging schedules

### 1.3 Door / Window / Lid Status Diagram
- Visual car diagram showing open/closed state for all 17 `OPEN_STATE_*` measurements:
  - 4 doors, 2 lids (frunk/trunk), 4 windows, sunroof, spoiler, 2 charge flaps, service flap
- Use `vehicle_closed` aggregate as a quick status badge
- Color coding: green = closed/secure, red = open

### 1.4 Climate & Heating Status
- Show `CLIMATIZER_STATE` — climate control running or not
- Show `HEATING_STATE` — seat/steering heating active
- Show `HVAC_STATE` — full HVAC status
- Display current cabin temperature if available

### 1.5 Service & Maintenance Alerts
- Show `MAIN_SERVICE_RANGE` / `MAIN_SERVICE_TIME` — distance and time until next service
- Show `INTERMEDIATE_SERVICE_RANGE` / `INTERMEDIATE_SERVICE_TIME`
- Display `SERVICE_PREDICTIONS` — predictive maintenance data
- Visual indicators when service is due soon

### 1.6 Security Status
- Show `ALARM_STATE` — armed / triggered / off
- Show `THEFT_STATE` — theft detection status
- Show `GLOBAL_PRIVACY_MODE` — privacy mode on/off
- Show `PARKING_BRAKE` — engaged or not

### 1.7 Departure Timers Display
- Show configured `DEPARTURES` and `TIMERS`
- Display next scheduled departure with pre-conditioning details

---

## Phase 2 — New Data & Logic on Existing Infrastructure

These features require new client-side logic, periodic data collection, or new API calls — but no remote commands.

### 2.1 Live Vehicle Refresh
- Add "Refresh" button using `get_current_overview()` to wake vehicle for real-time data
- Show `connected` property — whether vehicle is currently online
- Display `location_updated_at` — when location was last reported
- Respect rate limits with cooldown indicator

### 2.2 Battery Health Tracking
- Track battery level vs range ratio over time across sessions (localStorage)
- Estimate degradation by comparing real-world range to official specs from `porscheEvModels.js`
- Chart: battery health trend over weeks/months
- Compare against community averages (similar to Tessie's battery comparison)

### 2.3 Phantom Drain / Sleep Tracking
- Compare `BATTERY_LEVEL` between sessions to calculate vampire drain
- Calculate daily/weekly idle energy loss
- "Sleep score" — how well the vehicle conserves energy when parked
- Tips to reduce phantom drain

### 2.4 Charge Projections
- Using current `BATTERY_LEVEL`, `CHARGING_RATE`, and `CHARGING_SETTINGS` (target SOC)
- Estimate time to target charge level
- Estimate projected range at target SOC
- Cost estimate using user's electricity rate from settings

### 2.5 Capability-Aware UI
- Use `/capabilities` endpoint to conditionally show features
- Check `has_remote_climatisation`, `has_direct_charge`, `has_tire_pressure_monitoring`, etc.
- Hide buttons/cards for features the specific vehicle doesn't support
- Show capability badges on vehicle header

### 2.6 Notifications & Alerts
- Browser notifications for:
  - Charge complete (battery reached target SOC)
  - Tire pressure drop below threshold
  - Vehicle unlocked for extended period
  - Service due soon
- Configurable in Settings page
- Requires periodic polling or check on tab focus

---

## Phase 3 — Remote Vehicle Commands

These features send commands to the vehicle via `POST /connect/v1/vehicles/{vin}/commands`. They require new server-side proxy endpoints and careful UX with confirmation dialogs and status polling.

### 3.1 Lock / Unlock
- Lock button — `lock_vehicle()` (no PIN required)
- Unlock button — `unlock_vehicle(pin)` (requires security PIN + SHA512 challenge via `SPIN_CHALLENGE`)
- Confirmation modal before executing
- Poll command status until confirmed

### 3.2 Charging Control
- Start charging — `direct_charge_on()`
- Stop charging — `direct_charge_off()`
- Set charge target SOC — `set_target_soc(target)` (slider, 25-100%)
- Edit battery care mode — `CHARGING_SETTINGS_BATTERYCAREMODE_EDIT`

### 3.3 Climate Control
- Start climate — `climatise_on(temperature)` with temperature picker
- Stop climate — `climatise_off()`
- Start remote heating — `REMOTE_HEATING_START`
- Stop remote heating — `REMOTE_HEATING_STOP`
- Auxiliary ventilation — `REMOTE_ACV_START` / `REMOTE_ACV_STOP`

### 3.4 Honk & Flash (Find My Car)
- Flash indicators — `flash_indicators()` (mode: FLASH)
- Honk and flash — `honk_and_flash_indicators()` (mode: HONK_AND_FLASH)
- Confirmation before honk to avoid accidental use

### 3.5 Departure Timer Management
- View and edit departure timers — `DEPARTURES_EDIT` / `TIMERS_EDIT`
- Enable/disable timers — `TIMERS_DISABLE`
- Configure pre-conditioning for departures

### 3.6 Command Status Infrastructure
- Server-side endpoint to poll `GET /connect/v1/vehicles/{vin}/commands/{status_id}`
- UI feedback: pending → in progress → success/failed
- Timeout handling for commands that don't complete

---

## Phase 4 — Advanced Features

Larger features that build on top of everything above.

### 4.1 Drive Replay / Location History
- Record GPS snapshots over time to build route history
- Replay drives on the map
- Requires background polling mechanism or service worker

### 4.2 Destination Sync
- Send navigation destination to vehicle — `CS_DESTINATION_SYNC`
- Address search with autocomplete
- Save favorite destinations

### 4.3 Charging Cost Analytics
- Combine charging session data with electricity rates
- Track cost per charge, cost per km, monthly spending
- Compare home vs public charging costs
- Off-peak vs peak charging analysis

### 4.4 Multi-Vehicle Dashboard
- Support accounts with multiple vehicles
- Vehicle switcher in header
- Per-vehicle analytics and comparison
- Fleet-style overview for multi-car households

### 4.5 PWA / Widgets
- Progressive Web App for mobile home screen
- Lock screen widget showing battery %, range, lock state
- Companion watch app (Apple Watch / Wear OS)

### 4.6 Data Export & Sharing
- Export trip history, charging sessions, battery health as CSV
- Shareable efficiency reports (anonymized)
- Integration with other EV tracking platforms

---

## Out of Scope

Features the Porsche Connect API **does not support** (unlike Tesla's API):

- **Dashcam / Sentry Mode** — No camera access via API
- **OBD-level diagnostics** — API exposes ~62 measurements vs Tesla's 200+
- **Autopilot / driver assist telemetry** — Not exposed
- **Software update management** — Not available via API
- **Garage door / HomeLink control** — Not exposed

---

## API Reference

Based on [pyporscheconnectapi](https://github.com/CJNE/pyporscheconnectapi):

- **Base URL**: `https://api.ppa.porsche.com/app`
- **Vehicles**: `GET /connect/v1/vehicles`
- **Vehicle data**: `GET /connect/v1/vehicles/{vin}?mf=MEASUREMENT_1,MEASUREMENT_2,...`
- **Capabilities**: `GET /connect/v1/vehicles/{vin}/capabilities`
- **Pictures**: `GET /connect/v1/vehicles/{vin}/pictures`
- **Commands**: `POST /connect/v1/vehicles/{vin}/commands`
- **Command status**: `GET /connect/v1/vehicles/{vin}/commands/{status_id}`
- **62 measurement types**, **47 command types**, **11 with ready-to-use methods**
