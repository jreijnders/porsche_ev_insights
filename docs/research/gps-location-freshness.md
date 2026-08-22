# Does `GPS_LOCATION` refresh while the car is parked?

Research for [issue #3](https://github.com/jreijnders/porsche_ev_insights/issues/3). Date: 2026-08-22.

## Verdict

**(a) holds — position is pushed by the vehicle on ignition-off, so the reported position *is* the trip endpoint.**

More precisely, and better than (a) as stated in the issue: the vehicle pushes its current position to
the Porsche backend on a **set of discrete status-change events**, of which engine-stop is one. Between
those events nothing is transmitted and nothing needs to be — a parked car is not moving, so the stored
value stays *correct* even as it grows *old*.

**(c) does not hold** as long as we keep issuing the plain `mf=` request we issue today. The read we do
is served from the backend's stored copy; it does not touch the car and cannot wake it. Waking is a
separate, explicitly opted-into code path (`wakeUpJob=`) that this codebase does not use.

Confidence: **high** for the trigger list and for the stored-vs-wake distinction (both documented by
Porsche and/or visible in reference client code). **Medium** for the precise semantics of the
`lastModified` timestamp. See the per-claim confidence table at the end.

---

## 1. When does the vehicle transmit its position?

### Documented fact

Porsche's own data-protection information for the Porsche Connect bundle states, for the **Carfinder**
service:

> To enable you to see the location of your vehicle, the current position of your vehicle is transferred
> to us by your vehicle **every time the engine is started or stopped, when your vehicle's doors or
> tailgate are opened or closed, when defined battery levels are reached, and when activated by you
> through requests for the vehicle location** via My Porsche and your Porsche Connect App. The
> transmitted data is used to generate information to enable the vehicle's location to be displayed. The
> information is subsequently displayed in My Porsche and in your Porsche Connect App. **The data will be
> stored in our system for this purpose until the next status change and will be overwritten when the
> status changes.**

Sources (the same paragraph appears in multiple regional editions, which is why I treat it as stable
rather than a one-off):

- https://connect-store.porsche.com/offer/us/en-US/taycan_2025/products/bundle_connect_v3/data-privacy
- https://connect-store.porsche.com/offer/nz/en-NZ/911_2025/products/bundle_connect_v3/data-privacy
- https://connect-store.porsche.com/offer/us/en-US/911_2022/products/bundle_connect_v3/data-privacy

The same document describes the **Car Control** service (vehicle status: "remaining range, vehicle
position, direction, fuel level, mileage, locking status, parking light status, and instrument cluster
warnings") with the *identical* trigger list: engine start/stop, doors/rear lid open/close, defined
battery levels reached, and on user request.

### What this means for us

1. **Engine stop is a trigger.** The position stored in the backend after a trip is the position at
   which the trip ended. This is exactly what the place-harvester wants — answer (a).
2. **Engine start is also a trigger.** So we get the trip *start* point too, pushed at the moment the
   trip starts.
3. **It is event-driven, not interval-driven.** Nothing is pushed while the car sits still. So the
   answer to "how stale can it get" is: **arbitrarily old in wall-clock terms, but not wrong.** Park for
   three weeks and `GPS_LOCATION` will be three weeks old and still be where the car is.
4. **The backend keeps exactly one position, overwritten on each status change.** There is no
   server-side position history to page through. Whatever we want to remember, we have to remember
   ourselves.
5. **Door/tailgate events also push position.** This is the subtle one — see §4.

### Not established

- Whether "when defined battery levels are reached" fires on a BEV during charging (plausible: the
  trigger list is shared with the fuel-level/charging services), and at which thresholds.
- Whether the underlying telematics unit additionally pushes on a timer in some markets or model years.
  The privacy document lists no interval, and I found no source claiming one, but absence of
  documentation is not proof of absence.
- Whether *movement with ignition off* (tow-away) pushes position outside the Car Alarm / Location Alarm
  services. Marketing copy for those alarm services implies motion-triggered reporting exists, but it is
  described as part of the alarm services, not Carfinder.

---

## 2. Does our poll wake the car? No — but there is a switch that would

### Documented fact (reference client source)

`pyporscheconnectapi` has two read paths against exactly the endpoint we call
(`GET /connect/v1/vehicles/{vin}?mf=…`), and they differ by **one query parameter**:

```python
async def get_stored_overview(self) -> None:
    """Return stored vechicle status overview."""
    measurements = "mf=" + "&mf=".join(MEASUREMENTS)
    self.status = await self.connection.get(f"/connect/v1/vehicles/{self.vin}?{measurements}")

async def get_current_overview(self) -> None:
    """Return vehicle current status overview."""
    measurements = "mf=" + "&mf=".join(MEASUREMENTS)
    wakeup = "&wakeUpJob=" + str(uuid.uuid4())
    self.status = await self.connection.get(f"/connect/v1/vehicles/{self.vin}?{measurements + wakeup}")
```

Source: https://github.com/CJNE/pyporscheconnectapi/blob/main/pyporscheconnectapi/vehicle.py

`api/porsche/vehicle/[vin]/{overview,status,trips}.js` build the URL with `mf=` only and no
`wakeUpJob`, i.e. all three of our endpoints are on the **stored** path.

### Corroboration from the previous-generation API

The older `api.porsche.com` API made the same split into two *separate endpoints*, and third-party
clients documented the semantics explicitly:

- `GET /service-vehicle/{locale}/vehicle-data/{vin}/stored` — "The vehicle is not queried directly;
  instead, this call retrieves data stored server-side about the vehicle, based on the vehicle's most
  recent update."
- `POST /service-vehicle/{locale}/vehicle-data/{vin}/current/request` — "The vehicle will be queried
  directly, and the information received should be fully up-to-date. **This may take a while, or fail,
  especially if the vehicle is turned off** or has limited cellular signal." Returns a job id you then
  poll.

Source: https://github.com/wisq/porsche_conn_ex/blob/main/lib/porsche_conn_ex/client.ex

`evcc` implements its Porsche `WakeUp()` by POSTing to exactly that `current/request` URL:

```go
// WakeUp tries to wakeup the vehicle by requesting the current vehicle overview
func (v *API) WakeUp(vin string) error {
	uri := fmt.Sprintf("%s/service-vehicle/de/de_DE/vehicle-data/%s/current/request", ApiURI, vin)
```

Source: https://github.com/evcc-io/evcc/blob/master/vehicle/porsche/api.go

So on the old API, "give me current data" *is* the wake primitive, and it is a distinct call from the
stored read. On the new API the same distinction survives as the `wakeUpJob=<uuid>` parameter and the
`get_current_overview` / `get_stored_overview` pair. The naming and the one-to-one structural
correspondence make this a strong inference, though I did not observe a live wake.

### Behavioural corroboration

The reference Home Assistant integration by the same author polls **only** the stored overview, on a
default interval of 1920 s (32 minutes):

```python
# const.py
DEFAULT_SCAN_INTERVAL = 1920

# __init__.py — the DataUpdateCoordinator
async with async_timeout.timeout(30):
    for vehicle in self.vehicles:
        await vehicle.get_stored_overview()
```

Sources:
- https://github.com/CJNE/ha-porscheconnect/blob/main/custom_components/porscheconnect/const.py
- https://github.com/CJNE/ha-porscheconnect/blob/main/custom_components/porscheconnect/__init__.py

Its `device_tracker` entity is fed straight from that stored data and exposes staleness as an attribute:

```python
data = {"updated_at": self.vehicle.location_updated_at}
```

Source: https://github.com/CJNE/ha-porscheconnect/blob/main/custom_components/porscheconnect/device_tracker.py

A widely used integration polling stored location every ~32 minutes, indefinitely, without a
wake-related caveat in its README, is consistent with the stored read being cheap and non-waking. It is
supporting evidence, not proof.

### Implication for §2.1 of `wiki/Roadmap.md`

The roadmap's planned "Refresh" button using `get_current_overview()` is the **one** feature that would
introduce wake behaviour. It should stay a deliberate, user-initiated, rate-limited action and must
never be wired into the 15-minute poll.

---

## 3. What is `location_updated_at`, and is it in the same `mf=` request?

### Documented fact

**Yes, it comes free with `mf=GPS_LOCATION`. There is no separate measurement to request.**

`location_updated_at` is not an API field name — it is `pyporscheconnectapi`'s property name for a field
called `lastModified` that lives **inside the `GPS_LOCATION` measurement's `value` object**:

```python
@property
def location_updated_at(self) -> datetime:
    """Return time stamp of latest location update."""
    datetime_str = self.data.get("GPS_LOCATION", {}).get("lastModified")
    if datetime_str:
        return _parse_porsche_datetime(datetime_str)
    return None

@property
def location(self) -> tuple[float | None, float | None, int | None]:
    """Get the location of the vehicle."""
    loc = self.data.get("GPS_LOCATION", {}).get("location")
    heading = self.data.get("GPS_LOCATION", {}).get("direction")
```

That `self.data` is built by flattening the response's `measurements` array with
`mdata[m["key"]] = m["value"]`, so `lastModified`, `location` and `direction` are all siblings inside
`measurements[].value` for `key == "GPS_LOCATION"`. Source:
https://github.com/CJNE/pyporscheconnectapi/blob/main/pyporscheconnectapi/vehicle.py

Confirmed by absence as well: `MEASUREMENTS` in `pyporscheconnectapi/const.py` (58 keys, a superset of
our `ALL_MEASUREMENTS`) contains no location-timestamp key —
https://github.com/CJNE/pyporscheconnectapi/blob/main/pyporscheconnectapi/const.py

Two more documented facts about the payload:

- `location` is a **comma-separated string**, not a pair of numbers — the library parses it with
  `re.match(r"[\-\.0-9]+,[\-\.0-9]+", loc)` then `map(float, loc.split(","))`. Negative coordinates were
  a bug once: https://github.com/CJNE/pyporscheconnectapi/issues/62
- `lastModified` is **not always present**. A `TypeError: strptime() argument 1 must be str, not None`
  crash was filed and fixed by guarding for `None`:
  https://github.com/CJNE/pyporscheconnectapi/issues/58

Also note each measurement carries a `status` object; the library filters on
`m["status"]["isEnabled"]` before using a measurement. Our `src/App.jsx` does not check this — it does
`allMeasurements.find(m => m.key === 'GPS_LOCATION')?.value` — so we may read a value the backend has
flagged as not enabled (e.g. privacy mode).

### Not established (medium confidence, needs one empirical check)

Whether `lastModified` is the **GPS fix time in the vehicle** or the **backend's receipt/update time**.
The name argues for the latter, the library's docstring ("time stamp of latest location update") is
ambiguous, and I found no source that pins it down. For the harvester the difference is seconds to
minutes, so it does not change the design — but it does mean we should not present it as "the car was
here at exactly HH:MM:SS".

Also unverified: whether `lastModified` is bumped on *every* backend write, or only when the coordinates
actually change. This one matters (see §4) and is cheaply answered by observation.

### Recommendation

No change to the `MEASUREMENTS` array in `api/porsche/vehicle/[vin]/overview.js` is needed — the
timestamp is already in the response we get today. The change is client-side, in `src/App.jsx`:

```js
// currently
gpsLocation: getMeasurement('GPS_LOCATION')?.value,
```

`status.gpsLocation.lastModified` is therefore *already* reaching `MyCarTab.jsx`, which passes the whole
object to `LocationMap` and labels the card "Last known location" without ever showing the age. Surfacing
it is a display change only. Roadmap §2.1's "Display `location_updated_at`" needs no new API call and no
wake — it can ship independently of the refresh button it is currently grouped with.

---

## 4. Consequences for the 15-minute polling design

These follow from §1 and are inference from documented behaviour, not separately sourced.

1. **The design is sound.** A parked car's stored position is the trip endpoint, and reading it is free
   and non-waking. 15 minutes is comfortably conservative — the reference HA integration uses 32.

2. **The real risk is not staleness, it is *collapse*.** The backend stores one position, overwritten on
   each status change. Two trips completed inside a single 15-minute window leave only the second
   endpoint visible; the intermediate stop is unrecoverable. Short hops (drop-off, quick errand) are
   exactly where this bites. A shorter interval reduces the window but cannot eliminate it. This should
   be stated as a known limitation of the harvester rather than treated as a bug.

3. **`lastModified` changing does not mean the car moved.** Door and tailgate open/close also push
   position. Loading shopping into a parked car can bump the timestamp with unchanged coordinates. So:
   - detect movement by comparing **coordinates**, and cross-check with **`MILEAGE`**, which is in the
     same stored overview and pushed on the same events. Mileage delta > 0 means a trip; mileage delta
     == 0 with a new timestamp means someone opened a door.
   - do not use `lastModified` alone as "parked since" — it is "last status-change event", not "arrival
     time". After a door event it will understate how long the car has been at that spot.

4. **Trip statistics carry no coordinates, so the harvester is the only route.** I checked the
   `TRIP_STATISTICS_*` payload shape: the trip record has `timestamp` (trip end), `travelTime`,
   `startMileage`, `endMileage`, `tripMileage`, `averageSpeed`, `zeroEmissionDistance` and the two
   consumption figures — and no latitude/longitude anywhere.
   Source: https://github.com/wisq/porsche_conn_ex/blob/main/lib/porsche_conn_ex/struct/trip.ex
   Correlating a harvested position with a trip record has to be done on **mileage and timestamp**.
   (Same-generation-API caveat: this struct is from the older `api.porsche.com` trip payload. The
   `mf=TRIP_STATISTICS_*` response on `api.ppa.porsche.com` is very likely the same shape, but I did not
   confirm it field-by-field. Worth a five-minute check against a live response before building on it.)

5. **Privacy mode is a hard stop, and we do not handle it.** With private mode active "the online
   functionalities of the service are no longer available"
   (https://ask.porsche.com/us/en-US/privacy-mode/). `GLOBAL_PRIVACY_MODE` is already in our
   `ALL_MEASUREMENTS`; the reference integration skips creating the device tracker entirely when
   `privacy_mode` is true. The harvester should detect it and pause rather than silently record gaps —
   and gaps caused by privacy mode should not be interpreted as the car sitting still.

6. **A stuck timestamp means a broken telematics link, not a stationary car.** Owner reports of the
   app showing position and status "as of 5 days ago" trace to LTE/telematics faults, privacy mode, or a
   corrupted OTA module — not to normal API behaviour.
   - https://www.taycanforum.com/forum/threads/app-showing-old-car-data-location-status.10172/
   - https://www.taycanforum.com/forum/threads/porsche-app-vehicle-details-not-updating.35400/

   Practical consequence: an old `lastModified` is ambiguous between "parked for days" and "car offline
   for days". `MILEAGE` and `BATTERY_LEVEL` from the same poll help disambiguate — a genuinely parked
   BEV still loses charge slowly, and if *nothing at all* changes across many polls while charging was
   expected, suspect the link rather than the car.

---

## Confidence table

| Claim | Confidence | Basis |
|---|---|---|
| Position is pushed on engine stop → reported position is the trip endpoint | **High** | Porsche data-protection doc, 3 regional editions |
| Position also pushed on engine start, door/tailgate open/close, defined battery levels, user request | **High** | Same |
| Transmission is event-driven; no interval push while parked | **High** | Same (no interval documented anywhere) |
| Backend stores one position, overwritten on each status change (no history) | **High** | Same |
| Plain `mf=` read is served from the backend store and does not wake the car | **High** | Our code path + `get_stored_overview` in reference client + old-API `/stored` docstring |
| `wakeUpJob=<uuid>` is the wake path and we do not use it | **High** for "we don't use it"; **medium-high** for "it wakes the car" | Code inspection; wake semantics inferred from naming + 1:1 correspondence with old-API `current/request`, not observed live |
| `lastModified` is inside `measurements[].value` for `GPS_LOCATION`, same `mf=` request, no new measurement needed | **High** | Reference client reads `data["GPS_LOCATION"]["lastModified"]` after flattening `m["value"]`; no timestamp key in `MEASUREMENTS` |
| `lastModified` can be absent/null | **High** | Filed and fixed bug, issue #58 |
| `lastModified` is backend write time rather than in-vehicle GPS fix time | **Medium** | Field name and library docstring only; unverified |
| `lastModified` is bumped even when coordinates are unchanged | **Low–medium** | Inferred from the door-event trigger; needs observation |
| `mf=TRIP_STATISTICS_*` contains no coordinates | **Medium-high** | Confirmed for the old-API trip payload; new-API shape assumed identical, not verified field-by-field |
| Two trips inside one poll interval collapse to one observation | **High** | Follows directly from single-slot overwrite semantics |
| Privacy mode suppresses location entirely | **High** | Porsche privacy doc + ask.porsche.com |

## Suggested empirical checks (cheap, would close the remaining gaps)

1. Log `GPS_LOCATION.lastModified` plus `MILEAGE` every 15 minutes for a few days. Confirms the
   event-driven pattern directly, and shows whether `lastModified` moves without coordinates moving.
2. Compare a plain `mf=` read against one with `&wakeUpJob=<uuid>` on a car parked overnight: latency,
   whether `lastModified` jumps to now, and whether the car reports as having woken. Confirms the wake
   semantics — but do this **once**, manually, not in the poll loop.
3. Dump one live `mf=TRIP_STATISTICS_SHORT_TERM_HISTORY` response and check for coordinate fields, to
   settle #4 above for the current API generation.

## Sources

- https://connect-store.porsche.com/offer/us/en-US/taycan_2025/products/bundle_connect_v3/data-privacy
- https://connect-store.porsche.com/offer/nz/en-NZ/911_2025/products/bundle_connect_v3/data-privacy
- https://connect-store.porsche.com/offer/us/en-US/911_2022/products/bundle_connect_v3/data-privacy
- https://ask.porsche.com/us/en-US/privacy-mode/
- https://github.com/CJNE/pyporscheconnectapi/blob/main/pyporscheconnectapi/vehicle.py
- https://github.com/CJNE/pyporscheconnectapi/blob/main/pyporscheconnectapi/const.py
- https://github.com/CJNE/pyporscheconnectapi/blob/main/pyporscheconnectapi/cli.py
- https://github.com/CJNE/pyporscheconnectapi/issues/58
- https://github.com/CJNE/pyporscheconnectapi/issues/62
- https://github.com/CJNE/ha-porscheconnect/blob/main/custom_components/porscheconnect/__init__.py
- https://github.com/CJNE/ha-porscheconnect/blob/main/custom_components/porscheconnect/const.py
- https://github.com/CJNE/ha-porscheconnect/blob/main/custom_components/porscheconnect/device_tracker.py
- https://github.com/wisq/porsche_conn_ex/blob/main/lib/porsche_conn_ex/client.ex
- https://github.com/wisq/porsche_conn_ex/blob/main/lib/porsche_conn_ex/struct/trip.ex
- https://github.com/wisq/porsche_conn_ex/blob/main/lib/porsche_conn_ex/struct/position.ex
- https://github.com/evcc-io/evcc/blob/master/vehicle/porsche/api.go
- https://www.taycanforum.com/forum/threads/app-showing-old-car-data-location-status.10172/
- https://www.taycanforum.com/forum/threads/porsche-app-vehicle-details-not-updating.35400/

Out of scope per the issue: 12V battery drain.
