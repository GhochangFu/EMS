/**
 * `F3.73` plan D8 — the stock site-layout contents, behind the `./site-templates` subpath.
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
