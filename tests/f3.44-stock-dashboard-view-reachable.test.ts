import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => {
  const path = join(repoRoot, rel);
  return existsSync(path) ? readFileSync(path, "utf8") : "";
};

/**
 * `F3.44` — the read-only stock dashboard-template viewer must be
 * **registered and linked**, not merely written.
 *
 * **This closes a gap the jsdom spec structurally cannot.**
 * `dashboard-template-stock-view-page.spec.tsx` renders the page inside a
 * `MemoryRouter` carrying its own `<Routes>`, so whether `apps/web/src/app.tsx`
 * registers the route is invisible to it: delete the route and every jsdom
 * case still passes while the View link on the card lands on a blank screen.
 * Modelled line for line on `tests/f2.14-stock-viewer-reachable.test.ts`.
 *
 * **It lives in `tests/` rather than beside the page, and that is forced.**
 * `apps/web`'s tsconfig carries no node types, so `node:fs` does not compile
 * there. `tests/` is where this repository keeps static source rules, it is
 * type-checked by the root `typecheck:tests` script — which lists each file
 * by hand, so this one is listed in the same change — and the root vitest
 * `repo` project globs `tests/**\/*.test.ts`, so it runs in CI without a
 * workflow edit.
 *
 * The repo root comes from `import.meta.url`, never `process.cwd()`: a spec
 * that reads repository files through the working directory passes under
 * `pnpm --filter web` and fails under the root run, which is what CI
 * executes.
 *
 * Per the `tests/` carve-out the assertions are inline here, with no `.spec`
 * sibling.
 *
 * **Unlike F2.14, there is no ordering trap today (plan §5.3).** The stock
 * route is four segments (`/admin/dashboard-templates/stock/:code`); its only
 * sibling under the prefix is `/admin/dashboard-templates/:templateId`, three
 * segments, so React Router v7 ranks them apart regardless of declaration
 * order. The rule this file holds is for the future: any four-segment
 * `/admin/dashboard-templates/:templateId/<x>` route added later must be
 * declared AFTER the stock route. No such sibling exists yet, so the last
 * case below is written as a fail-closed disjunction rather than an index
 * comparison — `siblingAt === -1` (no such route exists) is the legitimate
 * state today, and the day one is added it must sort after `stockAt`.
 */

const APP_TSX = "apps/web/src/app.tsx";
const LIST_PAGE = "apps/web/src/pages/admin/dashboard-templates-page.tsx";

const STOCK_ROUTE = 'path="/admin/dashboard-templates/stock/:code"';
// Anchored on the JSX `to={` so a comment or a string literal that merely
// names the path cannot keep this green once the `<Link>` is gone — the
// file-wide substring class F2.14's review flagged (`F4.38`).
const VIEWER_LINK = "to={`/admin/dashboard-templates/stock/";
// The four-segment dynamic sibling the §5.3 rule is written for. It does not
// exist today — see the docblock above.
const SIBLING_ROUTE = 'path="/admin/dashboard-templates/:templateId/';

describe("F3.44: the stock dashboard-template viewer is registered and linked", () => {
  it("the router file and the list page were read and are not empty", () => {
    // Anti-vacuity. `read` returns "" for a missing file, and every assertion
    // below would then be checking a substring of nothing — an empty read
    // must never pass as compliance.
    expect(read(APP_TSX), `${APP_TSX} could not be read`).not.toBe("");
    expect(read(LIST_PAGE), `${LIST_PAGE} could not be read`).not.toBe("");
  });

  it("registers the stock viewer route", () => {
    expect(
      read(APP_TSX).includes(STOCK_ROUTE),
      `${APP_TSX} does not register ${STOCK_ROUTE}. The page and its jsdom cases would still ` +
        "be green — that spec mounts the component under its own MemoryRouter routes — while " +
        "the View link on the stock card lands on a blank screen.",
    ).toBe(true);
  });

  it("the stock card links to the viewer", () => {
    expect(
      read(LIST_PAGE).includes(VIEWER_LINK),
      `${LIST_PAGE} carries no \`<Link ${VIEWER_LINK}…\`. A registered route that nothing links ` +
        "to is reachable only by typing the URL, which is not reachable by a person.",
    ).toBe(true);
  });

  it("declares no four-segment dynamic sibling before the stock route", () => {
    const app = read(APP_TSX);
    const stockAt = app.indexOf(STOCK_ROUTE);
    const siblingAt = app.indexOf(SIBLING_ROUTE);

    expect(stockAt, `${APP_TSX} no longer registers ${STOCK_ROUTE}`).toBeGreaterThan(-1);
    // `-1` is the legitimate "no such sibling exists" state today (plan
    // §5.3) — checked first so the disjunction below fails closed rather
    // than vacuously passing when neither route is present.
    expect(
      siblingAt === -1 || siblingAt > stockAt,
      `${APP_TSX} declares a four-segment ${SIBLING_ROUTE}… route before ${STOCK_ROUTE}. Both ` +
        "paths would rank by declaration order once such a sibling exists — the rule the " +
        "route's own §5.3 comment states — so it must be declared AFTER the stock route.",
    ).toBe(true);
  });
});
