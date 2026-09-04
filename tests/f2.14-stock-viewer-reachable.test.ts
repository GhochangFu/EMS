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
 * `F2.14` — the read-only stock catalog viewer must be **registered and linked**,
 * not merely written.
 *
 * **This closes a gap the jsdom spec structurally cannot.**
 * `asset-template-stock-view-page.spec.tsx` renders the page inside a
 * `MemoryRouter` carrying its own `<Routes>`, so whether `apps/web/src/app.tsx`
 * registers the route is invisible to it: delete the route and all seven cases
 * still pass while the View link lands on a blank screen. That is the same
 * class of failure `tests/f3.36-template-surface-reachable.test.ts` was written
 * for, and this file is modelled on it.
 *
 * **It lives in `tests/` rather than beside the page, and that is forced.**
 * `apps/web`'s tsconfig carries no node types, so `node:fs` does not compile
 * there. `tests/` is where this repository keeps static source rules, it is
 * type-checked by the root `typecheck:tests` script — which lists each file by
 * hand, so this one is listed in the same change — and the root vitest `repo`
 * project globs `tests/**\/*.test.ts`, so it runs in CI without a workflow edit.
 *
 * The repo root comes from `import.meta.url`, never `process.cwd()`: a spec
 * that reads repository files through the working directory passes under
 * `pnpm --filter web` and fails under the root run, which is what CI executes.
 *
 * Per the `tests/` carve-out the assertions are inline here, with no `.spec`
 * sibling.
 *
 * ## `F4.92` — the link assertion stopped standing on its own
 *
 * `F2.21` put the stock card on a tab, so the `<Link>` this file scans for now
 * renders **only while the stock tab is selected**. The substring check stayed
 * green and reachability still held — the tab is offered to any author, and
 * `F2.21`'s browser pass confirmed the deep link — but the static chain had a
 * missing link in the middle: "the tab is offered, **therefore** the link
 * renders". A guard that reads stronger than it is gets trusted at face value,
 * so the registry case below holds the other half.
 */

const APP_TSX = "apps/web/src/app.tsx";
const LIST_PAGE = "apps/web/src/pages/admin/asset-templates-page.tsx";
const PAGE_TABS = "apps/web/src/lib/asset-templates-page-tabs.ts";

const STOCK_ROUTE = 'path="/admin/asset-templates/stock/:code"';
const VERSIONS_ROUTE = 'path="/admin/asset-templates/:templateId/versions"';
// Anchored on the JSX `to={` so a comment or a string literal that merely
// names the path cannot keep this green once the `<Link>` is gone — the file-
// wide substring the F2.14 code review flagged (`F4.38`'s class).
const VIEWER_LINK = "to={`/admin/asset-templates/stock/";
// Anchored on the registry entry's own `id:` property, not on the bare string
// `"stock"`. That file also declares
// `AssetTemplatesPageTabId = "templates" | "stock"`, so a bare-substring scan
// would stay green with the entry itself deleted — which is exactly the
// mutation this case has to go red on.
const STOCK_TAB_ENTRY = 'id: "stock"';

describe("F2.14: the stock catalog viewer is registered and linked", () => {
  it("the router file was read and is not empty", () => {
    // Anti-vacuity. `read` returns "" for a missing file, and every assertion
    // below would then be checking a substring of nothing — an empty read must
    // never pass as compliance.
    expect(read(APP_TSX), `${APP_TSX} could not be read`).not.toBe("");
    expect(read(LIST_PAGE), `${LIST_PAGE} could not be read`).not.toBe("");
    expect(read(PAGE_TABS), `${PAGE_TABS} could not be read`).not.toBe("");
  });

  it("registers the stock viewer route", () => {
    expect(
      read(APP_TSX).includes(STOCK_ROUTE),
      `${APP_TSX} does not register ${STOCK_ROUTE}. The page and its seven jsdom cases would ` +
        "still be green — that spec mounts the component under its own MemoryRouter routes — " +
        "while the View control on the stock card lands on a blank screen.",
    ).toBe(true);
  });

  it("declares the stock route BEFORE the versions route", () => {
    const app = read(APP_TSX);
    const stockAt = app.indexOf(STOCK_ROUTE);
    const versionsAt = app.indexOf(VERSIONS_ROUTE);

    // Both indices are checked for `-1` first. `indexOf` returns `-1` for an
    // absent route, and `-1 < versionsAt` is true — so without this the
    // ordering assertion would pass on a router that registers neither.
    expect(stockAt, `${APP_TSX} no longer registers ${STOCK_ROUTE}`).toBeGreaterThan(-1);
    expect(versionsAt, `${APP_TSX} no longer registers ${VERSIONS_ROUTE}`).toBeGreaterThan(-1);
    expect(
      stockAt,
      `${APP_TSX} declares the stock viewer route after ${VERSIONS_ROUTE}. Both paths are four ` +
        "segments with one static and one dynamic part, so a URL matching both resolves by " +
        "declaration order. `asset-templates.controller.ts` carries the same rule one layer up " +
        '("@Get(\\"stock\\") IS DECLARED BEFORE @Get(\\":id\\"), AND THE ORDER IS LOAD-BEARING").',
    ).toBeLessThan(versionsAt);
  });

  it("the stock card links to the viewer", () => {
    expect(
      read(LIST_PAGE).includes(VIEWER_LINK),
      `${LIST_PAGE} carries no \`<Link ${VIEWER_LINK}…\`. A registered route that nothing ` +
        "links to is reachable only by typing the URL, which is not reachable by a person — the " +
        "gap F3.37's effort correction recorded and F3.36's guard exists to stop.",
    ).toBe(true);
  });

  it("offers the stock tab, which is what makes that link render", () => {
    // `F4.92`. The case above scans the list page as one string, and since
    // `F2.21` that page renders the `<Link>` only under `tab === "stock"`. So
    // the substring proves the link EXISTS, not that a person can get to it.
    // The registry is the other half: `visibleAssetTemplatesPageTabs` renders
    // exactly the entries in `ASSET_TEMPLATES_PAGE_TABS`, so no entry means no
    // tab, and no tab means the link never mounts.
    expect(
      read(PAGE_TABS).includes(STOCK_TAB_ENTRY),
      `${PAGE_TABS} declares no \`${STOCK_TAB_ENTRY}\` entry. The tab strip renders exactly ` +
        "`ASSET_TEMPLATES_PAGE_TABS`, so without it the stock card — and the `<Link>` to the " +
        "viewer the case above asserts on — never mounts, and the viewer is reachable only by " +
        "typing the URL. The two cases hold one chain and neither one holds it alone.",
    ).toBe(true);
  });
});
