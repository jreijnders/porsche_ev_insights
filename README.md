<h1 align="center">Porsche EV Insights — rittenregistratie fork</h1>

<p align="center">
  <strong>A self-hosted Dutch business-mileage ledger for a Porsche Taycan, built on top of
  <a href="https://github.com/jpleite/porsche_ev_insights">jpleite/porsche_ev_insights</a>.</strong>
</p>

---

## Read this first: how this fork differs

Upstream is a **privacy-first, browser-only dashboard**. You export CSVs from the My Porsche
app, drop them into a web page, and nothing ever leaves your device. That promise is the
headline feature of the original project.

**This fork breaks that promise on purpose.** It is not a dashboard you visit; it is a service
you run. To keep a mileage ledger that is complete without you remembering to export anything,
it needs to:

- run a **server** continuously, not a page you open;
- hold a **Porsche Connect refresh token** server-side, so it can poll while you are not looking;
- store a **location history** — where the car was, and when — in a database on your machine.

None of that is compatible with "everything runs in your browser". The trade was made knowingly:
a mileage log that only records the trips you remembered to export is not a mileage log. If you
want the original privacy properties, use [upstream](https://github.com/jpleite/porsche_ev_insights)
— it is still excellent at what it does.

**This fork cannot be merged back upstream.** Dropping CSV import as a data source also removes
the only path the Audi e-tron GT had, since that integration is ZIP-import-only with no API.

## What it does

Keeps a **rittenregistratie**: one row per journey, with start and end time, named start and end
place, distance, a business/private classification, a flag for what goes on the monthly figure,
and a per-row *checked* state. Trips come from the Porsche Connect API; place names come from a
15-minute position poll matched against a place book you build yourself.

It produces a monthly **invoiceable-kilometre total** — kilometres only. What a kilometre is
worth, and what it is billed on, is decided outside this app.

Two guarantees the design is built around:

- **Nothing unverified counts.** A trip only reaches the monthly figure once you have checked it.
- **Completeness is measured, not assumed.** Odometer readings are reconciled against logged
  trips, so a missing trip shows up as a number rather than as silence.

## Requirements

- Docker and Docker Compose
- A Porsche Connect account with the vehicle paired
- A private network. **There is no authentication.** See [Exposure](#exposure).

## Quick start

```bash
cp .env.example .env
$EDITOR .env          # POSTGRES_PASSWORD is required; there is no default
docker compose up -d
```

The dashboard is then on `http://localhost:3001` (or whatever `APP_PORT` you set). Migrations
are applied automatically on boot, and `/api/health` reports whether the database is reachable.

Log in to Porsche Connect through the UI, not through `.env` — the login involves a captcha you
have to solve by hand. The resulting refresh token is stored in Postgres, and refresh happens
just-in-time behind a single-flight lock. A rejected grant is never retried automatically:
the one documented case of an account being blocked came from a login retry loop.

Optionally run `scripts/provision-google-maps-key.sh` to set up place suggestions. Without a key
the app runs fine — you just name places yourself instead of picking them from a list.

## Exposure

Keep this on your LAN or VPN. Behind that single port sit your Porsche refresh token and a
full history of where the car has been, with **no login in front of them**. Postgres is
deliberately bound to `127.0.0.1` and is not reachable from the network at all.

The `pgdata` volume holds the ledger, the place book *and* the refresh token, which makes host
backup the single point of failure. If your host backup is snapshot-based (ZFS/btrfs/LVM) a
snapshot restores cleanly; a plain `rsync` or `tar` of a live Postgres directory can produce a
copy that will not restore. Add a scheduled `pg_dump` if that is your setup.

## How it works

One Fastify process serves the built SPA, the API, and runs the poll schedule in-process,
against one Postgres database. That is the whole deployment.

| Piece | What it does |
|---|---|
| `server/porsche/` | The Auth0 PKCE login walk and the Connect API client |
| `server/poller/` | 15-minute poll: positions every cycle, trip history when the odometer says the car moved |
| `server/routes/` | The ledger API and the Porsche endpoints the dashboard calls |
| `db/schema.ts` | Drizzle schema; migrations are committed and applied on boot |
| `src/` | React 19 + Vite + Tailwind — the original dashboard tabs, plus the trip ledger at `/trips` |

The Porsche API's trip history is authoritative for time and distance. The position poll is
**only** a place harvester — it never produces a distance figure.

## Development

```bash
npm install
npm run dev:full     # Postgres in Docker, Fastify + Vite with proxying
npm test             # Vitest
npm run typecheck
```

New code is TypeScript. The eight original analytics tabs are still JavaScript and are being
converted incrementally rather than in one sweep.

## Still inherited from upstream

Honest inventory of things that exist in the code but are **not** part of this fork's direction:

- **CSV / ZIP import and the upload modal still work.** They are no longer a supported data
  source — the API is the only one this fork develops against — but the code has not been
  removed yet.
- **Audi e-tron GT support** is likewise still present in the vehicle list and the ZIP importer,
  and will go when CSV import does.
- **The [wiki](https://github.com/jpleite/porsche_ev_insights/wiki) describes upstream**, not
  this fork. Its deployment and data-import pages do not apply here.

## Credits

Built on [porsche_ev_insights](https://github.com/jpleite/porsche_ev_insights) by
[jpleite](https://github.com/jpleite), whose Porsche Connect authentication work is the hardest
and most valuable part of this codebase. The dashboard tabs are theirs; the ledger, the server
and the database are not.

MIT License — for personal use only.
