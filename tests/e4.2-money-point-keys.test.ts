import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * `@bms/shared` through `createRequire`, for the reason
 * `tests/adr-0070-calc-v3-invariants.test.ts` gives at its own top: the `tests` project runs
 * from the repo root, where the resolver has no workspace link to `@bms/shared`. A static
 * import fails at collection here (proved: "Cannot find package '@bms/shared'"), and on CI's
 * clean install it fails the typecheck too. The type is declared locally for the same reason.
 */
const require_ = createRequire(import.meta.url);
const { MONEY_POINT_KEY_CODES } = require_("@bms/shared") as {
  MONEY_POINT_KEY_CODES: readonly string[];
};

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

const UNITS_REL = "packages/db/src/point-key-units.ts";

/**
 * `E4.2` PR 1 sweep review — `MONEY_POINT_KEY_CODES` is the ONE list that decides whether a
 * `sustainability.total` tile carries the organization's currency
 * (`apps/api/src/dashboard-builder/sustainability-rollup.ts`, `isMoneyPointKey`). The unit
 * cannot decide it: `""` is the no-unit spelling of 247 catalogued codes.
 *
 * **The failure this file gates is the ADDING one.** `E4.2` PR 2 appends four cost period
 * codes to the catalog; if it forgets this list, every one of its tiles answers
 * `currency: null` — a number with no currency in front of an operator — and every suite
 * stays green, because a list gated only against itself cannot notice a code that is not in
 * it. The sibling claim in `apps/api/src/dashboard-builder/sustainability-rollup.spec.ts`
 * gates the other direction (no listed code is a spelling the catalog dropped).
 *
 * **Why here and not beside that one.** The rule reads `UNIT_BY_KEY`, which
 * `packages/db/src/point-key-units.ts` exports for the seed alone — its own docblock says
 * "nothing else imports it", and `apps/api` importing a file the package index does not
 * re-export would be a new import edge for a test. `tests/f3.39` parses the same table as
 * TEXT for the same reason; this file follows it. Assertions are inline (§4.6 carves out the
 * top-level `tests/` directory), and `@bms/shared` is imported directly, as
 * `tests/adr-0070-calc-v3-invariants.test.ts` does.
 */
describe("E4.2 — MONEY_POINT_KEY_CODES lists every catalogued cost code", () => {
  /** The `code: "unit"` pairs of `UNIT_BY_KEY`, parsed as text (the `f3.39` reader). */
  const parseUnits = (): Map<string, string> => {
    const source = read(UNITS_REL);
    const table = /const UNIT_BY_KEY: Record<string, string> = \{([\s\S]*?)\n\};/.exec(source);
    expect(table, `no UNIT_BY_KEY table parsed out of ${UNITS_REL}`).not.toBeNull();
    const pairs = [...table![1]!.matchAll(/^\s*([a-z0-9_]+):\s*"([^"]*)"/gm)];
    return new Map(pairs.map((match) => [match[1]!, match[2]!]));
  };

  /** A catalogued cost code: the empty unit (money is in the organization's currency) and `cost`. */
  const costCodes = (): string[] =>
    [...parseUnits().entries()]
      .filter(([code, unit]) => unit === "" && code.includes("cost"))
      .map(([code]) => code)
      .sort();

  it("parses the seven cost codes the catalog now holds (anti-vacuity)", () => {
    // A regex that matched nothing would make the claim below pass over an empty set, so this
    // is the ACTUAL and never slack: at three-of-seven the containment claim below would run
    // over a set missing every code `E4.2` PR 2 added and stay green, which is the one failure
    // this file exists to prevent. The seven, measured off `UNIT_BY_KEY`:
    //   E4.1c — energy_cost_per_h, energy_cost_today, water_cost_today
    //   E4.2 PR 2 (U6) — energy_cost_this_month, energy_cost_this_year,
    //                    water_cost_this_month, water_cost_this_year
    // Raise this in the same commit that catalogues the eighth.
    expect(costCodes().length, `UNIT_BY_KEY parsed as almost nothing`).toBeGreaterThanOrEqual(7);
  });

  it("lists every catalogued cost code, so a new one cannot ship without its currency", () => {
    const listed = new Set<string>(MONEY_POINT_KEY_CODES);
    expect(
      costCodes().filter((code) => !listed.has(code)),
      "a point key whose unit is \"\" and whose code says cost is MONEY, and is not in " +
        "MONEY_POINT_KEY_CODES (packages/shared/src/sustainability-point-keys.ts). Its " +
        "sustainability.total tile answers currency: null — a cost with no currency. Add it " +
        "to the list in the same commit that catalogues it.",
    ).toEqual([]);
  });
});
