# How far back does the Porsche Connect trip history reach?

Research for issue #2. Date of research: 2026-08-22. All statements below are labelled
**Fact** (verifiable in a cited source), **Inference** (my reading of the sources) or
**Unknown**, with a confidence level.

## Bottom line

**No published limit exists.** Neither Porsche nor any of the public reverse-engineering
projects states how many entries `TRIP_STATISTICS_SHORT_TERM_HISTORY` returns, or how far
back they reach. I did not find a single source — repo, issue, forum post, privacy notice —
that names a number of trips or a retention period for this measurement key. Anyone who
gives you a figure ("30 trips", "12 months") is guessing; the circumstantial evidence for
"about a year" (below) is about the **My Porsche app/portal**, not about this API key.

Two consequences for the ledger:

1. **The CSV hedge in issue #6 is load-bearing, not optional.** The My Porsche mobile app
   has an export dialog with a date range *and* a "Complete history" toggle (owner-documented,
   see sources). That is today the only path with any evidence of reaching the full history.
   Do it now, before anything rolls off.
2. **The window is cheap to measure and impossible to reconstruct.** The experiment at the
   bottom of this file takes minutes and settles the question for *this* car; nothing found
   on the public internet will. Until it is run, treat the window as "unknown, possibly
   short" and make the first sync persist everything it sees.

## What is established

### The request shape — Fact, high confidence

Trip history is not a resource of its own. It is requested as *measurement filters* on the
vehicle resource:

```
GET https://api.ppa.porsche.com/app/connect/v1/vehicles/{vin}?mf=TRIP_STATISTICS_SHORT_TERM_HISTORY&mf=...
```

Six trip keys are known: `TRIP_STATISTICS_SHORT_TERM`, `..._SHORT_TERM_HISTORY`,
`..._LONG_TERM`, `..._LONG_TERM_HISTORY`, `..._CYCLIC`, `..._CYCLIC_HISTORY`. The identical
list appears in four independent clients:

- <https://github.com/CJNE/pyporscheconnectapi/blob/master/pyporscheconnectapi/const.py> (`TRIP_STATISTICS`)
- <https://github.com/dglancy/porsche-connect/blob/main/Sources/PorscheConnect/APIs/VehicleTripStatistic.swift>
- <https://github.com/ejci/porsche-ev/blob/main/lib/api.js>
- this repo: `api/porsche/vehicle/[vin]/trips.js`

### There is no pagination and no date range — Fact, high confidence

Across every public client I read (`pyporscheconnectapi`, `dglancy/porsche-connect`,
`ejci/porsche-ev`, `TA2k/ioBroker.porsche`, `SchwabJ/homebridge-porsche`,
`its-me-prash/vwgroup-connect-ha`, this repo) the only query parameters ever sent to
`/connect/v1/vehicles/{vin}` are `mf=` filters — plus `wakeUpJob=<uuid>` to force a refresh
(<https://github.com/TA2k/ioBroker.porsche/blob/main/main.js>). No `from`/`to`, no `page`,
no `limit`, no cursor. Whatever the backend chooses to put in `value.list` is all you get.

The only other vehicle-scoped paths anyone has published are `/measurements`, `/capabilities`,
`/serviceIntervals`, `/pictures` and `/commands`
(<https://github.com/its-me-prash/vwgroup-connect-ha/blob/main/custom_components/vag_connect/cariad/api/_v3_probes.py>,
<https://github.com/dglancy/porsche-connect/blob/main/Sources/PorscheConnect/NetworkRoutes.swift>).
No trips path.

### The legacy endpoint that the famous forum advice refers to is dead — Fact, high confidence

The Taycan-forum thread everyone cites ("pull *short term* trips and you get them all",
2023) refers to the **old** API:
`GET https://api.porsche.com/service-vehicle/{country}/{lang}/trips/{vin}/SHORT_TERM`
— visible in `pyporscheconnectapi` history (`client.py`, commit `0759391`, `getTripShortTerm`)
and still in the Swift client's `NetworkRoutes.swift`. Those entries carried
`startMileage`/`endMileage`/`tripMileage`/`timestamp`. Porsche migrated to
`api.ppa.porsche.com` in 2024 (`pyporscheconnectapi` commit `e1d2407` "first stab at new API";
issue <https://github.com/CJNE/pyporscheconnectapi/issues/46> "APIs changed?"). So the
forum's encouraging claim was made against an endpoint that no longer exists, with a
different response shape than the one this app parses. **Do not carry that claim forward.**
Sources: <https://www.taycanforum.com/forum/threads/recommendations-for-downloading-historical-trip-data.16001/> (posts 8, 11, 13).

### Nobody has published a limit — Fact, high confidence

- `pyporscheconnectapi` has no documentation of the trip response beyond the key list, and
  its issue tracker (all 44 issues, 2021–2026) contains **nothing** about trip history length:
  <https://github.com/CJNE/pyporscheconnectapi/issues?q=is%3Aissue>
- A GitHub code search for `TRIP_STATISTICS_SHORT_TERM_HISTORY` returns 9 hits — all of them
  key lists in clients, none a captured payload or a documented count.
- Porsche publishes no developer documentation for this API at all.

### What the response actually looked like on a live car — Fact (single observation), medium-high confidence

The only *measured* PPA trip payload I could find in public code is in
`SchwabJ/homebridge-porsche` (Taycan, measured against the live API on **2026-08-01**), and it
is a sobering data point:

```
TRIP_STATISTICS_CYCLIC -> value.list = [ { avgKwhPerHundredKm, avgSpeedKmh,
                                           distanceKm, drivingTimeMinutes, tripEndTime } ]
```

— exactly **one** entry, five fields, being the car's resettable since-charge counter. Their
own comment (translated): *"A trip history is not what this interface delivers; the keys
`TRIP_STATISTICS_LONG_TERM`, `_SHORT_TERM` and `TRIP_STATISTICS` were tried individually and
do not answer. The monthly figures in the Porsche app (1586 km in July) come from a
server-side aggregation that the measurement endpoint does not reach."*
Sources: <https://github.com/SchwabJ/homebridge-porsche/blob/main/src/api/measurements.ts> (lines ~150–181),
<https://github.com/SchwabJ/homebridge-porsche/blob/main/test/measurements.test.ts> (~line 249),
<https://github.com/SchwabJ/homebridge-porsche/blob/main/CHANGELOG.md> (0.9.0: *"the API offers no trip history at all"*).

Caveat that keeps this from being decisive: they queried a large `mf=` set and report the
`_HISTORY` keys not by name, so I cannot tell whether they ever requested
`SHORT_TERM_HISTORY` itself. This repo's upstream clearly *does* get a list from
`SHORT_TERM_HISTORY` (`transformTripDataToCSV` iterates `value.list` and users report working
imports), so the honest reading is not "the key is empty for everybody" but "**what the trip
keys return varies by car, model year, Connect entitlement or region**" — Inference,
medium-high confidence.

### Porsche's own words on trip data — Fact, high confidence (but legalese)

The Porsche Connect data-protection information for the **Trip Control** service says the car
transmits trip length, duration, average speed and average consumption *"each time the engine
is switched off and when trips are reset in your vehicle"*, and: **"The data will be stored in
our system for this purpose until the next status change and will be overwritten when the
status changes."**
Source: <https://connect-store.porsche.com/offer/us/en-US/911_2022/products/bundle_connect_v3/data-privacy>

Read literally that describes a *current-value* store, not an archive — consistent with the
measurement model (`mf=` = "measurement filter", latest value per key) and with the single-entry
observation above. It is boilerplate and it certainly does not promise any history depth.
Inference from it: **do not expect a long server-side per-trip archive behind the `mf=` keys** —
medium confidence.

### What each key means for a mileage ledger — Fact/Inference, medium-high confidence

- `SHORT_TERM_HISTORY` — the per-drive records (the only per-trip source). This is what
  `transformTripDataToCSV` uses.
- `CYCLIC_HISTORY` — one entry per **charge cycle** ("since charging"), i.e. an aggregate,
  not individual trips. This repo already reads it separately as `chargeData`
  (`src/services/porscheConnect.js:417-427`).
- `LONG_TERM_HISTORY` — lifetime/long-term totals, per this repo's comments (line 307) and
  the semantics of the car's third trip memory.

**No evidence that `CYCLIC_HISTORY` reaches further back than `SHORT_TERM_HISTORY`** — Unknown.
It is nonetheless the better fallback for *kilometres* if it turns out to be longer, since a
charge-cycle aggregate still carries `distanceKm`; it just cannot be split into journeys.

Worth noting for issue #12: the observed PPA entry shape carries **no odometer** — the legacy
API's `startMileage`/`endMileage` are gone (this repo's transform reads them but the observed
fields do not include them). Odometer reconciliation has to come from the `MILEAGE` measurement.

### One undocumented key worth probing — Fact that the key name exists, Unknown what it returns

`TRIP_STATISTICS_MONTHLY_REPORT` appears in the ioBroker adapter's measurement list
(<https://github.com/TA2k/ioBroker.porsche/blob/main/main.js>, "Monthly trip report") and in
**no** other client, including this repo. If the app's monthly figures come from a
server-side aggregation (as the homebridge author concluded), this is the most likely key to
carry it. Add it to the probe. Also absent from this repo's list: `LOCATION_ALARMS_HISTORY`,
`SPEED_ALARMS_HISTORY`, `VALET_ALARM_HISTORY`, `TIMEZONE`, `OTA_*`.

## The "about a year" story — and why it is not an answer

Circumstantial, all of it about the **app/portal**, none of it about the `mf=` API:

- Thread opener, 2023: *"My understanding is that the app deletes the data after a year"* —
  hearsay, unverified.
- Same thread: *"I found that I could download some data in CSV format about consumption, but
  that was only for the last 12 months now/ ?"* — a user's uncertain reading of the portal.
- Macan EV owner, 2026: wishes the dashboard would store data locally *"to have a story of the
  car that goes over the 12 months"* — implies his source data covers ~12 months.
  <https://www.macanevowners.com/forum/threads/diy-analytics-dashboard-for-macan-ev-trip-data.24838/page-2>

Confidence that *something* in the My Porsche stack is bounded near 12 months: **medium**.
Confidence that this bound is the `SHORT_TERM_HISTORY` window: **low**. Two different
mechanisms are being conflated in these posts, and a rolling entry-count cap would look
identical to a time cap to any user who drives at a steady rate.

## The one credible path to the full history: the app's own export

An owner's step-by-step on the Macan EV forum (2026), describing the current My Porsche
mobile app:

> 1) get into the "All trip data" Screen 2) Make sure "Since Start" is selected … 3) Top Right
> corner, press the box with an arrow pointing down … 5) Enter the date range in the dialog box,
> **or toggle the "Complete history" to on** 6) … the grayed out box at the bottom … lights up
> with "download csv"

Source: <https://www.macanevowners.com/forum/threads/diy-analytics-dashboard-for-macan-ev-trip-data.24838/> (post 8; app-version dependent — post 6/15 show it arriving in an update).

Two readings, and the difference matters:

- **Inference, medium confidence:** a date-ranged / full-history export endpoint exists behind
  that dialog. A UI cannot offer a date range over data it does not have. Its path and
  parameters are **not published anywhere** — I found no client, gist or write-up that captured
  it. Finding it means capturing the app's or portal's own traffic.
- **Alternative reading, also plausible:** the export is assembled from the same aggregation
  that feeds the app's monthly view, so "complete history" means "as complete as Porsche's
  archive is" — which is exactly the number we do not know.

Either way, running that export today is the action that cannot be recovered later.

## Also relevant: the history has holes

An owner reports a **two-month gap** in the data Porsche returned: *"it looks as though when
comms to the car fail, the Porsche service makes no attempt to buffer and catch up
retrospectively."*
Source: <https://www.taycanforum.com/forum/threads/i-built-a-privacy-first-analytics-dashboard-for-taycan-macan-ev-trip-data.33166/> (post 12).
For a Dutch mileage ledger this is arguably a bigger risk than the window: a ledger built only
on this API can be **silently incomplete**, which is why the odometer cross-check (issue #12)
has to be a hard invariant, not a nicety.

## What I could not establish

- The number of entries `SHORT_TERM_HISTORY` returns. **Unknown.**
- Whether the cap is an entry count, a time span, or per-vehicle. **Unknown** — no source
  distinguishes them; the homebridge observation is weak evidence for per-vehicle variation.
- Whether `CYCLIC_HISTORY` reaches further back. **Unknown.**
- Whether any paginated or date-ranged variant of the measurement endpoint exists.
  **No published variant exists** (high confidence); an unpublished app-facing export endpoint
  is likely (medium confidence, see above).
- What `TRIP_STATISTICS_MONTHLY_REPORT` returns. **Unknown.**
- Whether trips from before **18 July 2026** are reachable at all. **Unknown** — and the only
  way to find out is to look today.

Methodological gaps, stated plainly: taycanforum/macanevowners paginated URLs beyond page 1 are
behind a Cloudflare challenge, so I read page 1 of each thread in full and could only reach page 2
of one of them; there may be later posts with harder numbers. I did not make any authenticated
API call — no credentials were used and none should be, by an agent.

## The experiment that settles it (≈15 minutes, needs the owner's login)

Two calls, a week apart, distinguish every hypothesis:

1. **Now.** Request all seven trip keys (the six known plus `TRIP_STATISTICS_MONTHLY_REPORT`)
   and save the *raw* JSON to a dated file — this is the archive, keep it:
   ```
   GET https://api.ppa.porsche.com/app/connect/v1/vehicles/{VIN}
       ?mf=TRIP_STATISTICS_SHORT_TERM_HISTORY&mf=TRIP_STATISTICS_CYCLIC_HISTORY
       &mf=TRIP_STATISTICS_LONG_TERM_HISTORY&mf=TRIP_STATISTICS_SHORT_TERM
       &mf=TRIP_STATISTICS_CYCLIC&mf=TRIP_STATISTICS_LONG_TERM
       &mf=TRIP_STATISTICS_MONTHLY_REPORT
   ```
   (`Authorization: Bearer …`, `x-client-id`, `User-Agent` — as `api/porsche/_utils.js` already
   sends. Or `porschecli -v trip_statistics` from `pyporscheconnectapi`.)
   Record per key: does it answer at all; `value.list.length`; oldest and newest `tripEndTime`;
   the field names present.
2. **Read off the answer.** Oldest `tripEndTime` ≥ 18 July 2026 and a round-looking count
   (30/50/100) ⇒ entry-count cap, and the pre-acquisition history is already gone. Oldest
   `tripEndTime` far older than the count would imply ⇒ time-span cap.
3. **Same call 7 days later.** If the count is unchanged and the oldest entry has moved forward
   ⇒ fixed entry count. If the count grew and the oldest entry stayed ⇒ time span (or no cap yet).
4. **Before either:** run the app's "Complete history" CSV export (issue #6) and archive the file.
   That is the only step whose window closes.

Cheap and worth adding regardless of the result: make the first sync persist raw responses, so
the window is measured continuously by the ledger itself rather than assumed.

## Sources

- Porsche Connect data protection information, "Trip Control" — <https://connect-store.porsche.com/offer/us/en-US/911_2022/products/bundle_connect_v3/data-privacy>
- `CJNE/pyporscheconnectapi` — <https://github.com/CJNE/pyporscheconnectapi> (const.py; commits `e1d2407`, `0759391`, `92ac70a`; issues incl. <https://github.com/CJNE/pyporscheconnectapi/issues/46>)
- `SchwabJ/homebridge-porsche` — <https://github.com/SchwabJ/homebridge-porsche> (`src/api/measurements.ts`, `test/measurements.test.ts`, `CHANGELOG.md` 0.9.0)
- `TA2k/ioBroker.porsche` — <https://github.com/TA2k/ioBroker.porsche/blob/main/main.js>
- `dglancy/porsche-connect` — <https://github.com/dglancy/porsche-connect> (`NetworkRoutes.swift`, `VehicleTripStatistic.swift`)
- `ejci/porsche-ev` — <https://github.com/ejci/porsche-ev/blob/main/lib/api.js>
- `its-me-prash/vwgroup-connect-ha` — <https://github.com/its-me-prash/vwgroup-connect-ha> (`cariad/api/porsche.py`, `_v3_probes.py`)
- TaycanForum, "Recommendations for downloading historical trip data" — <https://www.taycanforum.com/forum/threads/recommendations-for-downloading-historical-trip-data.16001/>
- TaycanForum, "I built a privacy-first analytics dashboard…" — <https://www.taycanforum.com/forum/threads/i-built-a-privacy-first-analytics-dashboard-for-taycan-macan-ev-trip-data.33166/>
- MacanEVowners, "DIY Analytics Dashboard for Macan EV Trip Data" — <https://www.macanevowners.com/forum/threads/diy-analytics-dashboard-for-macan-ev-trip-data.24838/>
- Local: `api/porsche/vehicle/[vin]/trips.js`, `src/services/porscheConnect.js` (`transformTripDataToCSV`, lines 299–450)
