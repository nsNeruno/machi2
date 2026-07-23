# Local development

How to get the project running on your machine and work on it day to day. Production
deployment is a separate concern — see `INFRASTRUCTURE.md`. Architecture rationale is in
`ARCHITECTURE.md`; what to build in what order is in `ROADMAP.md`.

M0 in `ROADMAP.md` establishes the workspace and the commands in this guide. Follow the
roadmap from the first unchecked milestone for subsequent work.

---

## 1. Prerequisites

| Tool             | Version               | Why                                                    |
| ---------------- | --------------------- | ------------------------------------------------------ |
| Node.js          | 22 LTS (or newer LTS) | Runtime for the API and the Vite dev server            |
| pnpm             | 9+                    | Workspace/monorepo package manager                     |
| Docker + Compose | current               | Runs Postgres locally (and the throwaway DB for tests) |
| Git              | any recent            | Version control                                        |

You do **not** need a local Postgres install — it runs in Docker. Corepack can manage
pnpm (`corepack enable`), or install it directly.

---

## 2. First-time setup

### Quick start — `./dev.sh`

One command boots the whole local stack. From the repo root:

```bash
./dev.sh
```

It checks prerequisites (Node, pnpm, Docker), creates `.env` from `.env.example` if
missing, runs `pnpm install` on the first run, verifies the API/web ports are free
(read from `.env`, so a clash fails fast with instructions), starts Postgres and waits
for it, applies migrations, seeds dev data, then runs the API + web dev servers together.
When both are ready it prints the URLs and **opens the web app in your default browser**
(handy since dev-server logs otherwise scroll the URL out of view). It stays in the
foreground; **Ctrl-C shuts everything down** — the dev servers and the Postgres container.

| Flag | Effect |
| ---- | ------ |
| `--reset` | wipe the local DB first (drop → migrate → seed) |
| `--no-seed` | boot without (re)seeding |
| `--keep-db` | leave the Postgres container running on Ctrl-C |
| `--no-open` | don't open the browser when ready |
| `--help` | usage |

Run it in the **foreground** (not `./dev.sh &`) — backgrounding makes the OS mark SIGINT
un-trappable, so the Ctrl-C cleanup won't fire.

### Manual setup

The same steps by hand, if you'd rather run them individually:

```bash
git clone <repo-url> machi2 && cd machi2
pnpm install                      # installs all workspaces

cp .env.example .env              # dev secrets (safe placeholder values)
docker compose up -d postgres     # start only the database
pnpm db:migrate                   # apply Drizzle migrations
pnpm db:seed                      # M0 baseline; M1 adds locations and games

pnpm dev                          # runs api + web together
```

Then open the web app (Vite prints the URL, typically `http://localhost:5173`). The API
is on `http://localhost:3000`, and the web dev server proxies `/api/*` to it, so the app
talks to `/api` on its own origin exactly like production.

Check the API alone: `curl http://localhost:3000/api/health` → `{"status":"ok"}` once the
DB is reachable.

### Local queue walkthrough

The local prototype now exposes the public queue workflow at `http://localhost:5173`:

1. Open **Machi Arcade**, then choose a seeded game.
2. On a new device profile, create the required local name card in the first-run sheet.
3. Join the queue, then use the **I'm up** control on your own first ticket to mark the turn played. Other actions open the reason picker.
4. The board and game list update through SSE; the connection banner reports live, reconnecting, or offline state.

The M5 public UI includes device-local name cards and preferences, four board layouts,
the `up next`/`as added` order switch, card drag-to-join, completion reason/PIN handling,
and the PWA install affordance. `GET /api/games/:id/stream` drives board cache updates;
`GET /api/locations/:slug/stream` keeps game-list waiting counts current.

---

## 3. Project layout

Full detail in `ARCHITECTURE.md`; the short version:

```
apps/
  api/          NestJS + Fastify service (port 3000)
  web/          React + Vite SPA (public board + /admin), one bundle
packages/
  shared/       Zod schemas + shared types (name rules, DTOs, enums)
docker-compose.yml    caddy + api + postgres (production shape)
```

`packages/shared` is imported by both `api` and `web` — the name validation (`nameSchema`)
and request/response types live there so the two sides can't drift.

---

## 4. Environment variables (dev)

`.env.example` is committed with working placeholder values; copy it to `.env`. Nothing
here is a real secret — production values are set on the host (`INFRASTRUCTURE.md`).

```bash
# database
DATABASE_URL=postgres://arcade:arcade@localhost:5432/arcade

# secrets (dev-only placeholders; regenerate for prod)
DEVICE_TOKEN_SECRET=dev-device-secret-change-me
SESSION_SECRET=dev-session-secret-change-me
IP_HASH_SALT=dev-salt-change-me

# runtime
NODE_ENV=development
TRUST_PROXY=0            # 0 in dev (no proxy in front); 1 behind Caddy/Render/Railway
PORT=3000
REJOIN_COOLDOWN_SECONDS=30  # manual re-join cooldown; 409 rejoin_cooldown, 0 disables

# enqueue rate limits (defaults match CLAUDE.md §6 — the production posture)
ENQUEUE_IP_LIMIT=3          # transport tier: joins per window per IP
ENQUEUE_IP_TTL_SECONDS=60   # window for the per-IP tier
ENQUEUE_DEVICE_LIMIT=1      # domain tier: joins per window per device token
ENQUEUE_DEVICE_TTL_SECONDS=5 # window for the per-device tier
```

`TRUST_PROXY=0` locally matters: with no proxy in front, the throttler should read the
real socket IP. In production it's `1` so `X-Forwarded-For` is honored (see
`INFRASTRUCTURE.md` §12 — getting this wrong silently breaks rate limiting).

**Enqueue limits vs. localhost testing.** Two independent guards protect the join
endpoint and both surface as HTTP 429 with `code: "rate_limited"`:

- the **transport tier** (`ENQUEUE_IP_LIMIT` / `ENQUEUE_IP_TTL_SECONDS`) — per IP, in
  `@nestjs/throttler`; a 429 with no body code is stamped `rate_limited` by
  `ProblemExceptionFilter`.
- the **domain tier** (`ENQUEUE_DEVICE_LIMIT` / `ENQUEUE_DEVICE_TTL_SECONDS`) — per
  device token, enforced in `SimpleFifoStrategy.enqueue`.

On localhost every request shares one IP, so the default `3 / 60s` per-IP tier is
exhausted after three joins in a minute and every later join returns `rate_limited` for
the rest of that window — even a single name re-joining a few times. The committed dev
`.env` therefore loosens `ENQUEUE_IP_LIMIT` (and tightens the device window) so iterative
testing isn't throttled; production keeps the §6 defaults.

Separately, a **manual re-join cooldown** (`REJOIN_COOLDOWN_SECONDS`, default 30s; `0`
disables) blocks the same device from re-joining a game within N seconds of being marked
done there that day. It's enforced in the domain service, returns HTTP **409
`rejoin_cooldown`** — a *different* code and status from the 429 `rate_limited` tiers
above — and auto re-queue is exempt. So when a name re-joins too fast you'll see
`rejoin_cooldown` (waited < 30s after "done") or `rate_limited` (hit an enqueue tier),
depending on which guard trips first.

Public queue requests carry `X-Device-Token` (a client-generated UUID). The first valid
request receives an `X-Device-Proof` response header; send it on later requests with the
same token. The server HMAC-verifies the proof and never exposes the stored token hash.

---

## 5. Scripts

For day-to-day work, `./dev.sh` (§2) wraps the boot sequence into one command. The
individual scripts below are still available when you want to run a single step. Run them
from the repo root; pnpm forwards to the right workspace.

| Command                         | Does                                                         |
| ------------------------------- | ------------------------------------------------------------ |
| `pnpm dev`                      | api + web together with hot reload                           |
| `pnpm dev:api` / `pnpm dev:web` | one side only                                                |
| `pnpm build`                    | production build of all workspaces                           |
| `pnpm test`                     | unit tests (Vitest) across workspaces                        |
| `pnpm test:api`                 | api tests incl. integration (Supertest + throwaway Postgres) |
| `pnpm typecheck`                | `tsc --noEmit` everywhere; `strict` is on                    |
| `pnpm lint` / `pnpm format`     | ESLint / Prettier                                            |
| `pnpm db:generate`              | generate a migration from schema changes                     |
| `pnpm db:migrate`               | apply pending migrations                                     |
| `pnpm db:seed`                  | load the current milestone's dev seed data                   |
| `pnpm db:reset`                 | drop, re-migrate, re-seed (local only)                       |

---

## 6. Database workflow

Drizzle ORM with drizzle-kit for migrations. The loop when you change the schema:

1. Edit the schema in `apps/api/src/db/`.
2. `pnpm db:generate` — writes a new SQL migration; commit it.
3. `pnpm db:migrate` — applies it to your local DB.

Rules that keep dev and prod honest:

- **Never** run `drizzle-kit push` against anything but a throwaway local DB — migrations
  are the source of truth and every schema change gets a committed migration file.
- The daily-reset behavior is **not** a scheduled job — it's derived from `service_date`
  per location timezone (`ARCHITECTURE.md` §7). To exercise a day rollover locally, seed
  entries with a `service_date` of "yesterday" for a given location's timezone, or set a
  location's timezone to one where midnight is imminent, rather than waiting.
- `pnpm db:reset` wipes local data — never point it at a shared database.

Inspect the DB directly with any Postgres client at the `DATABASE_URL` above, or
`docker compose exec postgres psql -U arcade arcade`.

---

## 7. Testing

Vitest for units, Supertest for API integration against a **real, throwaway Postgres** (a
disposable container, not mocks — the timezone and ordering logic must be tested against
actual Postgres). The suites that matter most (also listed in `CLAUDE.md` §9):

- Service-date computation across timezones, including a DST zone and `Asia/Jakarta`.
- Day rollover: an entry created at 23:59 local isn't visible at 00:01 local.
- Throttle tiers reject at the boundary (and the tighter open-board cap on others' entries).
- Idempotency-Key replay returns the original entry, no duplicate row.
- FIFO ordering + ticket allocation under concurrent enqueue.
- Auto re-queue fires only on `played`, inherits the flag, respects max length.
- Name validation: grapheme counting, CJK allowed, emoji/control rejected, 8-char cap.

```bash
pnpm test              # everything
pnpm test:api --watch  # iterate on API tests
```

Integration tests spin the throwaway DB up and down themselves; you don't need to manage
it. If they can't find Docker, start Docker Desktop first.

---

## 8. Day-to-day notes

- **SSE in dev:** `GET /api/games/:id/stream` emits `connected`, `queue-updated`,
  `day-rollover`, and 25-second `heartbeat` events. The Vite proxy must not buffer the
  response, or live updates won't arrive locally even though the code is correct. If the
  board goes quiet, suspect proxy buffering before the backend.
- **PWA install:** Production builds emit `manifest.webmanifest`, `sw.js`, and an
  app-shell-only precache. Test with `pnpm build` followed by a local static server or a
  deployed HTTPS origin: Android Chrome should offer the header install button after the
  browser's install event; on iOS Safari use Share → Add to Home Screen and confirm the
  standalone app opens the public shell. `/api/*` must remain network-only.
- **Ports:** api `3000`, web `5173`, postgres `5432`. Override via `.env` / Vite config if
  they clash.
- **CORS:** none needed — web proxies to the same origin. If you ever hit a CORS error in
  dev, you've bypassed the proxy and are calling `:3000` directly; go through the proxy.
- **Seed accounts:** `pnpm db:seed` creates the superadmin from `ADMIN_SEED_EMAIL` /
  `ADMIN_SEED_PASSWORD` (defaults `admin@example.com` / `change-me-please`) and prints the
  credentials. The API also self-bootstraps that superadmin on first boot if none exists,
  so `./dev.sh --no-seed` still leaves you able to log in at `/admin`. Change the values
  before any non-local use.
- **Shared types:** after editing `packages/shared`, both sides pick it up on the next
  reload; if types look stale, restart `pnpm dev`.

---

## 9. Working with Claude Code

This repo is written to be built with Claude Code. Point it at the repo and it will read
`CLAUDE.md` first — the working agreement, stack, and non-negotiables. Start at the
first unchecked milestone in `ROADMAP.md` and work top to bottom. The other
docs are the detail Claude Code pulls in as needed: `ARCHITECTURE.md` for the why and the
data model, `UI_DESIGN.md` for routes/screens/interactions (and it reads the
`frontend-design` skill before building UI), and this file for how to run what it builds.

---

## 10. Troubleshooting

| Symptom                                     | Likely cause                                                |
| ------------------------------------------- | ----------------------------------------------------------- |
| `pnpm db:migrate` can't connect             | Postgres container not up — `docker compose up -d postgres` |
| API 500s on every request                   | DB not migrated, or wrong `DATABASE_URL`                    |
| Board doesn't update live                   | Proxy buffering the SSE stream (§8)                         |
| Rate limiting seems to hit everyone at once | `TRUST_PROXY` misset, or you're behind an unexpected proxy  |
| `rate_limited` too soon while testing joins | Per-IP enqueue tier — all localhost is one IP; raise `ENQUEUE_IP_LIMIT` (§4) |
| Integration tests hang or fail to start     | Docker not running                                          |
| Types out of sync after editing `shared`    | Restart `pnpm dev`                                          |
| Port already in use                         | Another process on 3000/5173/5432 — stop it or override     |
