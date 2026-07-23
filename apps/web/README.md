# @machi2/web

React + Vite single-page app for the arcade queue board — the public queueing UI and the
`/admin` console in one bundle. Installable as a PWA (`vite-plugin-pwa`). In production the
API serves this build from the same origin, so there is no CORS.

> Visual work is governed by `DESIGN_SYSTEM.md` (tokens) and `UI_DESIGN.md` (routes,
> screens, interactions), plus the `frontend-design` skill. Read those before building UI.
> **Never hardcode a color, size, radius, or duration** — every value comes from a design
> token so that editing a token cascades (`CLAUDE.md` §2).

## Layout

```
src/
  components/    public UI — queue board, entries, controls, cards, dialogs,
                 name field, location/game lists, app chrome, feedback
  admin/         the /admin console (admin-app.tsx) and its API client
  assets/        static assets (prettier-ignored)
  api.ts         public API client
  local-state.ts device token + local name cards (localStorage)
  time.ts        client-side service-date / time helpers
  pwa.ts         service-worker registration
  app.tsx        routes (public + /admin)
  main.tsx       entry point
  styles.css     design-token-driven global styles
```

## State & identity

- **Server state** goes through TanStack Query; **live updates** arrive over SSE and must
  keep working without a manual refresh (polling-only is a regression — `CLAUDE.md` §2).
- **No accounts.** Public identity is a self-asserted display name plus an opaque device
  token generated client-side, stored in `localStorage`, and server-signed on first sight.
  The name is shown and validated but never trusted for authorization. See `UI_DESIGN.md`
  §4a/§7.7.

## Configuration

Vite reads env from the repo root (`envDir` points there), so the same `.env` drives web
and api. Only `VITE_`-prefixed vars reach the client bundle:

| Var                     | Purpose                                              |
| ----------------------- | ---------------------------------------------------- |
| `VITE_PORT`             | dev server port (default 5173)                       |
| `VITE_API_PROXY_TARGET` | where `/api` is proxied in dev (default `:3000`)     |
| `VITE_HOST`             | set to `localhost` to keep the dev server loopback-only |

The dev server binds all interfaces by default and proxies `/api` server-side, so other
devices on the same Wi-Fi can reach it single-origin (open `http://<LAN-IP>:5173`).

## Scripts

Run from the repo root (`pnpm --filter @machi2/web <script>`) or this directory:

| Script           | Does                                    |
| ---------------- | --------------------------------------- |
| `pnpm dev`       | Vite dev server with hot reload         |
| `pnpm build`     | typecheck + `vite build` to `dist/`     |
| `pnpm test`      | Vitest unit tests                       |
| `pnpm typecheck` | `tsc --noEmit`                          |
