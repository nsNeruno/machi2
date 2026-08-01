# Roadmap

Work top to bottom. Each milestone should end with the app in a runnable state.

## M0 — Skeleton

Getting-started details in `DEVELOPMENT.md`.

- [x] pnpm workspace: `apps/api`, `apps/web`, `packages/shared`
- [x] NestJS + Fastify boots, `/api/health` returns 200
- [x] Vite + React boots, proxies `/api` to the API in dev
- [x] `docker-compose.yml` with `postgres:16`, API connects
- [x] Drizzle configured, first migration runs
- [x] Vitest wired in both apps, one trivial test passes

## M1 — Domain core (no UI)

- [x] Schema: `locations`, `games`, `queue_entries`, `admin_users`, grants
- [x] `ServiceDateService`: current service date for a location, tz-aware
- [x] Tests: rollover behaviour for `Asia/Jakarta` and one DST zone
- [x] `SimpleFifoStrategy` + `QueueStrategyRegistry`
- [x] Ticket number allocation, safe under concurrent insert
- [x] Seed script: one location, three games

## M2 — Public API

- [x] `GET /api/locations`, `GET /api/locations/:slug` (with per-game `waitingCount`)
- [x] `GET /api/games/:id/queue?scope=recent|all` (recent = latest 10)
- [x] `POST /api/games/:id/queue` (enqueue)
- [x] `POST /api/queue-entries/:id/done`
- [x] Queue entry DTO includes `mine`; board payload includes `requireApprovalForOthers` + `boardMode`
- [x] `nameSchema` (grapheme-aware, CJK-allowed, max 8) in `packages/shared`, used both sides
- [x] Board mode per game (`self_serve` default | `now_playing`); approval flag per location
- [x] Auto re-queue: `auto_requeue` on entries; `complete()` re-queues on `played`, inherits flag, respects max len, exempt from cooldown
- [x] Audit fields: `done_by_token_hash`, `done_by_name`, `done_by_role`, `requeued_from`; DTO exposes `createdAt`, `doneAt`, `doneByName`/`doneByRole`, `roundNumber` (never raw hashes)
- [x] `done` accepts `actingName?`; server requires a name or staff/admin auth, but never authorizes on the name
- [x] Open-board guardrail: tighter per-device throttle on marking _others'_ entries
- [x] Community note storage and public read payload (the authenticated editor belongs in M7)
- [x] Device token issuance + HMAC verification
- [x] Idempotency-Key handling on both write endpoints
- [x] Zod schemas live in `packages/shared`, used on both sides

## M3 — Throttling

- [x] `@nestjs/throttler` with named tiers per §6 of CLAUDE.md
- [x] Composite key: IP + device token
- [x] Domain limits: one active entry per device per game, `max_queue_len`, re-enqueue cooldown
- [x] Partial unique index enforcing the one-active-entry rule at the DB level
- [x] Tests hitting each limit boundary

## M4 — Realtime

- [x] `QueueEventsService` (in-process EventEmitter)
- [x] `GET /api/games/:id/stream` SSE endpoint, heartbeat every 25s
- [x] Publish after commit on every mutation
- [x] 60s tick detecting day rollover per location → `day-rollover` event
- [x] Per-IP concurrent stream cap

## M5 — Public UI

Build to `UI_DESIGN.md`. Read `DESIGN_SYSTEM.md` and the `frontend-design` skill before writing components.

- [x] Establish design tokens from `DESIGN_SYSTEM.md` (CSS vars / Tailwind theme), light + dark; components reference tokens only
- [x] First-run onboarding: require creating one name card before acting; sets active card
- [x] Active-card identity: wallet shows/switches active card; actions attach its name
- [x] Global shell: header, name-card wallet drawer, connection banner
- [x] Device-local storage model (name cards, prefs, device token), versioned
- [x] `/` landing (location list, active/closed state, and location-local clock; opening hours are not modeled)
- [x] `/l/:slug` game list with live `waitingCount` and depth bars
- [x] `/cards` + name-card drawer (local only)
- [x] Queue board `/l/:slug/g/:id`: self_serve default (self-mark played, no slot to clear)
- [x] `now_playing` board-mode variant (explicit current-player card + clear step)
- [x] Self-mark "I'm up" fast path (one tap = played); picker for other reasons
- [x] Auto re-queue: "re-join after I play" checkbox (remembered per card) + repeat indicator on entries
- [x] Entry meta line: join/done times + actor role; shared relative-time formatter (s / m / HH:mm in location tz), one ~10s tick for all rows
- [x] Integrity notice shown when approval is off; hidden when approval on
- [x] Done entries: strikethrough + labeled status tag + legend (icon+word, not color alone)
- [x] Board layout switch: list / table / checklist / cards (remembered per device)
- [x] Board order switch: up next (default) / as added — insertion order, done struck in place (client-side, remembered per device)
- [x] Join: dialog form (tap-to-fill from cards) + dnd-kit drag-to-join, tap fallback authoritative
- [x] Mark done: swipe + check button → reason picker, conditional staff-PIN field when approval on
- [x] Community note block with its own "last updated", hidden when empty
- [x] SSE subscription driving TanStack Query cache updates
- [x] Connection state banner (live / reconnecting / offline)
- [x] Optimistic join and done with rollback + toast
- [x] `prefers-reduced-motion` and local reduceMotion pref respected

## M6 — PWA

- [x] `vite-plugin-pwa`, manifest, icons, maskable icon
- [x] Precache app shell only; explicitly exclude `/api/*`
- [x] Install prompt handling
- [ ] Verify installability on Android Chrome and iOS Safari (iOS needs manual testing)

## M7 — Admin console

Build to `UI_DESIGN.md` §8.

- [x] Email + password login, argon2, httpOnly SameSite=strict session cookie, CSRF token
- [x] Auth rate limiting + lockout; generic failure message
- [x] Roles: `superadmin` (all) / `operator` (granted locations only), enforced server-side
- [x] Admin shell: section nav + location list, scoped to what the account can see
- [x] Location CRUD: name, slug (live uniqueness), address, IANA timezone picker, active
- [x] Location: `require_approval_for_others` toggle + write-only staff PIN (argon2)
- [x] Game CRUD: name, cabinet_label, board_mode, max_queue_len, active, sort_order
- [x] Queue strategy shown but locked to `simple_fifo`
- [x] Community note editor: `PUT /api/admin/games/:id/community-note`, body, visible toggle, auto-stamped last-updated + author
- [x] Live queue view: done shown, `as_added` available, actor meta visible
- [x] Admin actions: mark entry (role=admin), delete entry (error removal), clear queue (confirmed)
- [x] Admin users + grants management (superadmin only); password reset; deactivate over delete
- [x] Destructive actions behind typed/explicit confirmation naming the target
- Session cookie is opaque, hashed in the `admin_sessions` table (migration `0002`); cookie
  handling is hand-rolled (no `@fastify/cookie` dependency for one cookie). Login lockout is
  in-memory (single-process by design). Admin queue view polls every 5s; public boards still
  update over SSE on every admin action. Seed creates a superadmin (`ADMIN_SEED_*` env).

## M7.5 — Cost & load self-governance

- [x] `LoadGovernorService` on a short tick, reading local signals only
      (request rate, enqueue rate, open SSE count, process RSS, event-loop lag)
- [x] Four levels — normal / elevated / shed / maintenance — with hysteretic recovery
- [x] Shed level: writes return 503 + Retry-After, reads still serve (queue stays viewable)
- [x] Governor state in memory, mirrored to one Postgres row (`app_meta`), readable by admin console
- [x] `POST /api/admin/maintenance { level, reason }` manual override + console toggle
- [ ] Cloudflare rate-limiting rule on `POST /api/*` + cache rule serving a static page on 503 — infra (see M8)
- [ ] Daily reconciliation cron vs Railway's usage API + budget — not optional here, Railway
      (the primary target) is metered, so this is load-bearing rather than a metered-host
      nice-to-have — infra
- [x] Tests: each threshold trips the right level; recovery waits out the cooldown
- Manual override can only _raise_ the effective level, never mask a real overload. Admin
  routes and reads are never shed, so staff can always operate and lift maintenance.

## M7.6 — Location-gated public queue changes

- [x] Optional latitude/longitude and per-location validation radius (default 5 m)
- [x] Admin location editor enables validation with a complete coordinate pair
- [x] Queue-board location status with automatic check and recoverable retry states
- [x] Every public join/done validates a fresh position with accuracy ≤20 m; admin exempt
- [x] Player coordinates remain transient; reads and unconfigured locations stay ungated
- [x] Tests cover distance/accuracy boundaries, idempotency recovery, staff PIN, and admin exemption

## M8 — Ship

Primary target is Railway (Hobby plan, $5/mo minimum usage) as of 2026-07-23 — see
`ARCHITECTURE.md` → Deployment for why, and `INFRASTRUCTURE.md` for the full runbook.

- [ ] `railway.json`: Nixpacks build, `/api/health` healthcheck, `numReplicas: 1`,
      **`sleepApplication: false`** (app sleeping would kill every SSE connection)
- [ ] Railway project: API service (serves the built SPA via `@fastify/static`) + a
      Postgres service on the project's private network
- [ ] Custom domain on the API service + Cloudflare CNAME; confirm SSL/TLS mode is
      Full (strict); `TRUST_PROXY=1` set (Railway terminates TLS at its own edge)
- [ ] Cloudflare in front, Bot Fight Mode on, plus a genuinely conservative rate-limit
      rule on `POST /api/*` — load-bearing here since Railway is metered, not just abuse
      control
- [ ] Nightly `pg_dump` via a scheduled GitHub Actions workflow (no VM to cron on) to
      Cloudflare R2, 14-day retention — and one tested restore
- [ ] Nightly cleanup job: delete `queue_entries` older than 7 days
- [x] Initial-admin bootstrap: on first boot the API creates a superadmin from
      `ADMIN_SEED_*` if none exists (idempotent; never overrides a changed password).
      Admin access works immediately after deploy without running the dev seed.
- [ ] CI builds + pushes the multi-arch (`linux/amd64` + `linux/arm64`) image to GHCR on
      every `main` build, kept perpetually green even though Railway deploys from source
      via Nixpacks and never consumes it — this standing job is what keeps the self-hosted
      fallbacks (Appendix A) a same-day swap rather than a from-scratch CI setup at the
      worst possible moment (CLAUDE.md §3, §3b.6)
- [ ] Structured logging + an uptime check (`https://yourdomain/api/health`)
- [ ] Railway's opt-in hard spending limit set + the M7.5 reconciliation cron pointed at
      Railway's GraphQL usage API before calling it live
- [ ] Verify the portability contract (CLAUDE.md §3b) holds before calling it done

Oracle Always Free / paid-VPS fallback **deploy** steps (Caddyfile, `docker-compose.yml`,
dual firewall, SSH-based `docker compose pull`) are unchanged but now live in
`INFRASTRUCTURE.md` Appendix A — only exercised if migrating off Railway. Note the
multi-arch GHCR image build itself is **not** deferred: it runs continuously on the
Railway path too (the item above), so those fallback deploy steps have an image waiting
the day they're needed.

## Deliberately later

- Additional queue strategies (timed slots, party/group, reservation windows)
- Per-location branding
- Historical usage stats
- QR codes per cabinet deep-linking to that game's queue
- Push notifications ("you're next")
