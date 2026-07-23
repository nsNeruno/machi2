# Architecture

## Requirements this design answers

1. Live updates to queue state, SPA-shaped frontend.
2. Installable as a PWA on phones.
3. Programmatic throttling against queue manipulation.
4. Database on the same host as the server.

Requirement 4 is the quiet one that decides everything else. It rules out _most_
serverless platforms, because those pair naturally with a _remote_ managed database and
are hostile to long-lived connections and in-process state. The primary deployment
(Railway) satisfies it in the practical sense — Postgres lives in the same project on
Railway's private network, one hop away, not a remote managed DBaaS with its own
lifecycle and connection semantics. The VPS-based fallbacks (Oracle, paid VPS) satisfy
it in the strict sense — one box, one Docker Compose file, one process tree, zero hops.
Both are documented; which one to use is a call made in [Deployment](#deployment) below.

There is exactly one serverless platform that satisfies requirement 4 more strictly than
either — Cloudflare Durable Objects, where storage lives in the same thread as the
compute. It's deliberately not used here; see [Deliberately not
doing](#deliberately-not-doing).

---

## Stack decision

**TypeScript / NestJS (Fastify) + React (Vite) + PostgreSQL.**

Why each piece:

**NestJS** — Two requirements point straight at it. `@nestjs/throttler` is a first-class,
per-route, per-key rate limiter, which is requirement 3 mostly solved out of the box.
And its DI container makes the future pluggable-queue-strategy seam a registry lookup
instead of a refactor. The structure it imposes is also a real asset when an agent is
writing most of the code: modules, providers, and guards are predictable places for
things to go.

**Fastify adapter over Express** — lower overhead per request and better behaviour
holding many idle SSE connections.

**React + Vite** — requirement 1 wants an SPA and requirement 2 wants a PWA.
`vite-plugin-pwa` wraps Workbox and generates the manifest + service worker with about
fifteen lines of config. This is the shortest path from "SPA" to "installable" that
exists. TanStack Query handles cache invalidation when SSE events arrive.

**PostgreSQL, not SQLite** — SQLite would genuinely work at this scale and is tempting.
Postgres wins on one specific thing that this app does constantly: timezone-aware date
math. `(now() AT TIME ZONE loc.timezone)::date` is a correct, indexable expression with
a real IANA timezone database behind it. SQLite has no native timezone support and you
end up doing it in application code on every read. Postgres also handles concurrent
writes without a global write lock, which matters if a popular game center's queue gets
hammered. It's one extra container.

**SSE, not WebSockets** — the traffic is almost entirely one-directional: the server
pushes queue state, the client mutates via ordinary `POST`. SSE gives you automatic
reconnection with `Last-Event-ID` for free, sails through corporate proxies and mobile
carrier NAT, needs no separate auth handshake, and is trivial to rate-limit because it's
just HTTP. WebSockets would buy bidirectionality this app doesn't need, at the cost of a
second protocol to secure and throttle. Revisit only if a future queue concept needs
client→server streaming.

### Alternatives considered

- **Elixir + Phoenix** — honestly the theoretically best fit: ephemeral per-location
  queue state maps beautifully onto supervised processes, and PubSub is built in. Ruled
  out because LiveView pulls against the SPA/PWA preference, and the ecosystem is a
  harder environment to iterate in with an agent unless you already know Elixir.
- **Go + Chi/Echo** — excellent runtime characteristics, tiny memory footprint on a
  cheap VPS. Ruled out because you'd lose the shared-types-across-the-wire benefit and
  hand-roll more of the throttling and DI scaffolding.
- **Next.js full-stack** — the App Router's model fights long-lived SSE and
  co-located databases; you'd be swimming upstream against every deployment default.

---

## Data model

```sql
locations (
  id            uuid pk,
  slug          text unique,          -- URL-safe, e.g. "timezone-margocity"
  name          text,
  address       text null,
  timezone      text,                 -- IANA, e.g. 'Asia/Jakarta'
  is_active     boolean default true,
  staff_pin_hash text null,           -- argon2, set only when approval is required
  require_approval_for_others boolean default false, -- off = open board (UI_DESIGN §7.5)
  created_at    timestamptz
)

games (
  id             uuid pk,
  location_id    uuid fk -> locations,
  name           text,
  cabinet_label  text null,           -- "Cabinet 2", for centers with duplicates
  queue_strategy text default 'simple_fifo',
  board_mode     text default 'self_serve', -- 'self_serve' | 'now_playing' (UI_DESIGN §7.0)
  max_queue_len  int null,            -- null = unbounded
  is_active      boolean default true,
  sort_order     int default 0,
  community_note text null,           -- optional staff note shown on the board (UI_DESIGN §7.6)
  community_note_visible boolean default false,
  community_note_updated_at timestamptz null,
  community_note_updated_by uuid null -- admin_users.id
)

queue_entries (
  id            uuid pk,
  game_id       uuid fk -> games,
  location_id   uuid fk -> locations,  -- denormalized, avoids a join on every read
  service_date  date,                  -- computed at insert, location-local
  ticket_number int,                   -- monotonic per (game_id, service_date)
  display_name  text,
  status        text,                  -- 'waiting' | 'done'
  done_reason   text null,             -- 'played' | 'left' | 'skipped' | 'other'
  auto_requeue  boolean default false, -- re-join at back on 'played' completion (UI_DESIGN §7.4a)
  requeued_from uuid null,             -- prior entry this rejoin came from (UI_DESIGN §7.7)
  device_token_hash text,              -- the joiner/owner (created_by)
  done_by_token_hash text null,        -- acting device on completion; audit only, never sent to clients
  done_by_name  text null,             -- acting device's self-asserted active-card name; display only, never for authz
  done_by_role  text null,             -- 'self' | 'player' | 'staff' | 'admin' | 'system'
  ip_hash       text,                  -- salted, for abuse heuristics only
  idempotency_key text null,
  created_at    timestamptz,
  done_at       timestamptz null
)

idempotency_records (
  id            uuid pk,
  scope         text,                  -- e.g. enqueue:<game>:<service-date>
  key           text,                  -- Idempotency-Key request header
  response_json jsonb,                 -- original public response for exact replay
  created_at    timestamptz
)

admin_users (id, email, password_hash, role, created_at)
admin_location_grants (admin_user_id, location_id)   -- for role='operator'
```

Indexes that matter:

- `queue_entries (game_id, service_date, status, ticket_number)` — the hot read path.
- `queue_entries (game_id, service_date, idempotency_key) unique where idempotency_key is not null`
- `queue_entries (game_id, service_date, ticket_number) unique`
- Partial unique on one active entry per device:
  `(game_id, service_date, device_token_hash) unique where status = 'waiting'`
- `idempotency_records (scope, key) unique` — persists replays for both enqueue and done.

That last constraint enforces the anti-spam rule at the database level, which is the
only place it can't be raced around.

---

## API surface

Public:

```
GET  /api/locations                          list active locations
GET  /api/locations/:slug                    location + its games + per-game waitingCount
GET  /api/games/:id/queue?scope=recent|all   today's queue (recent=latest 10; default recent)
GET  /api/games/:id/stream                   SSE: queue-updated, day-rollover
POST /api/games/:id/queue                    enqueue { displayName, autoRequeue? }
POST /api/queue-entries/:id/done             { reason, actingName?, staffPin? }
```

Public writes require an `Idempotency-Key` and `X-Device-Token` UUID. The server returns
an HMAC-derived `X-Device-Proof`; clients send it with later requests using the same
token. The raw token and its HMAC hash are never returned in API bodies.

Public read DTOs carry UI-driven derived fields (see `UI_DESIGN.md` §9): each queue entry
includes `mine: boolean` (request device-token hash matches the entry's), `createdAt`,
`doneAt`, a derived `doneByRole` label, `doneByName` (self-asserted, display only) and
`roundNumber` for the meta line (§7.7), and the board payload includes `requireApprovalForOthers: boolean` (the per-location approval flag,
default false = open board), `boardMode` (`self_serve | now_playing`), and the visible
community note. Raw device-token hashes (`device_token_hash`, `done_by_token_hash`) are
never sent to clients, and the payload never reveals whether a staff PIN exists when
approval is off.

Admin (session-cookie guarded; authorized by role + grants):

```
POST   /api/admin/session                     login
DELETE /api/admin/session                     logout
GET    /api/admin/me                           current admin, role, granted location ids

CRUD   /api/admin/locations                    superadmin: create/delete; operator: edit granted
                                               (includes require_approval_for_others + staff PIN set)
CRUD   /api/admin/locations/:id/games          name, cabinet_label, board_mode, max_queue_len, active, sort_order
PUT    /api/admin/games/:id/community-note      { body, visible }

GET    /api/admin/locations/:id/queue          today's queue incl. done entries + actor meta
POST   /api/admin/queue-entries/:id/done        admin mark (done_by_role = admin)
DELETE /api/admin/queue-entries/:id             remove an entry added in error (hard delete)
POST   /api/admin/games/:id/queue/clear         empty this game's current-day queue (confirmed)

CRUD   /api/admin/users                         superadmin only: admin accounts + role
PUT    /api/admin/users/:id/grants              superadmin only: operator location grants
POST   /api/admin/users/:id/password            superadmin: reset; self: change own
```

Every admin endpoint checks the session role and, for operators, that the target location
is within their grants. The UI hides disallowed actions, but authorization is enforced
server-side regardless. See `UI_DESIGN.md` §8 for the screen-level spec.

## Realtime flow

1. Client opens `GET /api/games/:id/stream`.
2. `QueueEventsService` (a plain `EventEmitter`, in-process) fans out to subscribers
   keyed by game id.
3. Any mutation publishes after the transaction commits — never inside it.
4. Events carry the full current queue for that game. Queues are small (tens of
   entries), so sending diffs is premature optimization and a source of drift bugs.
5. A `heartbeat` SSE event every 25s keeps proxies from closing idle connections.

Single-process only, by design. If you ever run more than one API instance, replace the
`EventEmitter` with Postgres `LISTEN/NOTIFY` — same interface, no call-site changes. Do
not add Redis for this.

---

## Deployment shape

One stateless API process plus a Postgres database, fronted by Cloudflare. The frontend
is a static build served on the same origin as the API — no CORS config, no cross-site
cookie problems for the admin session.

Concrete topologies, configs, costs, and the migration plan live in
[Deployment](#deployment) below. **The primary target is Railway** (Hobby plan); Oracle
Cloud Always Free, Render, and a paid VPS are documented fallbacks.

### PWA notes

Cache the app shell and static assets. **Never** cache queue API responses in the
service worker — a stale queue is worse than a spinner. Offline state should be an
explicit "reconnecting…" banner, not silently served stale data.

---

# Deployment

Pricing and free-tier figures verified July 2026. These move constantly — Oracle
silently halved its ARM allowance in June 2026, Fly.io and Railway removed free
compute, Hetzner adjusted prices twice this year. Re-verify before committing.

**Decision (2026-07-23):** the primary target switched from Oracle Cloud Always Free to
Railway's Hobby plan ($5/mo minimum usage). Oracle's ARM capacity contention and
unannounced free-tier policy changes (see Phase 2a's "Risks, stated plainly") made a
predictable $5/mo floor preferable to a $0 target with real operational uncertainty.
Oracle, Render, and paid VPS remain fully documented fallbacks — the portability
contract below is what keeps switching back, or to any of them, a same-day operation.

## The plan

Start on the primary, stay portable, move when the pain is real — not before.

| Phase             | Where                               | Cost               | Move when                                                       |
| ----------------- | ------------------------------------ | ------------------- | ---------------------------------------------------------------- |
| **1. Now (primary)** | Railway, Hobby plan               | **$5/mo minimum usage** | —                                                             |
| **2a. Fallback**  | Oracle Cloud Always Free, Singapore | $0                  | You want to eliminate the monthly cost and accept ARM capacity/account-stability risk |
| **2b. Fallback**  | Render, Singapore                   | $13/mo fixed        | You want an SLA and predictable fixed billing                    |
| **3. Fallback**   | Paid VPS (Biznet Gio / DO / Vultr)  | $4–9/mo             | You want to stay self-hosted without free-tier or metered-billing risk |

Every phase runs **the same application code**. This is not four architectures; it is
one architecture with four landlords. Section [Portability
contract](#portability-contract) is what keeps that true — respect it and any migration
is an afternoon.

---

## Phase 1 — Railway (primary)

```
Browsers / PWA
      │
      ▼
Cloudflare (free: DNS, TLS pass-through, CDN, Bot Fight Mode)
      │
      ▼
Railway project (Hobby plan, $5/mo minimum usage)
  ├── api      → NestJS + SSE, serves the built SPA via @fastify/static
  └── postgres → Railway-managed Postgres service, private network, attached volume
```

Chosen over Oracle Always Free as the primary target despite the $5/mo floor: no ARM
capacity roulette, no dual-firewall trap, no unattended host patching, and deploys are a
`git push` instead of an SSH session. The trade-off, stated plainly: this does **not**
fully satisfy requirement 4 in the strictest sense — Postgres is a separate Railway
service reached over the project's private network, one hop away, not a process on the
literal same host the way Oracle's Docker Compose stack is. That's an accepted trade for
zero ops burden. If the same-host guarantee ever matters more than the convenience,
Phase 2a (Oracle) is the documented way back to it.

### Provisioning

- New Railway project, connected to the GitHub repo.
- Add a **Postgres** service (Railway's built-in plugin) to the project — it injects a
  `DATABASE_URL` reference variable the API service consumes directly, no manual
  connection-string assembly.
- Region: pick Singapore/Southeast Asia if offered for Hobby-tier services; Railway has
  shifted region availability between tiers before, so confirm at creation time rather
  than assuming — the goal is nearest available region to `Asia/Jakarta`, not a specific
  name.
- `numReplicas: 1` — matches the single-instance assumption behind the in-process
  `EventEmitter` realtime fan-out (see [Realtime flow](#realtime-flow)).

### `railway.json`

```json
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": {
    "builder": "NIXPACKS",
    "buildCommand": "pnpm install --frozen-lockfile && pnpm build"
  },
  "deploy": {
    "startCommand": "node apps/api/dist/main.js",
    "healthcheckPath": "/api/health",
    "healthcheckTimeout": 30,
    "restartPolicyType": "ON_FAILURE",
    "numReplicas": 1,
    "sleepApplication": false
  }
}
```

Railway has no free static hosting, so the built SPA is served from Fastify via
`@fastify/static` — one service, one origin, no CORS config, no cross-site cookie
problems for the admin session.

### Rates and realistic cost

Rates (cross-checked against railway.com/pricing, July 2026 — Railway bills per-second,
these are the per-second rates converted to a 30-day month for readability): ~$10/GB-month
RAM ($0.00000386/GB/sec), ~$20/vCPU-month ($0.00000772/vCPU/sec), ~$0.15/GB-month
volumes ($0.00000006/GB/sec), $0.05/GB egress for services (inbound free). Realistically
**~$7/mo** for this app's traffic level, which lands inside the Hobby floor most months.
The **Hobby** plan is "$5 minimum usage" — $5 of monthly credits included, but it's a
floor, not a true allowance: you're billed at least $5, and only pay more once usage
exceeds it. Volume storage on Hobby is capped at 5 GB — fine for this app's Postgres
data, but worth knowing going in. Railway's **Free** plan is no longer $0 indefinitely
either (a 30-day trial with $5 credit, then $1/month minimum) — one reason Hobby is the
sane starting point rather than trying to squeeze onto Free.

### Gotchas

- **`sleepApplication` must stay `false`.** App sleeping would kill every SSE
  connection and reintroduce cold starts — the exact failure mode ruled out in
  [Deliberately not doing](#deliberately-not-doing).
- **Set a hard spend cap on day one.** With metered billing, throttling stops being
  purely an abuse control and becomes a _billing_ control: a scraper hammering
  `POST /api/games/:id/queue` now shows up on the invoice. The tiers in `CLAUDE.md` §6
  become financial infrastructure. See [Cost and load
  self-governance](#cost-and-load-self-governance) — on this host the governor is the
  default configuration, not an optional upgrade.
- `trustProxy` is required in Fastify. Railway terminates TLS at its own edge; without
  reading `X-Forwarded-For`, `@nestjs/throttler` sees one client and rate-limits the
  entire userbase as a single bucket.
- Postgres here is a Railway service with a volume, not a managed DBaaS with
  point-in-time recovery included — backups are yours. See `INFRASTRUCTURE.md` §8.
- Confirm the Singapore region is actually available on Hobby before committing;
  Railway has shifted region availability between tiers before.

### Backups, monitoring, CI/CD

Full step-by-step is in `INFRASTRUCTURE.md` — that file is the primary runbook now, not
an appendix. Short version: `pg_dump` runs on a schedule against Railway's Postgres via
its connection string (a scheduled GitHub Actions workflow, not a host cron — there's no
VM to SSH into), pushed to Cloudflare R2 the same as every other target. Deploys are
git-push-to-branch; Railway builds and redeploys automatically, no GHCR/SSH step
required on this path (that machinery is kept for the fallbacks, which do need it).

---

## Portability contract

These rules are what make the migration plan credible. Treat them as invariants; if a
change would break one, it needs an explicit decision, not a silent commit.

1. **No provider-specific SDKs in application code.** Object storage is reached over
   S3-compatible HTTP with endpoint and credentials from env vars. No OCI SDK, no
   Render API calls, no Railway-specific imports.
2. **All configuration through environment variables.** No hardcoded hostnames, no
   config baked into images, no reading from paths that only exist on one host.
3. **All durable state lives in Postgres.** The app never writes to the local
   filesystem expecting persistence. Uploads, if they ever exist, go to object storage.
4. **The app is a single stateless process** plus a database. It must survive being
   killed and restarted at any moment with no data loss beyond in-flight requests.
5. **`GET /api/health`** returns 200 only when the database is reachable. Every
   platform here uses it, in a different way.
6. **Images are built in CI, never on the host**, for the self-hosted fallbacks
   (Oracle, paid VPS) — multi-arch (`linux/amd64` and `linux/arm64`) so the same tag
   runs on Ampere or an x86 VPS. Railway and Render build from source instead
   (Nixpacks/Buildpacks-style), which is fine — the multi-arch image is what's required
   to keep the self-hosted fallbacks a same-day swap, not something every host needs to
   consume.
7. **Realtime fan-out sits behind `QueueEventsService`.** Today it's an in-process
   `EventEmitter`, valid because every platform in this plan runs exactly one instance.
   If that ever changes, swap the implementation for Postgres `LISTEN/NOTIFY` — no
   call sites change. Do not add Redis.

---

## Migration triggers

Move when one of these is true. Not before — cost is not the only currency, and
migrating early spends attention you'd rather put into the product.

| Signal                                                                    | Go to                                      |
| --------------------------------------------------------------------------- | ------------------------------------------ |
| You want to eliminate the $5/mo floor entirely and accept ARM capacity/account risk | **Oracle Always Free**                     |
| Railway's metered bill grows uncomfortably (spike or sustained) despite the cost governor | **Render** (fixed $13/mo) or **paid VPS**  |
| You want a vendor SLA and predictable fixed billing                         | **Render**                                 |
| You want full self-hosted control, minus a free-tier account's risk         | **Paid VPS**                               |
| Sustained load exceeds one instance                                        | Render Pro / Railway Pro + `LISTEN/NOTIFY` |
| Migrated to Oracle and it then reclaims the instance, or capacity vanishes on resize | Back to **Railway**, or **Render**, or **paid VPS** |

---

## Phase 2a — Oracle Cloud Always Free ($0 fallback)

```
Browsers / PWA
      │
      ▼
Cloudflare (free: DNS, TLS, CDN, Bot Fight Mode)
      │
      ▼
One Ampere VM (ap-singapore-1, $0)
  └── docker compose
        ├── caddy      → TLS, serves SPA, proxies /api
        ├── api        → NestJS + SSE, :3000
        └── postgres   → local volume
```

This is the only option where **requirement 4 is fully satisfied**: Postgres is a
process on the same host, not a managed service one hop away. Pick this over Railway
when the $5/mo floor needs to become $0 and the ARM capacity / account-stability risks
below are acceptable. Full step-by-step is Appendix A in `INFRASTRUCTURE.md` (moved
there when Railway became primary; the steps themselves are unchanged).

### Provisioning

- Region **ap-singapore-1** (~25 ms from Jakarta, and it actually has ARM capacity;
  the US regions frequently do not).
- Shape `VM.Standard.A1.Flex`, **2 OCPU / 12 GB** — the current Always Free ceiling.
- Ubuntu 24.04 LTS, 50 GB boot volume (200 GB free across the account).
- Open only 80/443 in both the OCI security list _and_ `iptables`. Oracle's Ubuntu
  images ship with restrictive local rules that silently drop traffic even after you
  fix the cloud firewall — this catches nearly everyone once.
- Set a **$1 budget alert immediately**. If you ever upgrade to Pay-As-You-Go for
  easier provisioning, overage beyond the free allowance becomes billable.

### `docker-compose.yml`

```yaml
services:
  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports: ['80:80', '443:443']
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - ./web-dist:/srv:ro
      - caddy_data:/data
    depends_on: [api]

  api:
    image: ghcr.io/OWNER/machi2-api:${TAG:-latest}
    restart: unless-stopped
    environment:
      DATABASE_URL: postgres://arcade:${POSTGRES_PASSWORD}@postgres:5432/arcade
      NODE_ENV: production
      TRUST_PROXY: '1'
      DEVICE_TOKEN_SECRET: ${DEVICE_TOKEN_SECRET}
    depends_on:
      postgres: { condition: service_healthy }

  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: arcade
      POSTGRES_DB: arcade
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes: [pgdata:/var/lib/postgresql/data]
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U arcade']
      interval: 10s
      retries: 5

volumes:
  pgdata:
  caddy_data:
```

### `Caddyfile`

```
queue.example.com {
    encode zstd gzip

    handle /api/* {
        reverse_proxy api:3000 {
            flush_interval -1
        }
    }

    handle {
        root * /srv
        try_files {path} /index.html
        file_server
    }
}
```

`flush_interval -1` disables response buffering. **Without it, SSE silently breaks** —
Caddy buffers the event stream and clients see nothing until the connection closes. This
is the single most common way to ship a "working" build where live updates don't work.

### Build and deploy

- **Build for `linux/arm64`.** Ampere is ARM; GitHub Actions runners are x86. Use
  `docker/setup-qemu-action` plus `docker/build-push-action` with
  `platforms: linux/arm64`, or an ARM runner. An x86 image will build fine in CI and
  then refuse to start on the VM with an exec-format error.
- Push images to GHCR. **Never build on the VM** — 2 OCPU will crawl and you'll be
  building on the same box that's serving traffic.
- Deploy: GitHub Actions → SSH → `docker compose pull && docker compose up -d`.
- Rollback: pin `TAG` to the previous image and re-run. Keep the last 5 tags.

### Backups

Nightly `pg_dump` to Cloudflare R2 (10 GB free) or OCI Object Storage (20 GB free),
retained 14 days. Only `locations`, `games`, `admin_users`, and
`admin_location_grants` matter — queue data is disposable by definition, so a restore
that loses the current day's queue is an acceptable outcome. Test the restore once,
before you need it.

### Risks, stated plainly

- **ARM capacity errors.** Expect to retry the launch; scripted retry loops against the
  `LaunchInstance` API are a well-worn community workaround.
- **Silent policy changes.** June 2026's halving came with no announcement, no email,
  and inconsistent enforcement. Instances exceeding the new limit were stopped. Assume
  this recurs.
- **Idle reclamation.** Free instances judged idle may be reclaimed. Real traffic is
  fine; a dormant deployment may not be.
- **No SLA, no support.** You are not a customer.

The mitigation for all four is the same and is the reason Oracle stays a defensible
fallback rather than a reckless one: nothing here is Oracle-specific, so the blast
radius of losing the instance is one afternoon.

---

## Phase 2b — Render (fixed cost fallback)

Three services in the Singapore region: a static site for the SPA ($0), a Starter web
service for the API ($7/mo), and Basic-256mb Postgres ($6/mo). **$13/mo**, fixed. The
Hobby _workspace_ is $0 — the bill is compute.

`render.yaml` sketch (verify field names against the current Blueprint spec, which
changes):

```yaml
services:
  - type: web
    name: machi2-api
    runtime: node
    region: singapore
    plan: starter
    buildCommand: pnpm install --frozen-lockfile && pnpm --filter api build
    startCommand: node apps/api/dist/main.js
    healthCheckPath: /api/health
    buildFilter:
      paths: [apps/api/**, packages/shared/**, pnpm-lock.yaml]
    envVars:
      - key: DATABASE_URL
        fromDatabase: { name: machi2-db, property: connectionString }
      - key: TRUST_PROXY
        value: '1'
      - key: DEVICE_TOKEN_SECRET
        generateValue: true

  - type: web
    name: machi2-web
    runtime: static
    buildCommand: pnpm install --frozen-lockfile && pnpm --filter web build
    staticPublishPath: apps/web/dist
    buildFilter:
      paths: [apps/web/**, packages/shared/**]
    routes:
      - { type: rewrite, source: /api/*, destination: https://machi2-api.onrender.com/api/* }
      - { type: rewrite, source: /*, destination: /index.html }

databases:
  - name: machi2-db
    plan: basic-256mb
    region: singapore
    postgresMajorVersion: '16'
```

**Gotchas:**

- **Set `trustProxy` in Fastify.** Render terminates TLS at its proxy; without reading
  `X-Forwarded-For`, `@nestjs/throttler` sees one client and rate-limits your entire
  userbase as a single bucket. This silently defeats requirement 3.
- **Basic-256mb caps at 100 connections.** Set the Drizzle pool to ~10.
- **500 build-pipeline minutes/month** on Hobby, then $5/1K. The `buildFilter` blocks
  above are what keep a frontend commit from rebuilding the API.
- **Never use the Free instance type** — 15-minute spin-down kills every SSE connection,
  and Free Postgres is deleted 30 days after creation.
- No horizontal autoscaling on Hobby, so the single-instance assumption holds.
  Zero-downtime deploys briefly overlap two instances; clients on the old one miss
  events until they reconnect. Cosmetic, but document it.

---

## Phase 3 — Paid VPS

The `docker-compose.yml` and `Caddyfile` in the Oracle fallback (Phase 2a) deploy
**unchanged** here too — this is the lowest-friction way to stay fully self-hosted if
Railway's metered billing ever becomes unwelcome and Oracle's capacity risk isn't
acceptable either. It's a lateral move within the self-hosted family (Oracle ↔ paid
VPS), not a migration from Railway — moving off Railway to any fallback still means the
full [migration runbook](#migration-runbook) below (different deploy mechanics,
different Postgres setup).

| Provider             | Location  | Cost                    | Note                                             |
| -------------------- | --------- | ----------------------- | ------------------------------------------------ |
| Biznet Gio NEO Lite  | Jakarta   | from Rp 59,000/mo (~$4) | Best latency for Indonesian users                |
| DigitalOcean / Vultr | Singapore | ~$6/mo                  | Better tooling, USD billing                      |
| Hetzner              | Singapore | from ~€5.49/mo          | Cheapest per-spec; watch €7.40/TB egress overage |

### Biznet Gio (Indonesia-first pick)

The obvious choice when self-hosting is the goal and the userbase is Indonesian — a data
center inside the country beats Singapore on latency to `Asia/Jakarta` users, and it's
the cheapest option in the table.

**Sizing** (NEO Lite tier, standard SSD — verified against biznetgio.com/pricelist#neo-lite,
July 2026; re-check before committing, prices and promo codes rotate):

| Package | vCPU | RAM  | Storage | Price/mo             |
| ------- | ---- | ---- | ------- | --------------------- |
| XS 1.1  | 1    | 1 GB | 60 GB   | Rp59,000 (~$4)         |
| SS 2.2  | 2    | 2 GB | 60 GB   | Rp109,000 (~$7)        |
| MS 4.2  | 2    | 4 GB | 60 GB   | Rp139,000 (~$9)        |

**Avoid `XS 1.1` for a starter deploy** — it's tighter than it looks, and tighter than
Oracle's own `E2.1.Micro` stopgap (Appendix A.2a in `INFRASTRUCTURE.md`). That Oracle
fallback is *two* separate 1 GB VMs (Postgres on one, API + Caddy on the other); `XS 1.1`
would put all three containers on *one* 1 GB box via the same `docker compose` file.
Rough memory floor before a single user ever hits the site: Ubuntu 24.04 + Docker daemon
(~200-300 MB), Postgres 16 idle (~100-150 MB minimum with any usable `shared_buffers`),
the NestJS/Fastify process (~80-150 MB), Caddy (~20-40 MB) — 400-650 MB gone before
connection pooling, query execution, open SSE connection state, or the memory spike
during `docker compose pull`/first migration. The 2 GB swap file from Appendix A.4
(`INFRASTRUCTURE.md`) stops it from crashing outright, but Postgres swapping is a
latency cliff, not something to lean on for a deploy that's supposed to just work.

**`MS 4.2` (2 vCPU / 4 GB, ~$9/mo) is the recommended pick** — enough headroom for
Postgres + API + Caddy without paying NEO Lite Pro's NVMe premium (its equivalent
2 vCPU/4 GB tier runs ~Rp559,000–609,000/mo, ~6× the price, for IOPS this app's write
volume doesn't need). `SS 2.2` (2 vCPU/2 GB, ~$7/mo) is the acceptable floor if budget is
tighter — meaningfully safer than `XS 1.1` for only ~$3/mo more, since it at least
clears the baseline above with some room to spare. A 10%-off annual code (`DISKON10`, as
listed on the pricing page at time of writing) applies on top of any of these — confirm
it's still live before relying on it.

**Setup:** provision through Biznet Gio's own cloud console (not Oracle's or Railway's),
Ubuntu 24.04, note the public IP. From there, `INFRASTRUCTURE.md` Appendix A (the
Oracle/self-hosted runbook) applies almost unchanged from its "Bootstrap the host" step
onward — same bootstrap commands, same `.env` file, same Caddy/TLS flow, same CI deploy,
same backup cron, same monitoring — because the Compose file is host-agnostic by design
(portability contract, `CLAUDE.md` §3b). Two things do differ from the Oracle steps and
need re-checking, not re-deriving:

- **Firewall:** NEO Lite ships its own **Security Group** panel (Biznet Gio's own name
  for the same concept as Oracle's security list) plus built-in Anti-DDoS — open 80/443
  there. Whether the instance *also* ships a local `iptables`/`ufw` rule blocking those
  ports in addition (Oracle's "open it twice" trap) isn't guaranteed one way or the
  other; run `sudo iptables -L INPUT --line-numbers` on first login and only run the
  Oracle appendix's `iptables` procedure if it's actually blocking.
- **Architecture:** confirm `uname -m` before deploying. NEO Lite Pro is explicitly
  AMD EPYC (`x86_64`); plain NEO Lite's CPU vendor isn't published on the pricing page,
  so don't assume — check after provisioning. Either way, nothing to change code-side if
  it's x86 (CI already builds both `linux/amd64` and `linux/arm64` for this fallback
  family), just confirm the pulled image resolves to the right platform.

**Gotchas:**

- Snapshot backups are a paid Biznet Gio add-on (~Rp1,500/GB/month on NEO Lite as of
  this writing), not automatic, and outside this project's tested restore path — keep
  the `pg_dump` → R2 cron as the backup of record regardless of whether you also turn
  snapshots on.
- Billing is IDR-native; if paying from outside Indonesia, confirm the accepted payment
  methods before provisioning.

---

## Migration runbook

Applies to any target. Budget an afternoon.

1. **A week before:** confirm backups restore cleanly into a throwaway Postgres. An
   untested backup is a rumour.
2. **24 hours before:** drop the DNS TTL in Cloudflare to 60 seconds.
3. Provision the target and set every environment variable. Diff the list against the
   current host — a missing `DEVICE_TOKEN_SECRET` invalidates every issued device token
   and silently disables the one-entry-per-device rule.
4. `pg_dump` from the old host, `pg_restore` into the new one. Run Drizzle migrations
   and confirm the schema version matches.
5. Deploy the same image tag currently in production. Same tag, not a fresh build —
   you're changing one variable at a time.
6. **Verify against the new host directly, before DNS moves:**
   - `GET /api/health` returns 200
   - an SSE stream stays open past 60 seconds and delivers a heartbeat
   - enqueueing from two devices produces sequential ticket numbers
   - the throttle tier rejects at its boundary (proves `trustProxy` is right)
   - `service_date` matches today in `Asia/Jakarta`, not UTC
7. Cut over in Cloudflare. Watch for 10 minutes.
8. **Leave the old stack running for 48 hours**, powered on and reachable, so rollback
   is a DNS change rather than a restore.
9. Decommission. Restore the DNS TTL.

The queue's ephemerality is a gift here: worst case, you lose one day's queue at one
game center, and it would have been deleted at local midnight anyway. Schedule the
cutover for early morning in `Asia/Jakarta` and the real blast radius is near zero.

---

## Deliberately not doing

**Cloudflare Workers + Durable Objects** is the most elegant fit for this problem on
paper — one Durable Object per game, storage in the same thread as the compute, all
writes serialized by construction, daily reset via the alarm API, WebSocket hibernation
making idle connections free, and $0 within generous limits. It was seriously
considered and rejected for one reason: **it has no exit.** Durable Objects have no
open-source equivalent, so leaving means rewriting the realtime layer and the queue
core. Every option in the plan above can move to any other in an afternoon; that one
cannot move at all. If the project outgrows this plan and the Cloudflare model still
appeals, revisit it as a deliberate rewrite — not as a deployment choice.

**Free PaaS tiers** (Render Free, Koyeb, Fly trial) are all built on scale-to-zero,
which is fundamentally opposed to holding open live queue connections. Documented so
nobody re-derives it.

**Firebase** was considered and rejected — not on cost, on architecture mismatch.
Firestore is NoSQL; the data layer here (Drizzle schema, `service_date` computation,
per-`(game_id, service_date)` ticket sequencing, the queue strategy interface) is built
entirely on relational transactions and constraints, so adopting it means rewriting the
persistence layer, not swapping a host. Firestore/Realtime Database's live-update model
is WebSocket-based and lives inside Firebase's client SDK, which conflicts with two
things at once: `CLAUDE.md` §3's "SSE, not WebSockets" and the portability contract's
"no provider-specific SDKs in application code" (§3b point 1) — using it means deleting
`QueueEventsService` and calling the Firebase SDK directly from the frontend. Hosting
the API on Cloud Functions reintroduces the same scale-to-zero-vs-long-lived-SSE
conflict as the free PaaS tiers above. In short: adopting Firebase would mean rewriting
the DB layer, the realtime layer, and the hosting model simultaneously — the same "no
exit" shape as Cloudflare Durable Objects, just arrived at from a different direction.

**Supabase** is a partial exception worth naming precisely because it's Postgres
underneath — Drizzle works against it unmodified via a plain `DATABASE_URL`, *as long
as* only the Postgres piece is used and Supabase's client SDK, Auth, Storage, and
Realtime features are left alone. Reaching for Supabase Realtime reintroduces the same
SSE-vs-WebSocket conflict as Firebase; Supabase Auth doesn't fit the existing
`admin_users`/session model. Even used narrowly as managed Postgres, it doesn't replace
a compute host — the API still needs Railway/Render/a VPS regardless — so it doesn't
reduce moving parts versus Railway's own Postgres service or self-hosting Postgres in
the same Compose stack. Two gotchas if it's ever used this way: connection pooling
defaults to PgBouncer in transaction mode, which restricts some session-level Postgres
features (prepared statements, `SET`); and the free tier auto-pauses projects after
inactivity, which fights the "survives an unattended reboot" expectation in
`INFRASTRUCTURE.md`. Not ruled out the way Firebase is — just not a reason to add a
fifth deployment phase.

---

# Cost and load self-governance

Goal: the app should protect _itself_ against a traffic spike — whether organic or
malicious — so that a bad day degrades gracefully instead of either falling over or
generating a surprise bill. Verified July 2026; provider APIs change, re-check.

## The reframe that decides the design

Railway (the primary target) is metered — every spike, organic or malicious, shows up
on an invoice, not just as resource exhaustion. That changes the frame from an
Oracle-primary version of this document: cost governance here isn't optional defense in
depth, it's core operational behavior from day one. Oracle Always Free (Phase 2a)
remains the one target where a runaway bill is structurally impossible, because there's
no active payment method for consumption — the platform degrades or reclaims resources
instead of charging. That's worth knowing as the reason to migrate there if metered risk
ever becomes unacceptable, but it isn't the default anymore.

| Target                            | Can a spike cost money?                             | What a spike actually threatens                  |
| ---------------------------------- | ---------------------------------------------------- | ------------------------------------------------- |
| Railway (primary)                 | **Yes — metered, and the "hard" cap is imperfect**  | Real, uncapped-in-practice overage               |
| Render                             | Only bandwidth overage ($0.15/GB); compute is fixed | A degraded but bounded bill                      |
| Oracle Always Free (no PAYG)      | No                                                   | OOM / CPU saturation / idle-or-abuse reclamation |
| Oracle upgraded to Pay-As-You-Go  | Yes, beyond free limits                             | Egress + compute overage                         |

Given Railway is the chosen primary, the single most effective cost control left as a
pure deployment decision is which fallback to keep documented and ready: Oracle Always
Free is the escape hatch to zero billing risk if metered cost ever becomes a real
problem. Everything below is what actually protects the Railway bill day to day.

## Do provider usage APIs exist? Yes — with caveats

- **Railway** has a **GraphQL public API** (the same one powering the dashboard) that can
  return usage and per-service metrics, plus deployment/service **webhooks**. It also has
  an **opt-in hard spending limit** with email alerts — but users report it is unreliable
  as an absolute stop. Set it, alert on it, don't fully trust it.
- **Oracle** exposes the **Monitoring API** (per-resource metrics like `CpuUtilization`
  in the `oci_computeagent` namespace), the **Usage/Cost API**, and **Budgets**. Critical
  caveat: OCI Budgets are _soft limits_ — they fire alerts and can raise events, but they
  do **not** stop resources or prevent overage. Treat them as a smoke alarm, not a
  sprinkler.
- **Render** has a **REST API** for services and metrics. Because compute is a fixed
  monthly price, the only usage-scaling variable is bandwidth, which the API can report.
- **Cloudflare** has the **GraphQL Analytics API** (read-only, 70+ datasets: HTTP
  requests, bytes, rate-limiting events, Workers/D1 metrics). Rate-limited to ~300
  queries per 5 minutes. This is the best _external_ view of real traffic because it
  sits in front of the origin — but it lags and is not a real-time kill switch.

The load-bearing caveat across all of them: **billing and usage APIs are laggy** (minutes
to hours) and **rate-limited**. None is designed to be polled as a real-time circuit
breaker. Do not build your primary self-protection loop on them.

## The design: govern on your own signals, not the billing API

The app already sees every request. That in-process view is real-time, free, and can't
be rate-limited against you. So the self-governor runs on internal counters, and provider
APIs serve only as a slower, secondary reconciliation.

Three layers, outermost first — each one catches what the previous missed:

### Layer 1 — Edge (Cloudflare, free, runs even if the origin is melting)

The only layer that works when the origin is already saturated, because it never reaches
the origin. Configure in the Cloudflare dashboard, not in code:

- A **rate-limiting rule** on `POST /api/*` (e.g. > N requests/min per IP → block or
  managed challenge).
- **Bot Fight Mode** on.
- A **cache rule** that serves a static maintenance page when the origin returns 503, so
  "maintenance mode" costs zero origin resources.

This is the real backstop. An attacker capable of generating a bill has to get through
here first.

### Layer 2 — Application throttling (already in the plan)

`@nestjs/throttler` per `CLAUDE.md` §6. This is per-route fairness, not spike defense —
it stops one client abusing one endpoint. On metered hosts it doubles as a cost control,
which is why the tiers there are financial infrastructure, not just abuse controls.

### Layer 3 — The cost/load governor (new)

A small in-process service, `LoadGovernorService`, that watches cheap local signals on a
short tick and can put the app into a degraded or maintenance state on its own authority.

Signals it reads (all local, all real-time):

- Global request rate across a sliding window (sum the throttler's own counters).
- New enqueue rate specifically — the expensive, abusable write path.
- Open SSE connection count.
- Process RSS vs a configured ceiling (the OOM guard, tuned to whichever host's actual
  RAM ceiling is in play — Railway's allocated service RAM on the primary target).
- Event-loop lag as a saturation proxy.

Graduated responses, so a busy day doesn't nuke the site:

1. **Normal** — full service.
2. **Elevated** (any signal over its soft threshold) — tighten throttle tiers
   dynamically, stop accepting _new_ SSE streams (existing ones keep working), shed the
   heartbeat frequency. Log a structured `governor.elevated` event.
3. **Shed** (hard threshold) — writes (`enqueue`, `done`) return `503` with a short
   `Retry-After`; reads still serve. The queue stays _viewable_, just temporarily
   read-only. This is the sweet spot: the product still works, the abusable surface is
   closed.
4. **Maintenance** (critical, or flipped manually) — everything returns `503` with the
   maintenance payload; Cloudflare's cache rule shows the static page so the origin does
   almost nothing.

Recovery is automatic and hysteretic: signals must sit below a _lower_ threshold for a
sustained cooldown before stepping back down a level, so the app doesn't oscillate.

State lives in memory (single process — see the realtime section), mirrored to one
Postgres row so it survives a restart and so the admin console can read and override it.

### The manual switch

A `POST /api/admin/maintenance { level, reason }` endpoint and a matching admin-console
toggle. Same mechanism as the automatic governor, just a human setting the level. Useful
for deploys, migrations, and "something is obviously wrong, freeze it" moments.

### The secondary reconciliation loop (Railway: required; other metered hosts: optional)

A daily cron that queries the provider usage API (Railway GraphQL, or Cloudflare
Analytics for bytes) and compares month-to-date consumption against a configured budget.
If projected month-end cost exceeds the budget, it flips the app to **Maintenance** and
alerts. This is the backstop for slow bleeds that never trip the real-time governor —
a persistent low-grade scrape that wouldn't spike but would accrue. Because these APIs
lag, this loop is for _trend_ protection, never for real-time defense.

## What to actually turn on where

- **Railway (primary):** all three layers, **plus** the reconciliation loop, the
  provider's opt-in hard spending limit, and a genuinely conservative Cloudflare
  rate-limit rule. This is the default configuration, not an optional upgrade — metered
  billing makes the governor load-bearing for your wallet, not just your uptime, from
  day one.
- **Oracle Always Free (fallback, Phase 2a):** Layers 1–3, tuned around **RSS and CPU**,
  not cost. Set an OCI Budget alert at $1 purely to detect an accidental PAYG upgrade. No
  reconciliation loop needed — nothing can be billed.
- **Render (fallback, Phase 2b):** Layers 1–3 plus a bandwidth check in the
  reconciliation loop. Compute is fixed, so the blast radius is only overage bandwidth —
  bounded, not scary.

The principle underneath all of it: **the hard stop must live at a layer the spike can't
take down.** An app cannot be trusted to shut itself off when the thing overwhelming it
is the same thing you're asking to notice and react. The app's self-governor is valuable
defense in depth, but the true backstop is Cloudflare at the edge plus the provider's own
spending cap. Never rely on the app alone.

---

## Open questions

- **Location hours:** the current location model has an `is_active` availability flag and
  an IANA timezone, but no operating-hours schedule. The public landing therefore shows
  active/closed state plus the location-local clock; it must not infer "open now" from an
  invented schedule. Add an explicit hours model only after the venue policy is defined.
- Marking _someone else's_ entry: decided. Default is an **open board** — anyone can mark
  any entry, guarded by throttling plus a visible integrity notice
  (`require_approval_for_others = false`). Venues that want stricter control turn approval
  on, which requires a staff PIN for others' entries. Modelled per-location.
- Auto re-queue (UI_DESIGN §7.4a) currently **inherits** the flag, so a player keeps
  cycling until they mark `left`. Alternative is one-shot (re-queue once, flag off on the
  new entry). Inherit matches "keep me in for rounds"; revisit if it surprises users.
- Board mode: decided. Default `self_serve` (players mark themselves played, no slot to
  clear); `now_playing` is an opt-in per-game toggle for venues wanting an explicit
  current-player slot. See `UI_DESIGN.md` §7.0.
- Do multiple cabinets of the same game share one queue or get separate ones?
  Currently: separate, via `cabinet_label` on distinct `games` rows.
- Display name collisions ("Bob" twice) — allow, and lean on ticket numbers to
  disambiguate? Current assumption: yes, allow.
- Manual rejoin cooldown — M2 uses an environment-configured 30-second default. Keep it
  global until an actual venue needs a per-game override.
