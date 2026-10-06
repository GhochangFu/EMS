import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const ONBOARDING = "apps/api/src/admin/onboarding";

/**
 * `F3.23` (ADR 0092 decision 2) - whether a draft mapping will commit is
 * decided once, by `assetPointProblems`, and each sentence it can return has
 * one home. Were a caller to restate a rule, the validator and a tool could
 * disagree and a `readyToCommit` draft could fail at commit.
 */

function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

/** Non-spec, non-test `.ts` files in the onboarding folder, read from the listing. */
function filesHolding(needle: string): string[] {
  return readdirSync(join(repoRoot, ONBOARDING))
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".spec.ts") && !name.endsWith(".test.ts"))
    .filter((name) => readFileSync(join(repoRoot, ONBOARDING, name), "utf8").includes(needle));
}

const SITES = [
  { file: `${ONBOARDING}/onboarding-validate.service.ts`, count: 1 },
  { file: `${ONBOARDING}/onboarding-agent-tools.ts`, count: 2 },
  { file: `${ONBOARDING}/onboarding-mapping-tools.ts`, count: 1 },
];

describe("the mapping predicate is stated once (F3.23, ADR 0092 decision 2)", () => {
  it("is called from the validator, the single tools and the batch tool, and nowhere else", () => {
    for (const site of SITES) {
      const text = readFileSync(join(repoRoot, site.file), "utf8");
      expect(occurrences(text, "assetPointProblems("), site.file).toBe(site.count);
    }
  });

  it("keeps the two unique-conflict sentences in one file", () => {
    expect(filesHolding("A point key may appear once per asset")).toEqual(["onboarding-commit-conflict.ts"]);
    expect(filesHolding("A source data key may appear once per asset")).toEqual(["onboarding-commit-conflict.ts"]);
  });

  it("keeps the unresolved-key sentence in one file", () => {
    expect(filesHolding("is neither in this draft nor in the catalog")).toEqual(["onboarding-template-refs.ts"]);
  });

  it("keeps the templated-asset sentence in one file", () => {
    expect(filesHolding("is built from a template; ")).toEqual(["onboarding-mapping-refs.ts"]);
  });
});
