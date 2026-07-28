/**
 * Minimal HTML shown when a browser asks for a non-`/api` path.
 *
 * Temporary: once the API serves the built SPA via `@fastify/static`
 * (ROADMAP M8), the SPA fallback owns these paths and this goes away.
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
