import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect } from "vitest";

/**
 * `F3.36` Part E3 — the one thing about this controller that is invisible in
 * review and fails in a way that reads like a client bug.
 *
 * Assertions live here; `dashboard-templates.controller.test.ts` is the Vitest
 * entry point (ADR 0014).
 *
 * **A source scan rather than a Nest test, and that is the §4.6 rule rather than
 * a shortcut**: `F4.20` records that esbuild emits no `design:paramtypes` in
 * this environment, so a module cannot be instantiated here to ask the router
 * what it matched. What can be checked is the declaration order the router reads.
 */
/**
 * Resolved from `process.cwd()`, which Vitest sets to `apps/api` — the idiom the
 * sibling `stock-catalog.spec.ts` uses. `import.meta.dirname` does not compile
 * here: `apps/api`'s tsconfig targets `module: "node"` (node10), and `tsc`
 * refuses the meta-property outright.
 */
const CONTROLLER = join(
  process.cwd(),
  "src/admin/dashboard-templates/dashboard-templates.controller.ts",
);

export function runDashboardTemplatesControllerTests(): void {
  const source = readFileSync(CONTROLLER, "utf8");

  const stockAt = source.indexOf('@Get("stock")');
  const idAt = source.indexOf('@Get(":id")');

  expect(stockAt, 'the controller must declare @Get("stock")').toBeGreaterThan(-1);
  expect(idAt, 'the controller must declare @Get(":id")').toBeGreaterThan(-1);

  expect(
    stockAt,
    '@Get("stock") must be declared BEFORE @Get(":id"). Nest matches routes in declaration ' +
      "order, so declared after, the literal /stock is swallowed by the parameterised route " +
      'and arrives at getById as the string "stock", where idParamSchema refuses it. The ' +
      "catalog endpoint then fails as an invalid uuid — which reads like a client bug and is " +
      "not one. Nothing else in the file makes this order visible, which is why it is asserted.",
  ).toBeLessThan(idAt);

  // The same trap one level down: `POST stock/:code/import` must not be
  // swallowed by `POST :id/...`. The literal segment leads, so it is safe by
  // construction — asserted so a later reorder cannot quietly break it.
  const stockImportAt = source.indexOf('@Post("stock/:code/import")');
  expect(stockImportAt, "the controller must declare the stock import route").toBeGreaterThan(-1);
}
