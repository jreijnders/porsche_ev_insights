# Porsche Connect API rate limits

Research for issue #4. Investigated 2026-08-22.

## Bottom line

**No published rate limit exists for the consumer Porsche Connect API (`api.ppa.porsche.com`).** Porsche does
not document this API at all — it is the private My Porsche mobile-app backend, reverse-engineered by the
community. Any number quoted anywhere is an observation, not a contract.

**~96 requests/day (15-minute interval) is almost certainly safe**, and the strongest evidence is behavioural
rather than documentary: every independent open-source client that polls this API in production sits in the
same 10–60 minute band, and the one project that has publicly documented a Porsche account block was blocked
by a **login** loop, not by read volume.

**The important correction to the framing in issue #4:** the expensive failure mode (account block → captcha)
is driven by the *authentication* path, not the *data* path. Read-volume throttling and auth-side blocking are
two different mechanisms on two different hosts with two different consequences. The poller should be designed
around that split.

---

## What I established

### 1. There is no documented request ceiling for `api.ppa.porsche.com`

**Confidence: high.**

Porsche's developer portal (`developer.porsche.com`) documents Porsche **ID** APIs and points partners to a
separate Developer Hub; it publishes no rate limits and does not cover the consumer app backend our code calls.
There is no public spec, SLA, or quota document for `api.ppa.porsche.com/app/connect/v1/*`.

- https://developer.porsche.com/faq

**Inference (not fact):** absence of a published limit means we cannot design to a number. We can only design
to observed behaviour and to a safety margin below what other clients demonstrably survive.

### 2. Rate-limit headers are present on the *auth* server, absent on the *data* server

**Confidence: medium-high** — mechanism is clear, but this rests on a single captured trace.

A debug log posted in `pyporscheconnectapi` issue #74 (14 June 2025) captures a full request/response cycle.
`POST identity.porsche.com/oauth/token` returned:

```
X-Ratelimit-Limit: 1500
X-Ratelimit-Remaining: 1459
X-Ratelimit-Reset: 1749927391
```

The two subsequent calls in the same trace — `GET api.ppa.porsche.com/app/connect/v1/vehicles` and
`GET .../vehicles/{vin}?mf=...` — carried **no** `X-Ratelimit-*` headers at all.

- https://github.com/CJNE/pyporscheconnectapi/issues/74

`identity.porsche.com` is an Auth0 tenant, and `X-RateLimit-Limit` / `-Remaining` / `-Reset` are Auth0's
standard headers (`Reset` is a UNIX timestamp of the reset instant).

- https://auth0.com/docs/troubleshoot/customer-support/operational-policies/rate-limit-policy

**Documented fact:** the auth server exposes a budget and tells you your remaining balance. The data server
tells you nothing.

**Inference:** 1500 does not match any of Auth0's published tier limits for `/oauth/token` (the documented
public figures are 50/min with bursts to 500, and a 300/min global for free tenants), so Porsche is on an
enterprise tenant with custom limits. Do **not** treat 1500 as a stable number, and do not assume the budget
is ours alone — the window length is unstated and the bucket may be shared per-IP or per-tenant. In the
captured trace `Reset` was one second after the response `Date`, which is consistent with a short refill
window rather than a per-day quota, but I cannot confirm the window from one sample.

### 3. `429` does occur on `api.ppa.porsche.com` — including on the exact endpoint our poller uses

**Confidence: high.** This is the most operationally relevant finding.

`pyporscheconnectapi` issue #63 ("Client error '429 Too Many Requests'", still **open**) records two distinct
429 sites:

1. **Remote-command path**, reported by the library maintainer (fredriklj, Dec 2024):
   `httpx.HTTPStatusError: Client error '429 Too Many Requests' for url 'https://api.ppa.porsche.com/app//connect/v1/vehicles/.../commands'`
   With the maintainer's own assessment: *"This error seem to mostly be temporary, as another call shortly
   thereafter seem to have a high probability of succeeding. We should wait for a few seconds and then do one
   or two retries."*

2. **Read path**, reported by a user (paulhargreaves, June 2025): a 429 raised from
   `vehicle.py … get_stored_overview` → `GET /connect/v1/vehicles/{vin}?{measurements}`.

- https://github.com/CJNE/pyporscheconnectapi/issues/63

Site 2 is **our endpoint**: `api/porsche/vehicle/[vin]/overview.js` and `api/porsche/vehicle/[vin]/trips.js`
both issue `GET /connect/v1/vehicles/{vin}?mf=...`, differing only in the `mf` filter list. So the combined
measurement read is 429-able.

**Important qualifier:** that report came from Home Assistant *platform setup*, i.e. a startup burst where the
integration fetches overview + picture locations for every vehicle back-to-back. It is evidence that bursts get
throttled; it is **not** evidence that a 15-minute steady cadence gets throttled.

**Confidence: high** that 429 is transient and recoverable. Both the maintainer's assessment and the reporter's
experience (a reload fixes it) point at a short-window throttle, not a durable penalty. No report anywhere
links a data-path 429 to a token revocation or account block.

### 4. The captcha/block risk lives in the auth flow, not the poll loop

**Confidence: high.** This is the finding that should drive the design.

`evcc` issue #10500 (26 Oct 2023) is the one well-documented Porsche account block in open source. The user's
poll interval was **60 minutes** — i.e. *slower* than our proposed default — and the block still happened,
because the failure was a login retry loop, not read volume. The captured error progression:

```
{"statusCode":403,"description":"Invalid state","name":"AnomalyDetected","code":"access_denied"}
```

then, after roughly six minutes of repeated login attempts (10:10–10:16 UTC):

```
{"statusCode":429,"description":"Your account has been blocked after multiple consecutive login attempts.
 We've sent you an email with instructions on how to unblock it.","name":"AnomalyDetected",
 "code":"too_many_attempts"}
```

- https://github.com/evcc-io/evcc/issues/10500

Note the shape: `name: "AnomalyDetected"` with `code: "too_many_attempts"`. This is Auth0 attack protection.
Auth0 responds to a high rate of failed logins from an IP with HTTP 429, and its bot-detection feature
escalates to a **CAPTCHA challenge** based on statistical traffic-burst and IP-reputation signals rather than a
fixed published threshold.

- https://auth0.com/docs/secure/attack-protection/suspicious-ip-throttling
- https://auth0.com/docs/secure/attack-protection/bot-detection

This is exactly the wall `api/porsche/login.js` already hits: it detects
`errorContext?.screen?.captcha?.image` in the Auth0 ACUL payload and surfaces the image for the user to solve
by hand. `pyporscheconnectapi` has the same failure as `PorscheCaptchaRequiredError` — see issues #44, #70,
#32 and the still-unanswered #43 below.

**Corroboration from owners, independent of any third-party client:** a Taycan owner reported receiving a
Porsche email about their account being *temporarily blocked for repeated entry attempts*, after which they
could only drive as a guest — the block is on the **Porsche ID account**, not merely on an API token, and it
degrades the in-car experience too.

- https://www.taycanforum.com/forum/threads/unable-to-leave-private-mode-and-log-in-to-my-account.36620/

**Inference, high confidence:** two rules follow directly.

- A failed login must **never** be retried automatically in a loop. `evcc` went from working to hard-blocked in
  six minutes of retries. Given our recovery cost is a hand-solved captcha, one attempt then stop-and-ask is
  the only safe policy.
- Because the measured budget lives on `/oauth/token`, **token refresh cadence matters more than poll
  cadence**. `api/porsche/refresh.js` refreshes against `identity.porsche.com/oauth/token`; at a typical
  access-token TTL this is ~24–48 calls/day, which is trivially inside a 1500 budget — but a refresh storm
  (e.g. refreshing per request, or retrying a failing refresh) is the one thing that could plausibly consume
  it.

### 5. What other clients actually use — the strongest available evidence

**Confidence: high** (this is read directly from source, not from claims).

| Client | Default interval | Requests/day | Notes |
|---|---|---|---|
| `CJNE/ha-porscheconnect` (Home Assistant, the reference consumer) | **1920 s = 32 min** | ~45 | `DEFAULT_SCAN_INTERVAL = 1920`, used as `timedelta(seconds=…)` for the `DataUpdateCoordinator`; user-overridable. Calls `get_stored_overview()` only. |
| `evcc-io/evcc` | **15 min** while charging; **60 min** idle | ~24–96 | `vehicle/config.go`: `interval = 15 * time.Minute // refresh interval when charging`. `evcc.dist.yaml`: `soc.poll.mode: charging`, `interval: 60m`. |
| `kmetabg/porsche-ev-shelly-connector` | **10 min** (`REFRESH_INTERVAL_MINUTES=10`) | ~144 | Self-hosted poller, explicitly runs `PORSCHE_OVERVIEW_MODE=stored`. |
| `CJNE/pyporscheconnectapi` (the library itself) | no interval; `TIMEOUT = 90` | — | Imposes no cadence; no retry, no backoff, no 429 handling. |

- https://github.com/CJNE/ha-porscheconnect/blob/main/custom_components/porscheconnect/const.py
- https://github.com/CJNE/ha-porscheconnect/blob/main/custom_components/porscheconnect/__init__.py
- https://github.com/evcc-io/evcc/blob/master/vehicle/config.go
- https://github.com/evcc-io/evcc/blob/master/evcc.dist.yaml
- https://github.com/kmetabg/porsche-ev-shelly-connector
- https://github.com/CJNE/pyporscheconnectapi/blob/master/pyporscheconnectapi/const.py

`evcc` ships an explicit warning against tightening these:

> "Modifying the default settings it NOT recommended. It MAY deplete your vehicle's battery or lead to vehicle
> manufacturer banning you from API use. USE AT YOUR OWN RISK."

**Inference, high confidence:** our proposed 96/day at 15 minutes sits inside the envelope that three
independent projects run in production, and is roughly 2× the cadence of the most widely deployed one
(ha-porscheconnect at 32 min) and 1.5× *slower* than the Shelly connector at 10 min. It is not an outlier.

### 6. Stored reads vs. wake-up reads are materially different, and we are on the safe side

**Confidence: high.**

`pyporscheconnectapi` distinguishes two shapes of the same endpoint:

- `get_stored_overview()` → `GET /connect/v1/vehicles/{vin}?mf=...` — returns last-reported telemetry.
- `get_current_overview()` → same URL **plus `&wakeUpJob=<uuid4>`** — commands the car awake for fresh data.

Our `api/porsche/vehicle/[vin]/overview.js` sends **no** `wakeUpJob` parameter, so we are doing stored reads —
the same mode ha-porscheconnect polls on, and the mode the Shelly connector deliberately pins with
`PORSCHE_OVERVIEW_MODE=stored`.

This matters beyond rate limits: repeated wake-ups are a documented 12V-drain hazard on Connect-equipped
Porsches, and Porsche has issued service documentation on Connect-related 12V discharge.

- https://github.com/CJNE/pyporscheconnectapi/blob/master/pyporscheconnectapi/vehicle.py
- https://static.nhtsa.gov/odi/tsbs/2021/MC-10187799-0001.pdf

**Recommendation:** treat the absence of `wakeUpJob` as a load-bearing invariant of the poller, worth a comment
in the code. If a "refresh now" button is ever added that uses `wakeUpJob`, it must be user-initiated only,
rate-limited locally, and never on the background schedule.

### 7. Error shape for a backoff implementation

**Confidence: high** on the status codes; **low** on `Retry-After` (see below).

`pyporscheconnectapi/exceptions.py` maps the status codes the community has observed from this API, which is
the best available catalogue of its error surface:

```
400 BAD_REQUEST          401 UNAUTHORIZED        404 NOT_FOUND
405 MOBILE_ACCESS_DISABLED                       408 VEHICLE_UNAVAILABLE
423 ACCOUNT_LOCKED       429 TOO_MANY_REQUESTS   500 SERVER_ERROR
503 SERVICE_MAINTENANCE  504 UPSTREAM_TIMEOUT
```

- https://github.com/CJNE/pyporscheconnectapi/blob/master/pyporscheconnectapi/exceptions.py

Three codes deserve distinct handling, and **`423 ACCOUNT_LOCKED` is the one to watch** — its presence in this
list is direct evidence that account locking is a live failure mode on this API, and it is the code that maps
to "captcha recovery needed".

For reference, `504 Gateway Time-out` is common enough on this API to have its own open issue (#61), so a
poller must not treat 5xx as exceptional.

- https://github.com/CJNE/pyporscheconnectapi/issues/61

---

## What I could NOT establish

State these as open, not as resolved:

| Question | Status |
|---|---|
| The numeric request ceiling on `api.ppa.porsche.com` | **Unknown.** No headers, no docs, no community-derived figure. |
| Whether a data-path `429` carries `Retry-After` | **Unknown.** No captured trace I found includes the response headers of a 429 from this host — `httpx.HTTPStatusError` tracebacks discard them. Treat the header as *possibly present*: read it if there, fall back to a fixed schedule if not. |
| Whether limits are per-token, per-VIN, per-IP, or per-`x-client-id` | **Unknown.** We spoof the mobile app's `x-client-id` (`09fcb5d8-…`), so any per-client-id bucket would be shared with every real My Porsche app user, which would make it far too coarse to be the binding constraint — but this is inference, not fact. |
| Whether sustained *reading* can cause token revocation | **No evidence found, in either direction.** Every revocation/captcha report I found traces to the login flow. Absence of evidence is not evidence of absence, but nothing suggests reads revoke tokens. |
| A principled lower bound on the poll interval | **Not establishable from sources.** 10 min is demonstrably survivable (Shelly connector). Below that, nobody has published data. |
| The window length behind `X-Ratelimit-Limit: 1500` | **Unknown.** One sample, `Reset` one second out. |
| Whether the community ever answered this exact question | **No.** `pyporscheconnectapi` issue #43 asks precisely this — *"What times between requests did you figure out, without getting 'banned' from Porsche side with captcha?"* — and was closed without an answer, as a side effect of an unrelated API retirement. Worth knowing that the question is genuinely open upstream, not merely unsearched. https://github.com/CJNE/pyporscheconnectapi/issues/43 |

---

## Recommendations for the poller

Derived from the above; the reasoning is inference, the inputs are cited facts.

1. **Keep 15 minutes as the default.** It is inside the envelope of three production clients. Do not go below
   10 minutes without new evidence — that is the floor anyone has demonstrated.
2. **Never auto-retry a failed login.** One attempt, then surface the captcha and stop. This is the single
   highest-value rule here: `evcc` proved a retry loop can produce a hard account block in six minutes
   (#10500), and our recovery cost is a human solving a captcha.
3. **Treat auth errors and read errors as separate circuits.** `401` on a read → refresh once, retry once
   (what `src/services/porscheConnect.js` already does). `401` after a refresh, or `403 AnomalyDetected`, or
   `423` → stop the poller entirely and require user action. Do not let a read failure cascade into repeated
   auth attempts.
4. **Back off on `429` rather than retrying blindly.** Honour `Retry-After` if present; otherwise exponential
   backoff from ~60 s with jitter, capped at a few multiples of the poll interval, and skip the missed tick
   instead of catching up. Per the maintainer's note in #63, a short wait plus one or two retries usually
   clears it — but keep the retry count small, because we cannot see our remaining budget.
5. **Treat `5xx` (especially `504`) as ordinary, not exceptional.** Log, skip the tick, continue on schedule.
   Do not escalate to a re-login.
6. **Never issue concurrent requests for the same VIN, and stagger startup.** The one read-path 429 on record
   came from a startup burst, not a steady cadence. If a poll cycle needs both overview and trips, serialise
   them with a short gap.
7. **Poll trips far less often than overview.** Trip history is a second full request to the same endpoint.
   Trip statistics change only after a drive; hourly or on-mileage-change is ample, and halving the per-cycle
   request count is free margin.
8. **Guard the refresh path.** The only budget we can actually see is on `/oauth/token`. Refresh on expiry with
   a safety buffer (`_utils.js` already uses 60 s), never per request, and never in a loop.
9. **Add local observability before tightening the interval.** Log response status counts and any
   `X-Ratelimit-*` / `Retry-After` headers the API returns. Two headers captured from a real 429 would close
   the biggest open question in the table above, and would let a future change to the interval be evidence-led
   rather than a guess.

## Sources

- https://github.com/CJNE/pyporscheconnectapi/issues/63 — 429 on both `/commands` and `get_stored_overview`; maintainer's view that it is transient; still open, no backoff implemented
- https://github.com/CJNE/pyporscheconnectapi/issues/74 — captured `X-Ratelimit-*` headers on `identity.porsche.com`, absent on `api.ppa.porsche.com`
- https://github.com/CJNE/pyporscheconnectapi/issues/43 — the same question asked upstream, closed unanswered
- https://github.com/CJNE/pyporscheconnectapi/issues/61 — routine `504`s
- https://github.com/CJNE/pyporscheconnectapi/issues/44 — captcha blocking integration setup
- https://github.com/CJNE/pyporscheconnectapi/blob/master/pyporscheconnectapi/exceptions.py — observed status-code catalogue incl. `423 ACCOUNT_LOCKED`
- https://github.com/CJNE/pyporscheconnectapi/blob/master/pyporscheconnectapi/connection.py — no retry/backoff/429 handling; `TIMEOUT = 90`
- https://github.com/CJNE/pyporscheconnectapi/blob/master/pyporscheconnectapi/vehicle.py — `get_stored_overview` vs `get_current_overview` (`wakeUpJob`)
- https://github.com/CJNE/ha-porscheconnect/blob/main/custom_components/porscheconnect/const.py — `DEFAULT_SCAN_INTERVAL = 1920`
- https://github.com/CJNE/ha-porscheconnect/blob/main/custom_components/porscheconnect/__init__.py — coordinator uses stored overview
- https://github.com/evcc-io/evcc/issues/10500 — Porsche account blocked; `AnomalyDetected` / `too_many_attempts` bodies quoted
- https://github.com/evcc-io/evcc/blob/master/vehicle/config.go — `interval = 15 * time.Minute`
- https://github.com/evcc-io/evcc/blob/master/evcc.dist.yaml — `poll.interval: 60m`, manufacturer-ban warning
- https://github.com/kmetabg/porsche-ev-shelly-connector — 10-minute default, `stored` overview mode
- https://auth0.com/docs/troubleshoot/customer-support/operational-policies/rate-limit-policy — `X-RateLimit-*` header semantics
- https://auth0.com/docs/secure/attack-protection/suspicious-ip-throttling — 429 on high failed-login rates
- https://auth0.com/docs/secure/attack-protection/bot-detection — CAPTCHA escalation on burst/IP-reputation signals
- https://developer.porsche.com/faq — no published limits; does not cover the consumer app API
- https://www.taycanforum.com/forum/threads/unable-to-leave-private-mode-and-log-in-to-my-account.36620/ — owner report of Porsche ID account block after repeated attempts
- https://static.nhtsa.gov/odi/tsbs/2021/MC-10187799-0001.pdf — Porsche service documentation on Connect-related 12V discharge

## Local files referenced

- `/Users/jeroen/Git/porsche_ev_insights/api/porsche/_utils.js` — `porscheApiRequest`; no 429 or `Retry-After` handling; 60 s token-expiry buffer
- `/Users/jeroen/Git/porsche_ev_insights/api/porsche/vehicle/[vin]/overview.js` — combined `mf=` read, no `wakeUpJob`
- `/Users/jeroen/Git/porsche_ev_insights/api/porsche/vehicle/[vin]/trips.js` — second request to the same endpoint
- `/Users/jeroen/Git/porsche_ev_insights/api/porsche/refresh.js` — `POST identity.porsche.com/oauth/token`, the metered path
- `/Users/jeroen/Git/porsche_ev_insights/api/porsche/login.js` — Auth0 ACUL captcha surfacing (`errorContext?.screen?.captcha?.image`)
- `/Users/jeroen/Git/porsche_ev_insights/src/services/porscheConnect.js` — `apiRequest`: refresh-once-retry-once on 401; no 429 branch
