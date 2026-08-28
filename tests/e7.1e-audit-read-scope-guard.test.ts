import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const servicePath = join(repoRoot, "apps", "api", "src", "admin", "audit", "audit.service.ts");

/**
 * `E7.1e` / ADR 0046 decision 6 — **a static test, and it says so.**
 *
 * AGENTS.md §4.4: when a guarantee cannot be expressed as a behavioural test,
 * write a static one and name which it is. This is that case, and the reason is
 * specific rather than general.
 *
 * Decision 6 says the export cap counts the **scoped** set, so a tenant admin
 * is never refused an export on the size of rows it cannot see. The only way to
 * observe that behaviourally is an export whose *unscoped* count exceeds the
 * cap while its *scoped* count does not — and `AuditAdminService.export` calls
 * `assertWithinExportCap(total)` with no cap argument, so the ceiling is the
 * real `MAX_EXPORT_ROWS` of 50,000. No integration fixture reaches that, and
 * threading an injectable cap through `export` purely to make the test possible
 * would change a production signature for a test's convenience.
 *
 * So the protection is structural: `list` and `export` each derive **one**
 * `where` from **one** `buildWhere(query, scope)` call and hand that same
 * binding to both `count` and `selectRows`. `E7.1e`'s own review found that
 * nothing enforced the structure — a single line,
 * `this.count(this.buildWhere(query, null))`, restores exactly the defect
 * decision 6 exists to prevent, and every behavioural assertion in
 * `audit.integration.spec.ts` stays green. This file is that enforcement.
 *
 * It is deliberately a source scan and not a type: TypeScript cannot express
 * "the same value reaches both call sites", and a runtime assertion inside
 * `export` would be the thing under test asserting about itself.
 */

const source = readFileSync(servicePath, "utf8");

/** The body of one method, from its signature to the closing brace at method indent. */
function methodBody(name: string): string {
  const start = source.indexOf(`  async ${name}(`);
  expect(
    start,
    `audit.service.ts no longer declares an \`async ${name}(\` method at class indent. ` +
      "If it was renamed, rename it here too — do not delete this guard: it is the only " +
      "thing pinning ADR 0046 decision 6.",
  ).toBeGreaterThan(-1);
  const end = source.indexOf("\n  }", start);
  expect(end, `could not find the end of \`${name}\``).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("E7.1e / ADR 0046 decision 6 — the read scope reaches the count, not just the page", () => {
  for (const method of ["list", "export"] as const) {
    it(`${method}() derives one where from one buildWhere(query, scope) call`, () => {
      const body = methodBody(method);

      const buildWhereCalls = [...body.matchAll(/this\.buildWhere\(([^)]*)\)/g)];
      expect(
        buildWhereCalls.map((m) => m[1].trim()),
        `${method}() must call this.buildWhere exactly once. Two calls is how the count and ` +
          "the page come to disagree, which is the ADR 0046 decision 6 defect.",
      ).toHaveLength(1);

      expect(
        buildWhereCalls[0][1].replace(/\s+/g, " ").trim(),
        `${method}() must pass the resolved scope to buildWhere. Passing \`null\` there ` +
          "counts every organization's rows while showing only the caller's — a tenant " +
          "admin is then refused an export on the size of rows it cannot see.",
      ).toBe("query, scope");

      expect(
        /const where = this\.buildWhere\(query, scope\);/.test(body),
        `${method}() must bind the predicate once as \`where\`. An inline ` +
          "`this.count(this.buildWhere(...))` is the shape this guard exists to reject.",
      ).toBe(true);
    });

    it(`${method}() passes that same binding to count and to selectRows`, () => {
      const body = methodBody(method);

      for (const callee of ["count", "selectRows"] as const) {
        const call = new RegExp(`this\\.${callee}\\(\\s*where\\s*[,)]`).test(body);
        expect(
          call,
          `${method}() must call this.${callee}(where, ...) with the bound predicate. ` +
            "Anything else — a second buildWhere, an inline expression, `undefined` — " +
            "breaks the guarantee that the count and the page describe the same set.",
        ).toBe(true);
      }
    });
  }

  it("the scope is resolved before either query runs", () => {
    for (const method of ["list", "export"] as const) {
      const body = methodBody(method);
      const resolved = body.indexOf("this.resolveReadScope(jwt)");
      const counted = body.indexOf("this.count(");
      expect(
        resolved,
        `${method}() must resolve the read scope. Without it the gate never runs and the ` +
          "endpoint is open.",
      ).toBeGreaterThan(-1);
      expect(
        counted > resolved,
        `${method}() must resolve the scope before it counts. A count that runs first has ` +
          "already read rows the caller may not be entitled to.",
      ).toBe(true);
    }
  });
});
