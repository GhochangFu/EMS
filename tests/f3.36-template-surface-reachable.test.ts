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
 * `F3.36` Part F — the section template authoring surface must be **reachable**,
 * not merely written.
 *
 * **This file exists because of `F3.37`'s effort correction.** That row's
 * estimate went 3–4 to 6–8 with the cause recorded: *"shipping only the write
 * endpoint would have left its own input unreachable"*. `F3.1d` had already paid
 * the same bill one row earlier — it shipped `duplicate-dashboard-dialog.tsx`
 * with five green jsdom assertions and **no page importing it**, because every
 * assertion mounted the component directly. A component spec cannot see that a
 * *different* file fails to import it, so no amount of testing the component
 * closes this. A reachability invariant is what turns "discovered at step 6"
 * into "fails the build".
 *
 * **This lives in `tests/` rather than beside the components, and that is
 * forced.** `apps/web`'s tsconfig carries no node types, so `node:fs` does not
 * compile there and `pnpm typecheck` exits 2 on a spec that reads the
 * filesystem. `tests/` is where this repository keeps static source rules, and
 * it is typechecked by `typecheck:tests`, which lists each file by hand.
 */

const APP_TSX = "apps/web/src/app.tsx";
const ADMIN_ACCESS = "apps/web/src/lib/admin-access.ts";
const LIST_PAGE = "apps/web/src/pages/admin/dashboard-templates-page.tsx";
const DETAIL_PAGE = "apps/web/src/pages/admin/dashboard-template-detail-page.tsx";
const ROLE_PICKER = "apps/web/src/components/dashboards/asset-role-binding-picker.tsx";

const LIST_ROUTE = "/admin/dashboard-templates";

describe("F3.36: the section template surface is reachable", () => {
  it("both routes are registered in the router", () => {
    const app = read(APP_TSX);
    expect(app, `${APP_TSX} could not be read`).not.toBe("");

    expect(
      app.includes(`path="${LIST_ROUTE}"`),
      `${APP_TSX} does not register ${LIST_ROUTE}. An endpoint whose only input is unreachable ` +
        "is the failure F3.37's effort correction recorded (3–4 became 6–8 because shipping " +
        "only the write endpoint left its own input unreachable).",
    ).toBe(true);

    expect(
      app.includes(`path="${LIST_ROUTE}/:templateId"`),
      `${APP_TSX} does not register the template detail route. The list alone cannot author a ` +
        "canvas, so the row would ship a surface that can only look.",
    ).toBe(true);
  });

  it("the admin navigation links to the template list", () => {
    const access = read(ADMIN_ACCESS);
    expect(
      access.includes(LIST_ROUTE),
      `${ADMIN_ACCESS} carries no navigation entry for ${LIST_ROUTE}. A registered route that ` +
        "nothing links to is reachable only by typing the URL, which is not reachable by a " +
        "person. The Asset Templates entry on line ~117 is the shape to copy.",
    ).toBe(true);
  });

  it("the list page hosts the stock catalog import affordance", () => {
    const page = read(LIST_PAGE);
    expect(page, `${LIST_PAGE} is missing`).not.toBe("");
    expect(
      /stock/i.test(page) && /import/i.test(page),
      `${LIST_PAGE} shows no stock catalog import. ADR 0049 decision 3 ships six defaults that ` +
        "an administrator IMPORTS; a catalog nothing can import from is repository data with no " +
        "way in.",
    ).toBe(true);
  });

  it("the detail page hosts the instantiate affordance and the resolution report", () => {
    const page = read(DETAIL_PAGE);
    expect(page, `${DETAIL_PAGE} is missing`).not.toBe("");
    expect(
      /instantiate/i.test(page),
      `${DETAIL_PAGE} has no instantiate affordance. A template that cannot be instantiated ` +
        "produces no dashboard.",
    ).toBe(true);
    expect(
      /resolution|matchedMembers|boundPoints|outcome/i.test(page),
      `${DETAIL_PAGE} never shows the resolution report. ADR 0049 Amendment 2 decision 1 makes ` +
        "the report non-optional, and a report the administrator never sees is the silent " +
        "success it exists to prevent. Decision 6 names this page as where an unresolved widget " +
        "gets mapped by hand: 'a page that can list exactly which ones need it'.",
    ).toBe(true);
  });

  /**
   * The `F4.43` guard, in its source form — the same shape
   * `tests/f3.37-asset-role-vocabulary.test.ts` uses for `asset-groups-page.tsx`.
   *
   * A `<select>` whose value matches no option renders its **first** option, so a
   * hardcoded role list falling behind `bms.asset_roles` does not look broken —
   * it looks like a *different role*. That is worse than a visible failure,
   * because nothing in the console, the log or the network tab says so.
   */
  it("the role picker is built from the vocabulary fetch, not from literal options", () => {
    const picker = read(ROLE_PICKER);
    expect(picker, `${ROLE_PICKER} is missing`).not.toBe("");

    expect(picker).toContain("fetchVocabularies");
    expect(picker).toContain("vocabulariesQueryKey");

    const literalOptions = [...picker.matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]);
    expect(
      literalOptions.filter((value) => value !== ""),
      `${ROLE_PICKER} spells a role code into an <option>. The set lives in bms.asset_roles and ` +
        "arrives through GET /api/v1/vocabularies; a hardcoded list that falls behind renders " +
        "the FIRST option for an unknown value, which looks like a different role rather than " +
        "like a bug. That is F4.43.",
    ).toEqual([]);
  });

  it("the section picker is built from the vocabulary too, never a hardcoded six", () => {
    const page = read(LIST_PAGE) + read(DETAIL_PAGE);
    const sectionLiterals = ["electrical", "water", "stp", "etp", "hvac", "sustainability"].filter(
      (code) => page.includes(`<option value="${code}"`),
    );
    expect(
      sectionLiterals,
      "a section code is spelled into an <option>. bms.dashboard_sections is an OPEN vocabulary " +
        "(ADR 0049 Amendment 2 decision 5) precisely so a seventh section is configuration " +
        "rather than a release — a hardcoded six takes that back, and does it invisibly.",
    ).toEqual([]);
  });
});
