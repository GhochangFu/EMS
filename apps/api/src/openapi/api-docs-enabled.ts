/** Environment slice that decides whether the API docs are served. */
export type ApiDocsEnv = {
  API_DOCS_ENABLED?: string | undefined;
  NODE_ENV?: string | undefined;
};

/**
 * `F4.20` / ADR 0029 Amendment 2 — whether `/api/v1/docs` exists at all.
 *
 * **Absent, not guarded.** Where this returns `false` no route is registered,
 * so there is nothing to probe and nothing to get wrong. Where it returns
 * `true` the document and the UI are served **unauthenticated** — that is the
 * point of the amendment, because Swagger UI cannot send a bearer token when it
 * fetches the spec and a guarded document is therefore unreadable from a
 * browser.
 *
 * Modelled on {@link resolveAuthMode}: an explicit variable wins, and the
 * default is chosen so that the *unsafe* direction has to be asked for.
 *
 * - `API_DOCS_ENABLED=true` → on, wherever it is set. This is the deliberate
 *   escape hatch, and setting it in production publishes the complete API
 *   inventory to anyone who can reach the port.
 * - `API_DOCS_ENABLED=false` → off, even in development.
 * - unset → on everywhere **except** `NODE_ENV=production`.
 *
 * An unset `NODE_ENV` counts as non-production, which matches how `app.module`
 * already picks its logger transport: this repo treats "production" as
 * something you declare, not something you fall into.
 */
export function areApiDocsEnabled(env: ApiDocsEnv): boolean {
  const explicit = env.API_DOCS_ENABLED?.trim().toLowerCase();
  if (explicit === "true") {
    return true;
  }
  if (explicit === "false") {
    return false;
  }
  return (env.NODE_ENV ?? "").trim().toLowerCase() !== "production";
}
