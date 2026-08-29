import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

/**
 * ADR 0038 decision 2, as amended: the template detail page has **exactly six**
 * tabs — Details, Points, Calculations, KPIs, Alarms, Dashboards — and no tab
 * for a content section the API will not accept.
 *
 * The count was five until `F3.1e`. **Amendment 4 (2026-08-29) moved it to
 * six**, discharging the condition decision 2 wrote for itself — *"It becomes a
 * tab when `F3.1` gives it widgets"* — after `F3.1a` gave `content.dashboards`
 * widgets in `b0b4f3f`. The number moves by amendment, once, with a reason.
 * Never by editing this file to make a new tab pass.
 *
 * ## Why a source scan, when `template-tabs.spec.ts` already asserts the ids
 *
 * The spec reads the exported array at runtime. It proves the registry the app
 * ships behaves correctly, and it would keep passing if a seventh tab were added
 * to the array *and* to the spec's expected list — which is what a well-meaning
 * "add another tab" change looks like, since a red test is an invitation
 * to update it. This reads the **source text**, so the number six is asserted
 * somewhere the person adding a tab is not already editing.
 *
 * The two overlap on purpose and neither replaces the other: behaviour there,
 * text here.
 *
 * ## What is NOT here
 *
 * The other half of ADR 0038's static promise — that
 * `components/asset-templates/formula-editor.tsx` is the only module allowed to
 * import CodeMirror — lives in `tests/adr-0038-formula-editor.test.ts`. It was
 * written in Unit 5, when the lazy split was built, because the split needed
 * guarding the moment it existed. It is not repeated here.
 *
 * ## CI needs no change, and that is deliberate
 *
 * The root `vitest.config.ts` `repo` project globs `tests/**\/*.test.ts`, so
 * this file runs from the commit that adds it. `.github/workflows/ci.yml`
 * already runs `pnpm typecheck`, `pnpm typecheck:tests` and
 * `pnpm test:coverage`. There is no new script and no new suite runner.
 *
 * The one wiring this file *does* need is by hand: `tests/` has no
 * `tsconfig.json`, so nothing typechecks this file until its name is appended
 * to the root `typecheck:tests` script. `tests/repo-invariants.test.ts`
 * enforces that, and it went red on this file before the script was edited.
 */

const BLOCK_COMMENT = new RegExp(["/", "\\*", "[\\s\\S]*?", "\\*", "/"].join(""), "g");
const LINE_COMMENT = /\/\/.*$/gm;

/**
 * Strips comments before any scan.
 *
 * `template-tabs.ts` documents its own extraction regex inside its docblock and
 * describes the deferred sections in prose. Without this, the scan would be
 * reading the explanation as if it were code.
 */
function stripComments(source: string): string {
  return source.replace(BLOCK_COMMENT, "").replace(LINE_COMMENT, "");
}

describe("ADR 0038 decision 2 + Amendment 4 — the tab registry declares exactly six tabs", () => {
  // `apps/web/src/lib/template-tabs.ts`, not the strip that renders it. The
  // plan put the registry in `template-tab-strip.tsx`; Unit 7 moved it here so
  // `resolveTemplateTab` would be reachable by a test at all, and the module's
  // docblock records the move in bold for exactly this reader.
  const rel = "apps/web/src/lib/template-tabs.ts";
  const raw = readFileSync(join(repoRoot, rel), "utf8");
  const source = stripComments(raw);

  const EXPECTED = ["details", "points", "calculations", "kpis", "alarms", "dashboards"];

  /**
   * The registry entries, and nothing around them.
   *
   * Captured from `= [` to `];` so the shape guard below cannot trip on
   * `readonly TemplateTab[]` in the declaration, and so `resolveTemplateTab`'s
   * own `TEMPLATE_TABS.find(...)` stays outside the scan.
   */
  const blockMatch = source.match(/export const TEMPLATE_TABS[^=]*=\s*\[([\s\S]*?)\];/);
  const block = blockMatch ? blockMatch[1] : "";
  const ids = [...block.matchAll(/\bid:\s*"([a-z]+)"/g)].map((match) => match[1]);

  it("found the registry, so every scan below reads something", () => {
    expect(source, `${rel} did not survive comment stripping`).toContain(
      "export const TEMPLATE_TABS",
    );
    expect(blockMatch, `the array literal in ${rel} no longer matches the extraction`).not.toBeNull();
    // The guard the whole file turns on. A registry rewritten so that `id:` no
    // longer appears — renamed to `tabId`, or built from another module —
    // returns an empty list here, and every assertion below would then pass by
    // reading nothing at all.
    expect(
      ids.length,
      `extracted no tab ids from ${rel}. The scan is broken, not the registry: ` +
        "the entries must stay a flat array of object literals with a bare " +
        '`id: "name"` first. Fix the registry shape or fix this regex — an ' +
        "empty scan must never read as compliance.",
    ).toBeGreaterThan(0);
  });

  it("declares six tabs, with the six ADR 0038 ids, in the ADR's order", () => {
    expect(ids).toEqual(EXPECTED);
    // Asserted separately from the list so a count drift and a rename read as
    // different failures.
    expect(ids.length, "ADR 0038 Amendment 4 names six tabs and only six").toBe(6);
    // Each entry is one object literal. A second source of the same number,
    // which catches an entry that lost its `id` rather than the whole entry.
    expect(
      (block.match(/\{/g) ?? []).length,
      "one object literal per tab — an entry without an id would not be counted above",
    ).toBe(6);
  });

  it("has no tab for a reserved or deferred content section", () => {
    // **This is a message, not an independent gate, and it is written down so
    // that nobody reads it as one.** Any reserved id in the array already
    // breaks the exact-list assertion above, so this can never fail alone —
    // verified by mutation: adding a `dashboards` tab fails both. It earns its
    // place by naming the section and the reason, where the list comparison
    // reports only that two arrays differ.
    //
    // Checked over the extracted ids, never over the source text. `hint:`
    // strings are free to mention a deferred section, and one of them may yet
    // need to; a substring scan would go red on the explanation and the fix
    // would be to weaken this test.
    //
    // `optimization` sits beside `optimisation` because the repository uses the
    // British spelling (see `template-content-merge.ts`), which makes the
    // American one the plausible typo rather than an impossible one.
    // `dashboards` left this list in `F3.1e` under ADR 0038 Amendment 4, which
    // discharged decision 2's own condition — *"It becomes a tab when `F3.1`
    // gives it widgets"* — after `F3.1a` gave it widgets. Exactly one entry was
    // removed; the rest of this loop is untouched and must stay that way.
    for (const closed of ["health", "optimisation", "optimization", "maintenance"]) {
      expect(
        ids,
        `${closed} has no tab in ADR 0038. The two reserved keys are refused by ` +
          "templateContentSchema, so a tab for either would always error.",
      ).not.toContain(closed);
    }
  });

  it("the TemplateTabId union names the same six ids and no more", () => {
    // The array's element type is what keeps a seventh entry from compiling. That
    // protection is only as strong as the union: widen it to `string`, or add a
    // name to it, and the array can hold anything with `tsc` silent. Nothing
    // else in the repository asserts this line.
    const union = source.match(/export type TemplateTabId\s*=\s*([^;]+);/);
    expect(union, "TemplateTabId is no longer a single-line union of string literals").not.toBeNull();

    const declared = [...(union?.[1] ?? "").matchAll(/"([a-z]+)"/g)].map((match) => match[1]);
    expect(declared, "the union must be a closed set of the six tab ids").toEqual(EXPECTED);
    expect(declared, "the union and the array must name the same tabs").toEqual(ids);
  });

  it("the registry stays a flat literal, so this scan keeps meaning something", () => {
    // `template-tabs.ts`'s docblock promises the entries are a flat array
    // literal with no spread, no computed key and no construction from another
    // module. Nothing held that promise until now — and the promise is what
    // makes a text scan able to see the tabs at all. A registry built with
    // `.map()` would leave the assertions above reading an empty list, which
    // the guard catches, but with a message about a broken regex rather than
    // about the change that actually caused it.
    // A computed key is deliberately **not** in this list. `[KEY]: "details"`
    // leaves no literal `id:` for the extraction to find, so the anti-vacuity
    // guard already catches it — while a `[` here would go red the first time a
    // `hint` needs a bracket, for no defect, and the fix would be to weaken
    // this test.
    for (const construction of ["...", ".map(", ".concat(", ".filter(", "`"]) {
      expect(
        block,
        `the registry entries must stay literal — found ${construction}. Building them ` +
          "from anything else makes the six-tab limit unenforceable by a source scan.",
      ).not.toContain(construction);
    }
  });

  it("the recipe the module documents returns the same ids as the scan above", () => {
    // `template-tabs.ts` tells the next editor to re-run a whole-file form of
    // this extraction after changing the registry's shape. That advice is only
    // correct while no second `id: "..."` exists elsewhere in the file, so it
    // is asserted rather than trusted.
    const documented = [...source.matchAll(/\bid:\s*"([a-z]+)"/g)].map((match) => match[1]);
    expect(
      documented,
      `the extraction documented in ${rel} no longer agrees with the array. Update the docblock.`,
    ).toEqual(ids);
  });
});

/**
 * ADR 0038 decision 10 — the residual 403 renders **the sentence**.
 *
 * D10 says the organization-scope case "falls through to the API's 403,
 * rendered inline. The message the service already writes … is the right one."
 *
 * Two separate things had to be true for that, and only the first was:
 *
 * 1. The branch must run. It could not until `F4.52` — `adminFetch` saw the
 *    403, `clearSessionOnAuthFailure` treated it as an authentication failure,
 *    and the session was gone before React rendered anything.
 * 2. It must show the message, not the envelope around it. `adminFetch` throws
 *    `new Error(text)` with the **whole body**, so rendering `.message` raw put
 *    `{"message":"…","error":"Forbidden","statusCode":403}` on screen. Measured
 *    in the browser as `phe-admin@bms.local`, once the session survived long
 *    enough to see it.
 *
 * This is a source-text invariant for the same reason the rest of this file
 * is: the surface is `.tsx`, and `apps/web`'s Vitest project runs
 * `environment: "node"` over `src/**` + `*.test.ts`, so no component test can
 * reach it. Adding one needs `jsdom` and a §9.4 dependency ADR. Until then a
 * text scan is what stands between this and a silent regression — the render
 * fix shipped with no gate at all, which the `F4.52` correctness review proved
 * by reverting the line and watching 312 tests stay green.
 */
describe("ADR 0038 decision 10 — the 403 renders the service's sentence", () => {
  const rel = "apps/web/src/pages/admin/asset-template-detail-page.tsx";
  const raw = readFileSync(join(repoRoot, rel), "utf8");
  const source = stripComments(raw);

  // The load-error branch only: `templateQ.isError` to the end of the `<p>`
  // that renders it. Scoped so the tab-save handlers, which have always used
  // `apiErrorMessage`, cannot satisfy an assertion about this branch.
  const branchMatch = source.match(/if\s*\(templateQ\.isError[\s\S]*?<\/p>/);
  const branch = branchMatch ? branchMatch[0] : "";

  it("found the load-error branch, so the scans below read something", () => {
    // Without this the two assertions pass over an empty string — the failure
    // mode this whole file exists to prevent.
    expect(
      branchMatch,
      `could not find the load-error branch in ${rel}. The scan is broken, not ` +
        "necessarily the page: it expects `if (templateQ.isError` followed by the " +
        "closing `</p>` of the message. Fix the regex or the branch — an empty " +
        "scan must never read as compliance.",
    ).not.toBeNull();
  });

  it("renders the message through apiErrorMessage, not the raw body", () => {
    expect(
      branch,
      `${rel}'s load-error branch does not call apiErrorMessage. ADR 0038 D10 asks ` +
        "for the sentence the service writes; adminFetch throws the whole response " +
        "body, so rendering it directly shows " +
        '{"message":"Template is outside your access scope","error":"Forbidden",' +
        '"statusCode":403} to the author instead.',
    ).toContain("apiErrorMessage");

    // The specific revert this guards against — the shape the line had before
    // `F4.52`, and the shape a future edit would most plausibly reintroduce.
    expect(
      branch,
      `${rel}'s load-error branch reads .message off the error directly. That is ` +
        "the whole JSON envelope, not the message. Pass the error to " +
        "apiErrorMessage instead.",
    ).not.toMatch(/templateQ\.error[^)]*\)?\s*\??\.\s*message/);
  });
});
