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
 * `E4.2` U11, ADR 0072 decision 1 — the **Sustainability** entry must be
 * registered and linked, not merely written.
 *
 * **This closes a gap the jsdom specs structurally cannot.**
 * `sustainability-entry-page.spec.tsx` mounts the page inside a `MemoryRouter`
 * carrying its own `<Routes>`, so whether `apps/web/src/app.tsx` registers
 * `/sustainability` is invisible to it: delete the route and every jsdom case
 * still passes while the sidebar entry lands on a blank screen. Modelled line
 * for line on `tests/f3.44-stock-dashboard-view-reachable.test.ts`.
 *
 * **It lives in `tests/` rather than beside the page, and that is forced.**
 * `apps/web`'s tsconfig carries no node types, so `node:fs` does not compile
 * there. `tests/` is where this repository keeps static source rules, it is
 * type-checked by the root `typecheck:tests` script — which lists each file by
 * hand, so this one is listed in the same change — and the root vitest `repo`
 * project globs `tests/**\/*.test.ts`, so it runs in CI without a workflow edit.
 *
 * The repo root comes from `import.meta.url`, never `process.cwd()`: a spec that
 * reads repository files through the working directory passes under
 * `pnpm --filter web` and fails under the root run, which is what CI executes.
 *
 * Per the `tests/` carve-out the assertions are inline here, with no `.spec`
 * sibling. **Nothing here reads a `packages/*` export**, so the
 * `packages/shared/dist` staleness trap (a `tests/` file reaches `@bms/shared`
 * through `createRequire` and sees the last BUILD, not the source) does not
 * apply — every read below is file text.
 */

const APP_TSX = "apps/web/src/app.tsx";
const APP_SHELL = "apps/web/src/layouts/app-shell.tsx";
const ENTRY_PAGE = "apps/web/src/pages/sustainability-entry-page.tsx";

/**
 * The filtered-list target, counted rather than merely found.
 *
 * `toContain` would pass against a file that only *mentions* the path in a
 * comment — a text scan reads docblock prose too, and this file's own docblock
 * is proof that such prose exists. One occurrence is the `<Navigate>`; the
 * page's docblock quotes the ADR without spelling the query string, so the count
 * is exact and a second, commented-out or duplicated redirect fails here.
 */
const FILTERED_LIST_TARGET = "/dashboards?section=sustainability";

const occurrences = (haystack: string, needle: string): number =>
  haystack.split(needle).length - 1;

describe("E4.2 — the Sustainability entry is reachable", () => {
  it("app.tsx registers the /sustainability route", () => {
    const app = read(APP_TSX);
    expect(app, `${APP_TSX} is missing or empty`).not.toBe("");
    expect(app).toContain('path="/sustainability"');
  });

  it("app.tsx renders SustainabilityEntryPage on that route", () => {
    const app = read(APP_TSX);
    expect(app).toContain("SustainabilityEntryPage");
    expect(app).toContain("./pages/sustainability-entry-page");
  });

  it("the sidebar lists the /sustainability path", () => {
    const shell = read(APP_SHELL);
    expect(shell, `${APP_SHELL} is missing or empty`).not.toBe("");
    expect(shell).toContain('{ label: "Sustainability", path: "/sustainability" }');
  });

  /**
   * The sidebar entry sits beside *Dashboards*, which is what ADR 0072 decision
   * 1 names ("the group that holds *Dashboards*"). Asserted by index rather than
   * by adjacency of text, so a reordering that moved it into another group
   * fails.
   */
  it("the sidebar entry follows Dashboards", () => {
    const shell = read(APP_SHELL);
    const dashboardsAt = shell.indexOf('{ label: "Dashboards", path: "/dashboards" }');
    const sustainabilityAt = shell.indexOf(
      '{ label: "Sustainability", path: "/sustainability" }',
    );
    expect(dashboardsAt, "the Dashboards entry itself is gone").toBeGreaterThan(-1);
    expect(sustainabilityAt).toBeGreaterThan(dashboardsAt);
  });

  it("the entry page navigates to the filtered list exactly once", () => {
    const page = read(ENTRY_PAGE);
    expect(page, `${ENTRY_PAGE} is missing or empty`).not.toBe("");
    expect(occurrences(page, FILTERED_LIST_TARGET)).toBe(1);
  });

  /**
   * The adjacent positive control for the count above: the one occurrence is a
   * `<Navigate>` target rather than a line of prose that happens to spell it.
   */
  it("that occurrence is a Navigate target", () => {
    const page = read(ENTRY_PAGE);
    expect(page).toContain(`<Navigate replace to="${FILTERED_LIST_TARGET}" />`);
  });
});
