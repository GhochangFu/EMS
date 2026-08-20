import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const calcDslDir = join(repoRoot, "packages/shared/src/calc-dsl");

/**
 * ADR 0036 decision 3: the `bms-calc-v1` grammar is hand-rolled specifically
 * so parsing (and, later, `F2.4`'s evaluation) never needs `eval`/`new
 * Function`/`vm` — the input is always user-authored (an org admin authoring
 * a template) and this repo controls the grammar fully. This is the one
 * promise a behavioural test cannot show; a source scan can.
 *
 * Reads the directory rather than listing files by name, so `F2.4`'s
 * evaluator — the one file in this module that will ever have a real reason
 * to reach for dynamic execution — is covered automatically instead of
 * silently falling outside a hardcoded list the day it starts mattering.
 */
describe("ADR 0036 — calc-dsl never uses eval / new Function / vm", () => {
  const files = readdirSync(calcDslDir)
    .filter((name) => name.endsWith(".ts") && !name.includes(".spec.") && !name.includes(".test."))
    .map((name) => join(calcDslDir, name));

  it("found at least the modules this ADR names, so the scan below is not silently empty", () => {
    expect(files.length).toBeGreaterThanOrEqual(4);
  });

  it.each(files)("%s contains none of the forbidden constructs", (file) => {
    const source = readFileSync(file, "utf8");
    for (const forbidden of [
      "eval(",
      "new Function",
      "Function(\"",
      "Function('",
      'require("vm")',
      "require('vm')",
      'require("node:vm")',
      "require('node:vm')",
      'from "vm"',
      "from 'vm'",
      'from "node:vm"',
      "from 'node:vm'",
    ]) {
      expect(source, `${file} must never contain ${forbidden}`).not.toContain(forbidden);
    }
  });
});
