# @machi2/api

NestJS service (Fastify adapter) for the arcade queue board. It serves the public
queueing API, the admin console API, the SSE realtime stream, and — in production — the
built web SPA from a single origin.

> This README is a map of the service. The **rules** it must obey (service-date, abuse
> control, portability) live in the root `CLAUDE.md` and `ARCHITECTURE.md` — read those
> before changing behaviour.

## Layout

```
src/
  admin/       admin auth, sessions, guards, and location/game/queue/user management
  common/      cross-cutting: device tokens, throttling, load governor, service-date
               utils, the problem-response exception filter
  config/      env loading (dotenv) + Zod-validated Environment schema
  db/          Drizzle schema, migrations, and migrate/seed scripts
  health/      GET /api/health — 200 only when Postgres is reachable
  locations/   public location + game read endpoints
  queue/       public queueing, the strategy seam, and the SSE event stream
    strategies/  QueueStrategy interface, registry, and SimpleFifoStrategy
  main.ts      Fastify bootstrap (trustProxy, static SPA, global filters)
```

## Key mechanics

- **Service-date, not a cron.** Every queue entry stores a `service_date` computed in the
  location's own IANA timezone. Reads filter on today's date in that zone, so the queue
  "resets" at local midnight with no job deleting rows. See `CLAUDE.md` §7.
- **Realtime is SSE, not WebSockets.** Fan-out is behind `QueueEventsService` (in-process
  `EventEmitter`, single instance). Do not add Redis; if fan-out must cross processes,
  swap in Postgres `LISTEN/NOTIFY` behind the same service. See `CLAUDE.md` §3b.
- **Writes are hostile by default.** Enqueue/complete carry per-IP throttler tiers plus
  per-device domain rules (interval, active-entry cap, re-join cooldown) and are
  `Idempotency-Key` aware. See `CLAUDE.md` §6.
- **One queue strategy ships:** `SimpleFifoStrategy`, resolved by
  `games.queue_strategy` through `QueueStrategyRegistry`.
- **Typed errors.** Failures return `{ code, message, details? }`; the frontend switches
  on `code`. No stack traces leak.

## Configuration

All config is environment-driven and validated by the Zod schema in
`src/config/environment.ts` — the app refuses to boot on a bad/missing value. Copy the
root `.env.example` to `.env` for working dev defaults. Nothing here is hardcoded; there
are only dev fallbacks (e.g. the admin seed) that real env values override.

## Scripts

Run from the repo root (`pnpm --filter @machi2/api <script>`) or this directory:

| Script            | Does                                                        |
| ----------------- | ----------------------------------------------------------- |
| `pnpm dev`        | build once, then watch-compile + `node --watch`             |
| `pnpm build`      | `tsc` production build to `dist/`                            |
| `pnpm test`       | Vitest unit tests                                           |
| `pnpm test:api`   | integration tests (Supertest against a throwaway Postgres)  |
| `pnpm typecheck`  | `tsc --noEmit`                                              |
| `pnpm db:generate`| generate a Drizzle migration from schema changes            |
| `pnpm db:migrate` | apply migrations                                            |
| `pnpm db:seed`    | seed the admin account + demo data                          |

Every schema change gets a checked-in migration (`src/db/migrations`). Never `push`
against anything but a local dev DB.
