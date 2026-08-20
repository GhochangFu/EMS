import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

/**
 * ADR 0036 decision 3: the `bms-calc-v1` grammar is hand-rolled specifically
 * so parsing (and, later, `F2.4`'s evaluation) never needs `eval`/`new
 * Function`/`vm` — the input is always user-authored (an org admin authoring
 * a template) and this repo controls the grammar fully. This is the one
 * promise a behavioural test cannot show; a source scan can.
 */
describe("ADR 0036 — calc-dsl never uses eval / new Function / vm", () => {
  const files = ["ast.ts", "limits.ts", "tokenizer.ts", "parser.ts", "index.ts"].map((name) =>
    join(repoRoot, "packages/shared/src/calc-dsl", name),
  );

  it.each(files)("%s contains none of the forbidden constructs", (file) => {
    const source = readFileSync(file, "utf8");
    for (const forbidden of ["eval(", "new Function", "require(\"vm\")", "require('vm')", 'from "vm"']) {
      expect(source, `${file} must never contain ${forbidden}`).not.toContain(forbidden);
    }
  });
});
