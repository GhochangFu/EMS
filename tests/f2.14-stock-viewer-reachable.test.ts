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
 * `F2.21`'s browser pass confirmed the deep link — but *this file* no longer
 * said why the link ever renders. A guard that reads stronger than it is gets
 * trusted at face value, so the registry case below holds the other half.
 *
 * **Two things this does NOT claim, because the first draft claimed both.**
 *
 * The registry entry was never ungated. Delete it and
 * `apps/web/src/lib/asset-templates-page-tabs.spec.ts` reddens in four places,
 * and `pnpm typecheck` fails as well, since `id` is required. What was missing
 * was not coverage of the entry; it was the **reachability** chain, which is
 * the rule this file owns and the reason it sits in `tests/` beside
 * `f3.36-template-surface-reachable.test.ts`.
 *
 * And the chain is still not held by static text alone. `asset-templates-page.tsx`
 * passes `visibleAssetTemplatesPageTabs(mayAuthor)` to the strip, and nothing
 * here stops a future edit hardcoding that prop — the tab would vanish with
 * every case in this file green. That link is held behaviourally, by the page's
 * own jsdom spec, which clicks the tab and asserts the heading. Naming it is
 * the point: `F4.92` exists because a guard overstated its reach, and repeating
 * the overstatement one layer up would be the same defect.
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
// Anchored on `id:`, not on the bare string `"stock"`, and searched inside the
// array literal rather than file-wide. Both halves are needed and neither is
// sufficient:
//
// - a bare `"stock"` scan survives every mutation, because the file also
//   declares `AssetTemplatesPageTabId` as a union containing that string;
// - a file-wide `id: "stock"` scan survives deletion of the entry if any prose
//   replaces it, and that is not hypothetical — the file's own docblock already
//   writes `id: "templates"` in a sentence, so a note saying where the stock tab
//   went would keep this green while the tab is gone. `F4.38`'s class, the same
//   one `VIEWER_LINK` above is anchored against.
//
// **The residual limit, stated rather than papered over**: a comment placed
// INSIDE the array literal still passes. Closing that needs a parser, which is
// more than this rule is worth — so the slice is the anchor, and this sentence
// is the honest bound on it.
const TABS_ARRAY_DECL = "export const ASSET_TEMPLATES_PAGE_TABS";
const TABS_ARRAY_OPEN = "= [";
const TABS_ARRAY_CLOSE = "];";
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
    // the substring proves the link EXISTS, not that a person can reach it.
    //
    // The registry is the half that was missing HERE. `asset-templates-page.tsx`
    // derives its strip from `visibleAssetTemplatesPageTabs(mayAuthor)` — a
    // FILTER of `ASSET_TEMPLATES_PAGE_TABS`, not the constant itself — and
    // `resolveAssetTemplatesPageTab` falls back to `templates` for any id the
    // array does not contain. So with no entry the card mounts by no route at
    // all: not by click, and not by `?tab=stock` either.
    const source = read(PAGE_TABS);
    const declAt = source.indexOf(TABS_ARRAY_DECL);
    const openAt = source.indexOf(TABS_ARRAY_OPEN, declAt);
    const closeAt = source.indexOf(TABS_ARRAY_CLOSE, openAt);

    // Each index is checked for `-1` before the slice, the same idiom as the
    // route-ordering case above: `slice(-1, -1)` is `""`, and an empty string
    // contains no needle, so a renamed constant would read as a deleted entry
    // and report the wrong cause.
    expect(declAt, `${PAGE_TABS} no longer declares \`${TABS_ARRAY_DECL}\``).toBeGreaterThan(-1);
    expect(openAt, `${PAGE_TABS}'s tab array has no \`${TABS_ARRAY_OPEN}\``).toBeGreaterThan(-1);
    expect(closeAt, `${PAGE_TABS}'s tab array is not closed`).toBeGreaterThan(-1);

    expect(
      source.slice(openAt, closeAt).includes(STOCK_TAB_ENTRY),
      `${PAGE_TABS} declares no \`${STOCK_TAB_ENTRY}\` entry in ASSET_TEMPLATES_PAGE_TABS. The ` +
        "page's strip is a filter of that array and the `?tab=` resolver falls back to " +
        "`templates` for anything absent from it, so without the entry the stock card — and " +
        "the `<Link>` the case above asserts on — never mounts, by click or by URL.",
    ).toBe(true);
  });
});
