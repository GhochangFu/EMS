import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const ONBOARDING = "apps/api/src/admin/onboarding";

/**
 * `F4.225` (ADR 0092 decision 8, amended) - whether a draft point key's unit
 * or domain contradicts the catalog is decided once, by
 * `pointKeyDeclarationProblems`, before the commit. The two declaring tools and
 * the validator call it, so a tool cannot accept what validation refuses. The
 * commit keeps its own comparison inside the transaction and does not call it.
 */

/** Occurrences on code lines only: a docblock or `//` line that spells the call does not count as one. */
function codeOccurrences(text: string, needle: string): number {
  return text
    .split(/\r?\n/)
    .filter((line) => !/^\s*(\*|\/\*|\/\/)/.test(line))
    .reduce((sum, line) => sum + line.split(needle).length - 1, 0);
}

/** Non-spec, non-test `.ts` files in the onboarding folder, read from the listing. */
function filesHolding(needle: string): string[] {
  return readdirSync(join(repoRoot, ONBOARDING))
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".spec.ts") && !name.endsWith(".test.ts"))
    .filter((name) => readFileSync(join(repoRoot, ONBOARDING, name), "utf8").includes(needle));
}

const SITES = [
  `${ONBOARDING}/onboarding-agent-tools.ts`,
  `${ONBOARDING}/onboarding-mapping-tools.ts`,
  `${ONBOARDING}/onboarding-validate.service.ts`,
];

describe("the point-key declaration predicate is stated once (F4.225, ADR 0092 decision 8)", () => {
  it("is called once each from add_point_key, add_point_keys and the validator", () => {
    for (const file of SITES) {
      const text = readFileSync(join(repoRoot, file), "utf8");
      expect(codeOccurrences(text, "pointKeyDeclarationProblems("), file).toBe(1);
    }
  });

  it("is named nowhere else, the commit service included", () => {
    expect(filesHolding("pointKeyDeclarationProblems(").sort()).toEqual([
      "onboarding-agent-tools.ts",
      "onboarding-mapping-tools.ts",
      "onboarding-point-key-conflict.ts",
      "onboarding-validate.service.ts",
    ]);
  });

  it("keeps the catalog sentence's lead in the conflict module", () => {
    expect(filesHolding("already exists in the fleet-wide catalog with")).toEqual(["onboarding-point-key-conflict.ts"]);
  });
});
