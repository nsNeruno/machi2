/**
 * Locates and reads the built SPA (`apps/web/dist`), so the API can serve it as a
 * single origin — no separate frontend host, no CORS (CLAUDE.md §3, ARCHITECTURE.md
 * → "Deployment shape").
 *
 * Path is resolved relative to this compiled file (`apps/api/dist/common/spa.js`),
 * not `process.cwd()`, because `process.cwd()` differs between how this process is
 * invoked locally (`pnpm --filter @machi2/api dev`, cwd = apps/api) and how Railway's
 * `railway.json` starts it (`node apps/api/dist/main.js` from the repo root) — see
 * INFRASTRUCTURE.md §2. `__dirname` is stable across both because the build always
 * preserves the same relative layout (Nixpacks and any Docker-based fallback both
 * keep the full monorepo checkout; only the invoking cwd changes).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const WEB_DIST_PATH = join(__dirname, '..', '..', '..', 'web', 'dist');

let cachedIndexHtml: string | undefined;

/** True once `apps/web` has actually been built. False in an API-only dev setup
 * (`pnpm dev:api` alone, without ever running `pnpm --filter @machi2/web build`) —
 * that's not an error, Vite's own dev server serves the SPA in that case instead. */
export function spaDistExists(): boolean {
  return existsSync(join(WEB_DIST_PATH, 'index.html'));
}

/** Returns the built SPA's `index.html` (cached after first read), or `undefined`
 * if it hasn't been built. Callers must fall back gracefully — see
 * `not-found-page.ts` and `problem-exception.filter.ts`. */
export function readSpaIndexHtml(): string | undefined {
  if (cachedIndexHtml !== undefined) {
    return cachedIndexHtml;
  }
  if (!spaDistExists()) {
    return undefined;
  }
  cachedIndexHtml = readFileSync(join(WEB_DIST_PATH, 'index.html'), 'utf-8');
  return cachedIndexHtml;
}
