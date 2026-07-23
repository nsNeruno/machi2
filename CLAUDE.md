# CLAUDE.md

Working agreement for Claude Code on this repository. Read this before touching anything.
Architecture rationale lives in `ARCHITECTURE.md`. Build order lives in `ROADMAP.md`.
Local setup lives in `DEVELOPMENT.md`; server setup in `INFRASTRUCTURE.md`. Routes,
screens, and interactions live in `UI_DESIGN.md`; visual tokens (color, type, spacing,
motion) live in `DESIGN_SYSTEM.md` — read both, plus the `frontend-design` skill, before
building any UI.

---

## 1. What this project is

A public web app for **queueing at arcade machines in game centers**.

- Anyone can open the site, pick a game center → pick a game → add their name to the queue.
- Anyone (or a staff member, depending on config) can mark an entry as **done** — for any reason: they played, they left, they were skipped.
- The queue is **per-day**. It does not carry over. At local midnight *in the game center's own timezone*, the queue for that day is gone and a fresh one starts.
- An **admin console** manages game centers (locations) and the games in each.

That's it. Resist the urge to build more.

## 2. Non-negotiable product rules

| Rule | Detail |
|---|---|
| Queue is ephemeral | Scoped to a `service_date`. Never surface yesterday's entries in the public UI. |
| Timezone is per-location | "Today" is computed from `location.timezone` (IANA, e.g. `Asia/Jakarta`), never from server time or client time. |
| No accounts for public users | Public queueing is anonymous. Identity is a display name plus an opaque device token. Acting on a board requires at least one local name card (the active card names the actor), but that name is **self-asserted** — validate it, show it, never trust it for authorization. The device-token hash is the only trustworthy actor key. See `UI_DESIGN.md` §4a, §7.7. |
| One queue strategy for now | `simple_fifo`. The pluggable seam exists (see §5) but only one implementation ships. |
| Live updates are core | The queue list must update without a refresh. Polling as the only mechanism is a regression. |
| Writes are hostile by default | Every public write endpoint is rate-limited and idempotency-aware. See §6. |
| Protect against spikes at the edge, not just in-app | The hard stop lives at Cloudflare + the provider spending cap, layers a spike can't take down. The in-app governor is defense in depth, never the sole backstop. See `ARCHITECTURE.md` → Cost and load self-governance. |
| Style only through design tokens | Every color, size, radius, and duration comes from `DESIGN_SYSTEM.md` tokens — never hardcode a hex, px, or ms in a component. Editing a token must cascade; that only works if nothing bypasses it. |

## 3. Stack

Do not swap these out without an explicit instruction from the user.

- **Language:** TypeScript everywhere, `strict: true`, no `any` without an inline justification comment.
- **Backend:** NestJS on the Fastify adapter.
- **Realtime:** Server-Sent Events (SSE). Not WebSockets. Rationale in `ARCHITECTURE.md`.
- **Frontend:** React + Vite, TanStack Query for server state, `vite-plugin-pwa` for the installable PWA.
- **Database:** PostgreSQL 16. On the primary target (Railway) it's a separate Railway
  service reached over the project's private network, not literally co-located; on the
  Oracle/paid-VPS fallbacks it runs on the same host as the API via Docker Compose.
  Drizzle ORM + Drizzle Kit migrations either way.
- **Validation:** Zod schemas in `packages/shared`, imported by both API and web. One source of truth for request/response shapes.
- **Package manager:** pnpm workspaces.
- **Reverse proxy:** none on the primary target — Railway terminates TLS itself, and
  the API serves the built SPA directly via `@fastify/static` (single origin, no CORS).
  Caddy is used only on the Oracle/paid-VPS fallback path (automatic TLS, serves the
  built SPA, proxies `/api`).
- **Hosting:** Railway, Hobby plan ($5/mo minimum usage) — Singapore region if
  available, confirm at deploy time. Fallbacks (Oracle Cloud Always Free, Render, paid
  VPS) are documented in `ARCHITECTURE.md`. CI keeps building multi-arch
  (`linux/amd64` + `linux/arm64`) images so those fallbacks stay a same-day swap — never
  build on a host.

## 3b. Portability contract

Non-negotiable. These are what make the hosting fallbacks a one-afternoon migration
instead of a rewrite. If a change would break one, ask before committing it.

1. No provider-specific SDKs in application code. Object storage over S3-compatible
   HTTP with endpoint and credentials from env vars.
2. All configuration through environment variables. No hardcoded hostnames.
3. All durable state lives in Postgres. The app never writes to the local filesystem
   expecting persistence.
4. Single stateless process plus a database. It must survive being killed at any moment.
5. `GET /api/health` returns 200 only when the database is reachable.
6. Images built in CI, multi-arch (`linux/amd64` + `linux/arm64`), pushed to GHCR.
7. Realtime fan-out stays behind `QueueEventsService`. In-process `EventEmitter` today,
   because every supported host runs exactly one instance. If that changes, swap in
   Postgres `LISTEN/NOTIFY` — no call sites change. **Do not add Redis.**

Two deployment details that silently break things if missed:

- On the Oracle/paid-VPS fallback path, Caddy needs `flush_interval -1` on the `/api/*`
  reverse proxy, or it buffers the SSE stream and live updates appear to work in dev but
  never arrive in production. Railway has no Caddyfile to misconfigure, but verify SSE
  heartbeats arrive there too — if they don't while `/api/health` stays green, an edge
  buffering issue is still the first thing to check.
- Fastify needs `trustProxy` enabled on every target, Railway included — it terminates
  TLS at its own edge same as Caddy or Render's proxy. Without it every request looks
  like it came from one IP and the throttler rate-limits the entire userbase as a
  single bucket — silently defeating §6.

## 4. Repository layout

```
apps/
  api/            NestJS service
    src/
      locations/  location + game CRUD (admin)
      queue/      public queueing, strategies, SSE stream
      admin/      auth, sessions, guards
      common/     throttling, service-date utils, logging
      db/         drizzle schema + migrations
  web/            React SPA (public + /admin routes, one bundle)
packages/
  shared/         zod schemas, DTO types, queue status enums
docker-compose.yml
Caddyfile
```

## 5. The queue strategy seam

This is the one piece of intentional future-proofing. Keep it clean, keep it small.

```ts
// packages/shared or apps/api/src/queue/strategies/queue-strategy.interface.ts
export interface QueueStrategy {
  readonly key: string; // stored in games.queue_strategy
  enqueue(ctx: QueueContext, input: EnqueueInput): Promise<QueueEntry>;
  complete(ctx: QueueContext, entryId: string, reason: DoneReason): Promise<QueueEntry>;
  list(ctx: QueueContext): Promise<QueueEntry[]>;
}
```

- `games.queue_strategy` is a text column, defaults to `'simple_fifo'`.
- A `QueueStrategyRegistry` resolves the implementation by key at request time.
- Auto re-queue lives in `complete()`: on a `played` completion where the entry's
  `auto_requeue` is set, the same transaction enqueues a fresh waiting entry for the same
  name/device at the back, inheriting the flag, respecting `max_queue_len`, exempt from the
  manual re-join cooldown (UI_DESIGN §7.4a).
- **Ship exactly one implementation:** `SimpleFifoStrategy`. Do not scaffold empty strategy classes "for later." An unused abstraction with one implementation is fine; three stub files are not.

## 6. Abuse control — treat this as a feature, not an afterthought

Public anonymous writes on a queue people care about *will* be abused. Layers, cheapest first:

1. **Edge:** Cloudflare in front of the origin (free tier). Bot Fight Mode on.
2. **Transport:** `@nestjs/throttler` with named tiers. Starting points, tune later:
   - `enqueue`: 3 requests / 60s per IP (`ENQUEUE_IP_*`). The per-device enqueue interval
     (1 / 5s, `ENQUEUE_DEVICE_*`) is a **domain rule**, enforced in the service — see §6.3,
     not a throttler tier.
   - `complete`: 10 / 60s per IP
   - `read`/SSE: 60 / 60s per IP, max 3 concurrent SSE streams per IP
3. **Domain rules** (enforced in the service, not the controller):
   - One *active* entry per device token per game.
   - Per-device enqueue interval: 1 / 5s (`ENQUEUE_DEVICE_LIMIT` / `ENQUEUE_DEVICE_TTL_SECONDS`,
     enforced in `SimpleFifoStrategy.enqueue`; a violation is 429 `rate_limited`).
   - Configurable per-game max queue length.
   - Cooldown before the same device token can *manually* re-enqueue on the same game
     after being marked done (`REJOIN_COOLDOWN_SECONDS`, default **30s**; `0` disables).
     Enforced in `SimpleFifoStrategy.assertManualCooldown`; a violation is HTTP 409
     `rejoin_cooldown`, *not* the 429 `rate_limited` throttle tiers. Auto re-queue
     (UI_DESIGN §7.4a) is exempt — it's a single opt-in re-join on a `played` completion,
     not spam.
   - Optional per-location **staff PIN** required to mark someone else's entry done. Entry owners can always mark their own.
4. **Idempotency:** every write accepts an `Idempotency-Key` header; replays return the original result rather than double-inserting.

Device token = UUID generated client-side, stored in `localStorage`, sent as a header, HMAC-signed by the server on first sight so it can't be trivially forged in bulk.

## 7. The service-date rule (get this right or nothing else matters)

**Never** implement the daily reset as a job that deletes rows at midnight. Downtime, DST, and clock skew will break it.

Instead, make it *derived*:

- Every queue entry stores `service_date DATE`, computed at insert as
  `(now() AT TIME ZONE location.timezone)::date`.
- Every read filters `WHERE service_date = <today in that location's tz>`.
- The queue therefore "resets" at local midnight with zero moving parts.
- A nightly cleanup job deletes rows older than 7 days. It is housekeeping only — correctness never depends on it running.
- A 60-second server tick compares each location's current service date to the last-broadcast one; on change, push a `day-rollover` SSE event so open clients clear their view.

Use `Intl.DateTimeFormat` / `date-fns-tz` on the server for tz math. Never `new Date().toISOString().slice(0,10)`.

## 8. Conventions

- **Errors:** typed problem responses (`{ code, message, details? }`). `code` is a stable string the frontend switches on. Never leak stack traces.
- **IDs:** UUIDv7 for entities. Ticket numbers are a separate human-facing monotonic integer per `(game_id, service_date)`.
- **Naming:** snake_case in the database, camelCase in TypeScript. Drizzle handles the mapping.
- **Time:** `timestamptz` in the DB, always. `service_date` is the only bare `date`.
- **Migrations:** every schema change gets a Drizzle migration checked in. No `push` against anything but a local dev DB.
- **Commits:** conventional commits (`feat:`, `fix:`, `chore:`).

## 9. Testing expectations

Don't chase coverage numbers. Do cover these, they are where the bugs will be:

- Service-date computation across timezones, including a DST-observing zone and `Asia/Jakarta` (no DST).
- Day rollover: an entry created at 23:59 local is not visible at 00:01 local.
- Throttle tiers actually reject at the boundary.
- Idempotency-Key replay returns the original entry, no duplicate row.
- FIFO ordering under concurrent enqueue.

Vitest for units, Supertest for API integration against a throwaway Postgres container.

## 10. Working style for Claude Code

- Read `ROADMAP.md` and work the current milestone. Ask before jumping ahead.
- Prefer boring, obvious code. This is a small app that must run unattended on one cheap VPS.
- Before adding a dependency, say what it replaces and why hand-rolling is worse.
- When a decision is ambiguous, write the options into `ARCHITECTURE.md` under "Open questions" and ask rather than silently picking.
- Don't add auth, analytics, notifications, or multi-tenancy unless asked.
