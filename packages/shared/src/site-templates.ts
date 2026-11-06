/**
 * `F3.73` plan D8 — the stock site-layout contents, behind the `./site-templates` subpath (and,
 * since `F4.317`, the stock organization strip).
 *
 * **Not re-exported from `index.ts`, and that is the point of the file.** The web bundle reaches
 * `@bms/shared` through the index (`apps/web/vite.config.ts` aliases it to `src/index.ts`), so a
 * module the index does not export never enters the bundle: the browser reads a stock template
 * through `GET /admin/dashboard-templates/stock`, never by importing it. The two readers are
 * `apps/api`'s stock catalog and `packages/db`'s site-layout seed.
 *
 * **Two manifest keys publish it, not one.** `exports` serves the runtime (Node's `require`
 * honours it) and vitest. `typesVersions` serves `tsc`: `apps/api` and `packages/db` compile with
 * `moduleResolution: "node"` (node10), which ignores `exports` entirely — the reason the index
 * re-exports `./ingest` — so without it the subpath import is a `TS2307`.
 */
export { SMOC_STANDARD_SITE_TEMPLATE } from "./site-templates/smoc-standard";
// `F4.317` (ADR 0112 decision 3) — the stock organization strip, and the organization page's fail-safe.
export { ORGANIZATION_STANDARD_TEMPLATE } from "./site-templates/organization-standard";
// `F4.319` (ADR 0113 decision 7) — the stock pump-station site layout.
export { PUMP_STATION_STANDARD_SITE_TEMPLATE } from "./site-templates/pump-station-standard";
