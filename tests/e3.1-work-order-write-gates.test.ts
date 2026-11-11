import { readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { repoRoot, walk } from "./support/source-scan";

/**
 * `E3.1` (ADR 0122 decisions 9 and 10, plan T1.6) — two static invariants on the
 * work-order write surface. Assertions inline (§4.6 carves out `tests/`).
 *
 * (a) Every write handler of the SLA policy and checklist template admin controllers calls
 *     `assertOperationsWriteRole(…, "configuration")` as its **first** `await`
 *     (ADR 0017): a role refusal must not depend on the body parse or on scope
 *     resolution, so an `operator` sending a malformed body reads 403, never 400.
 * (b) `.insert(workOrders)` appears in exactly one non-test file under `apps/api/src`,
 *     `work-orders/work-order-create.ts`: the one writer that allocates the
 *     reference and snapshots the SLA (decisions 2 and 3). A second insert would mint
 *     a ticket with no reference.
 *
 * Comments are stripped before either scan, so a docblock quoting a decorator or an
 * insert is not read as code.
 */

const GATED_CONTROLLERS = [
  "apps/api/src/admin/work-order-sla-policies/work-order-sla-policies.controller.ts",
  // PR 3 (decision 4.2): the checklist template admin writes.
  "apps/api/src/admin/work-order-checklist-templates/work-order-checklist-templates.controller.ts",
];

const THE_ONE_INSERTER = "apps/api/src/work-orders/work-order-create.ts";

/** Block comments, then line comments not preceded by `:` (a URL) or inside a quote. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

/** The body of the method that follows `from`: the text between its first `{` and the matching `}`. */
function methodBodyAfter(source: string, from: number): string {
  const open = source.indexOf("{", from);
  if (open < 0) return "";
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return "";
}

/** Each write handler's first awaited expression, keyed by its decorator. */
function firstAwaits(source: string): Array<{ decorator: string; first: string | null }> {
  const code = stripComments(source);
  const out: Array<{ decorator: string; first: string | null }> = [];
  for (const match of code.matchAll(/@(Put|Post|Patch|Delete)\([^)]*\)/g)) {
    const afterDecorators = code.slice((match.index ?? 0) + match[0].length);
    // Skip the rest of the decorator stack and the parameter list: the body opens after `)` + ` {`.
    const signature = afterDecorators.search(/\)\s*(?::\s*[^{]+)?\{/);
    const body = methodBodyAfter(afterDecorators, signature < 0 ? 0 : signature);
    const first = /\bawait\s+([^;]+);/.exec(body);
    out.push({ decorator: match[0], first: first ? (first[1] as string).replace(/\s+/g, " ").trim() : null });
  }
  return out;
}

const ROLE_GATE = /^this\.accessControl\.assertOperationsWriteRole\(\s*\w+\s*,\s*"configuration"\s*\)$/;

function offendersOf(source: string): string[] {
  return firstAwaits(source)
    .filter(({ first }) => first === null || !ROLE_GATE.test(first))
    .map(({ decorator, first }) => `${decorator}: first await is ${first ?? "(none)"}`);
}

describe("E3.1 — work-order write gates", () => {
  it("every SLA policy and checklist template write handler awaits the configuration role gate first", () => {
    for (const file of GATED_CONTROLLERS) {
      const source = readFileSync(join(repoRoot, file), "utf8");
      const handlers = firstAwaits(source);
      expect(handlers.length, `${file}: no write handler found — the scan is broken`).toBeGreaterThan(0);
      expect(offendersOf(source), file).toEqual([]);
    }
  });

  it("the gate scan kills the reorder it exists to catch", () => {
    const gated = `
      @Put()
      async put(@CurrentUser() user: JwtPayload, @Body() body: unknown) {
        await this.accessControl.assertOperationsWriteRole(user, "configuration");
        return this.service.put(user, parse(schema, body));
      }`;
    expect(offendersOf(gated)).toEqual([]);
    const reordered = `
      @Put()
      async put(@CurrentUser() user: JwtPayload, @Body() body: unknown) {
        const parsed = parse(schema, body);
        await this.assertOrganizationAdmin(user, parsed.organizationId);
        await this.accessControl.assertOperationsWriteRole(user, "configuration");
        return this.service.put(user, parsed);
      }`;
    expect(offendersOf(reordered)).toHaveLength(1);
    const operational = gated.replace('"configuration"', '"operational"');
    expect(offendersOf(operational), "the wrong write class").toHaveLength(1);
    const commented = `
      @Post()
      async create(@Body() body: unknown) {
        // await this.accessControl.assertOperationsWriteRole(user, "configuration");
        return this.service.create(body);
      }`;
    expect(offendersOf(commented), "a commented-out gate is no gate").toHaveLength(1);
  });

  it(".insert(workOrders) appears in exactly one non-test file under apps/api/src", () => {
    const files = walk(join(repoRoot, "apps", "api", "src")).filter(
      (file) => file.endsWith(".ts") && !/\.(spec|test)\.ts$/.test(file),
    );
    expect(files.length, "the walk found no source — it is broken").toBeGreaterThan(50);
    const inserters = files
      // Also a namespaced table (`schema.workOrders`) and a raw statement, so the line
      // cannot be stepped around by spelling the insert another way.
      .filter((file) =>
        /\.insert\(\s*(?:\w+\.)?workOrders\s*\)|INSERT\s+INTO\s+"?bms"?\."?work_orders"?/i.test(
          stripComments(readFileSync(file, "utf8")),
        ),
      )
      .map((file) => relative(repoRoot, file).replace(/\\/g, "/"));
    expect(inserters).toEqual([THE_ONE_INSERTER]);
  });
});
