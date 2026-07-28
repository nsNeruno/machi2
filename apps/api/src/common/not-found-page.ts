/**
 * Minimal HTML shown when a browser asks for a non-`/api` path and the SPA hasn't
 * been built (`apps/web/dist` missing — see common/spa.ts). Normal production
 * deploys never hit this: `ProblemExceptionFilter` serves the real SPA `index.html`
 * instead once it exists. This is only what API-only setups (e.g. `pnpm dev:api`
 * run alone, without ever building `apps/web`) fall back to.
 * Deliberately unstyled beyond `color-scheme` — it cannot reach the
 * design tokens, so it must not invent colours of its own (CLAUDE.md §2).
 */
export function renderNotFoundPage(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>404 — Not available</title>
    <style>
      :root { color-scheme: light dark; }
      body {
        font-family: system-ui, sans-serif;
        line-height: 1.5;
        margin: 0 auto;
        max-width: 34rem;
        padding: 3rem 1.25rem;
      }
      h1 { font-size: 1.5rem; margin: 0 0 0.75rem; }
      p { margin: 0 0 0.75rem; }
      code { font-size: 0.95em; }
    </style>
  </head>
  <body>
    <h1>404 — Not available</h1>
    <p>This address is not available on this server. The queue API is running,
      but nothing is served at this path.</p>
    <p>Health check: <a href="/api/health"><code>/api/health</code></a></p>
  </body>
</html>
`;
}
