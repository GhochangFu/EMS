import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import * as ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * `E7.2` / ADR 0123 decision 11, plan T3.7 — the cloud host starts the
 * aggregate repair pass.
 *
 * `main.ts` is wiring only and has no test around it (its own docblock), so
 * this reads its syntax tree, not its text: a comment or a string that spells
 * the wiring cannot pass (a text scan reads docblock prose too). Until the
 * owner's manifest edit (#1241) the file carried a marked wiring point and a
 * `warn` that the repair was not wired; each case below is red on that file.
 *
 * What a fake cannot show — the pass against real continuous aggregates — is
 * `apps/ingest/src/host/aggregate-repair.integration.spec.ts`.
 */

const mainPath = fileURLToPath(new URL("../apps/ingest/src/main.ts", import.meta.url));
const source = ts.createSourceFile(mainPath, readFileSync(mainPath, "utf8"), ts.ScriptTarget.ES2022, true);

function nodes(): ts.Node[] {
  const out: ts.Node[] = [];
  const visit = (node: ts.Node): void => {
    out.push(node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

const all = nodes();

function callsTo(name: string): ts.CallExpression[] {
  return all.filter(
    (n): n is ts.CallExpression =>
      ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === name,
  );
}

function namedImports(from: string): string[] {
  return all
    .filter(
      (n): n is ts.ImportDeclaration =>
        ts.isImportDeclaration(n) &&
        ts.isStringLiteral(n.moduleSpecifier) &&
        n.moduleSpecifier.text === from &&
        n.importClause?.isTypeOnly !== true,
    )
    .flatMap((n) => {
      const bindings = n.importClause?.namedBindings;
      return bindings && ts.isNamedImports(bindings)
        ? bindings.elements.filter((e) => !e.isTypeOnly).map((e) => e.name.text)
        : [];
    });
}

describe("E7.2 — main.ts starts the aggregate repair pass", () => {
  it("imports the real refresh from @bms/db and the repair from its module", () => {
    expect(namedImports("@bms/db")).toContain("refreshAggregatesFrom");
    expect(namedImports("./host/aggregate-repair.js")).toEqual(
      expect.arrayContaining(["createAggregateRepair", "createRepairStore"]),
    );
  });

  it("builds the repair with the pool's store and refreshAggregatesFrom", () => {
    const [build] = callsTo("createAggregateRepair");
    expect(build, "createAggregateRepair is never called").toBeDefined();
    const text = build.getText(source);
    expect(text).toMatch(/store:\s*createRepairStore\(pool\)/);
    expect(text).toMatch(/refresh:\s*\(from, to\)\s*=>\s*refreshAggregatesFrom\(pool, from, to\)/);
  });

  it("runs the pass on a timer and clears that timer on shutdown", () => {
    const ticks = callsTo("setInterval").filter((c) => /\.runOnce\(\)/.test(c.arguments[0]?.getText(source) ?? ""));
    expect(ticks, "no setInterval runs repair.runOnce()").toHaveLength(1);
    const parent = ticks[0].parent;
    expect(
      ts.isBinaryExpression(parent) && parent.left.getText(source) === "repairTimer",
      "the repair timer must be kept in `repairTimer` so shutdown can clear it",
    ).toBe(true);
    const insideShutdown = (node: ts.Node): boolean => {
      for (let at: ts.Node | undefined = node.parent; at !== undefined; at = at.parent) {
        if (ts.isVariableDeclaration(at) && at.name.getText(source) === "shutdown") return true;
      }
      return false;
    };
    const cleared = callsTo("clearInterval").filter(
      (c) => c.arguments[0]?.getText(source) === "repairTimer" && insideShutdown(c),
    );
    expect(cleared, "shutdown never clears repairTimer").toHaveLength(1);
  });

  it("no longer warns that the repair is not wired", () => {
    const strings = all.filter((n) => ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n));
    expect(strings.map((s) => (s as ts.StringLiteral).text).filter((t) => /repair is not wired/.test(t))).toEqual(
      [],
    );
  });
});
