# Machi2 — arcade queue board

A public web app for **queueing at arcade machines in game centers**. Open the site, pick
a game center → pick a game → add your name to the queue. Anyone (or staff, depending on
the location's config) can mark an entry **done** — played, left, or skipped.

No accounts for public users: identity is a self-asserted display name plus an opaque,
server-signed device token. The queue is **ephemeral and per-day**, scoped to a
`service_date` computed in each location's own timezone — it "resets" at local midnight
with no cron job deleting rows. An admin console manages locations and their games.

That's the whole product. The scope is deliberately small; see `CLAUDE.md` for the
non-negotiable rules that keep it that way.

## Stack

- **TypeScript** everywhere (`strict: true`), **pnpm** workspaces
- **API** — NestJS on Fastify, PostgreSQL 16 via Drizzle ORM + Drizzle Kit migrations
- **Realtime** — Server-Sent Events (SSE), not WebSockets
- **Web** — React + Vite, TanStack Query, installable PWA (`vite-plugin-pwa`)
- **Shared** — Zod schemas in `packages/shared`, one source of truth for request/response
  shapes, imported by both API and web
- **Hosting** — Railway (Hobby); Oracle Cloud / Render / paid VPS documented as same-day
  fallbacks. The API serves the built SPA directly, so there's a single origin and no CORS.

## Repository layout

```
apps/
  api/            NestJS service (locations, queue + SSE, admin, common, db)
  web/            React SPA — public + /admin routes, one bundle
packages/
  shared/         zod schemas, DTO types, queue status enums
docker-compose.yml  local Postgres
Caddyfile           reverse proxy for the VPS fallback path only
```

## Quick start

Requires Node ≥ 22, pnpm ≥ 9, and Docker (for local Postgres). Full details in
`DEVELOPMENT.md`.

```bash
cp .env.example .env      # working dev placeholders, nothing secret
pnpm install
docker compose up -d postgres
pnpm db:migrate && pnpm db:seed
pnpm dev                  # api + web with hot reload
```

`./dev.sh` wraps that boot sequence into one command.

| Command          | Does                                                    |
| ---------------- | ------------------------------------------------------- |
| `pnpm dev`       | api + web together                                      |
| `pnpm build`     | production build of all workspaces                      |
| `pnpm test`      | unit tests (Vitest)                                     |
| `pnpm test:api`  | api tests incl. integration (Supertest + throwaway Postgres) |
| `pnpm typecheck` | `tsc --noEmit` everywhere                               |
| `pnpm db:reset`  | drop + recreate the local DB, migrate, seed             |

## Abuse control & rate limits

Public anonymous writes are treated as hostile by default (`CLAUDE.md` §6). The join
endpoint has two independent guards, both of which surface as HTTP 429 with
`code: "rate_limited"`:

- a **transport tier** per IP (`@nestjs/throttler`), and
- a **domain tier** per device token (in `SimpleFifoStrategy`).

Both are env-configurable (`ENQUEUE_IP_*`, `ENQUEUE_DEVICE_*`); the code defaults match
the §6 production posture. A separate **manual re-join cooldown**
(`REJOIN_COOLDOWN_SECONDS`, default 30s) blocks a device from re-joining a game within N
seconds of being marked done there — that returns HTTP 409 `rejoin_cooldown`, distinct
from the 429 `rate_limited` tiers; auto re-queue is exempt.

**Note for local testing:** all localhost traffic shares one IP, so the default `3 / 60s`
per-IP tier is exhausted after three joins in a minute. The committed dev `.env` loosens
the per-IP limit for that reason — see `DEVELOPMENT.md` §4.

## Documentation

| Doc                 | What's in it                                                    |
| ------------------- | --------------------------------------------------------------- |
| `CLAUDE.md`         | Working agreement: product rules, stack, conventions (read first) |
| `ARCHITECTURE.md`   | The why, the data model, and open questions                     |
| `ROADMAP.md`        | Build order and milestone status                                |
| `DEVELOPMENT.md`    | Local setup, env vars, scripts, troubleshooting                 |
| `INFRASTRUCTURE.md` | Server/deploy setup                                             |
| `UI_DESIGN.md`      | Routes, screens, interactions                                   |
| `DESIGN_SYSTEM.md`  | Visual tokens — color, type, spacing, motion                    |

## Status

Domain core, public API, throttling, realtime, public UI, PWA, and the admin console are
in place (`ROADMAP.md` M0–M7.5). Remaining work is shipping: Railway deploy config,
Cloudflare edge rules, backups, the nightly cleanup job, and the CI multi-arch image push
(M8).
