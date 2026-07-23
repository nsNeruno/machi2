# AGENTS.md

Guidance for coding agents working in this repository. This file applies to the whole
project.

## Start Here

- Read `CLAUDE.md` before changing anything. It is the primary working agreement for
  this project; if this file and `CLAUDE.md` conflict, follow `CLAUDE.md`.
- Read `ROADMAP.md` and work the first unchecked milestone from top to bottom. M0 through
  M5 are complete. M6's PWA build support is implemented; its Android Chrome and iOS
  Safari installability checks require manual device verification. M2's admin-only
  community-note mutation remains deferred to M7 session authorization.
- Pull detail from the focused docs as needed:
  - `ARCHITECTURE.md` for system rationale, data model, API shape, and deployment
    tradeoffs.
  - `DEVELOPMENT.md` for local setup, scripts, test commands, and database workflow.
  - `UI_DESIGN.md` for routes, screens, public interactions, and admin console
    behavior. Before building UI, also read the configured frontend-design skill if it is
    available in your agent environment.
  - `INFRASTRUCTURE.md` for production setup and operational constraints.

## Product Boundary

This is a public web app for queueing at arcade machines in game centers:

- Public users pick a location, pick a game, and add a display name to today's queue.
- Public users do not have accounts. Identity is a display name plus an opaque device
  token; names are self-asserted and must never be trusted for authorization.
- Queue entries are per location-local day. Yesterday's entries must never appear in the
  public UI.
- Admins manage locations, games, staff settings, and admin users.
- Do not add auth for public users, analytics, notifications, multi-tenancy, extra queue
  strategies, or other product surface unless the user explicitly asks.

## Non-Negotiable Rules

- Compute "today" from `location.timezone` using an IANA timezone. Never use server time,
  client time, or `new Date().toISOString().slice(0, 10)` for service-date behavior.
- Implement daily reset by deriving and filtering on `service_date`; do not delete rows
  at midnight for correctness.
- Use SSE for live updates. Polling-only updates or WebSockets are regressions unless the
  user explicitly changes the architecture.
- Every public write endpoint must be rate-limited and idempotency-aware.
- Enforce domain rules in services, not just controllers: one active entry per device per
  game, max queue length, rejoin cooldowns, and staff/admin authorization rules.
- Keep the queue strategy seam small. Ship only `SimpleFifoStrategy` for now; do not add
  empty strategy classes for future ideas.
- Preserve the portability contract from `CLAUDE.md`: env-driven config, no provider SDKs
  in application code, durable state in Postgres, one stateless process plus database,
  health check gated on DB reachability, and no Redis.

## Stack Constraints

- TypeScript everywhere with `strict: true`. Avoid `any`; if unavoidable, add a short
  inline justification.
- Backend: NestJS on Fastify.
- Frontend: React + Vite, TanStack Query for server state, React Router v6, and
  `vite-plugin-pwa`.
- Database: PostgreSQL 16 with Drizzle ORM and checked-in Drizzle migrations.
- Shared validation: Zod schemas in `packages/shared`, imported by both API and web.
- Package manager: pnpm workspaces.
- Production shape: primary target is Railway (Hobby plan) — the API serves the built SPA
  via `@fastify/static` on a single origin (no reverse proxy, no CORS), with a
  Railway-managed Postgres service on the project's private network. Caddy plus Docker
  Compose is the self-hosted fallback shape (Oracle / paid VPS), documented in
  `INFRASTRUCTURE.md` Appendix A. See `ARCHITECTURE.md` → Deployment.

## Target Layout

M0 should create this shape:

```text
apps/
  api/            NestJS service
    src/
      admin/
      common/
      db/
      locations/
      queue/
  web/            React SPA for public and /admin routes
packages/
  shared/         Zod schemas, DTO types, queue enums
docker-compose.yml
Caddyfile
```

## Development Commands

After M0 exists, run commands from the repo root with pnpm:

```bash
pnpm dev
pnpm build
pnpm test
pnpm test:api
pnpm typecheck
pnpm lint
pnpm format
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm db:reset
```

Do not invent replacement scripts without updating `DEVELOPMENT.md`.

## Database And Migrations

- Every schema change gets a Drizzle migration checked in.
- Do not use `drizzle-kit push` except against a throwaway local database.
- Use `timestamptz` for timestamps. `service_date` is the only bare `date`.
- Use snake_case in the database and camelCase in TypeScript.
- UUIDv7 identifies entities. Human-facing ticket numbers are monotonic per
  `(game_id, service_date)`.

## Testing Priorities

Do not chase coverage numbers. Focus tests on high-risk behavior:

- Service-date computation across timezones, including `Asia/Jakarta` and one
  DST-observing zone.
- Day rollover: entries from 23:59 local are not visible at 00:01 local.
- Throttle boundaries.
- Idempotency-Key replay returning the original result without duplicate rows.
- FIFO ordering and ticket allocation under concurrent enqueue.
- Auto re-queue only on `played`, inheriting the flag, respecting max length, and
  bypassing manual rejoin cooldown.
- Shared name validation: grapheme counting, CJK allowed, emoji/control rejected, and
  the 8-character cap.

## Working Style

- Prefer boring, obvious code that can run unattended on a cheap VPS.
- Before adding a dependency, document what it replaces and why hand-rolling would be
  worse.
- Keep docs synchronized when changing architecture, setup, routes, commands, or product
  rules.
- If a decision is ambiguous, add it to `ARCHITECTURE.md` under open questions and ask
  before silently choosing.
- Keep commits conventional (`feat:`, `fix:`, `chore:`) when commits are requested.
