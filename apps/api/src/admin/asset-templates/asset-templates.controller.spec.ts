import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect } from "vitest";

import { repoRoot } from "../../testing/repo-root";
import { decoratorAt, methodBody } from "../../testing/source-scan";

/**
 * `F2.13` — the one thing about this controller that is invisible in review and
 * fails in a way that reads like a client bug. Copied from
 * `dashboard-templates.controller.spec.ts`, which found it first (`F3.36`).
 *
 * Assertions live here; `asset-templates.controller.test.ts` is the Vitest
 * entry point (ADR 0014).
 *
 * **A source scan rather than a Nest test, and that is the §4.6 rule rather than
 * a shortcut**: `F4.20` records that esbuild emits no `design:paramtypes` in
 * this environment, so a module cannot be instantiated here to ask the router
 * what it matched. What can be checked is the declaration order the router reads.
 *
 * **Resolved through `repoRoot()`, never `join(process.cwd(), …)`.** The
 * dashboard sibling's docblock records that defect: correct under
 * `pnpm --filter api exec vitest run` (cwd `apps/api`), `ENOENT` under the root
 * `pnpm test` CI actually runs. `import.meta.dirname` is unavailable — this
 * package compiles CommonJS (`TS1343`).
 */
const CONTROLLER = join(
  repoRoot(),
  "apps/api/src/admin/asset-templates/asset-templates.controller.ts",
);

export function runAssetTemplatesControllerTests(): void {
  const source = readFileSync(CONTROLLER, "utf8");

  // **Anchored to a line start, never a bare `indexOf`** — see
  // `testing/source-scan.ts`: the class docblock quotes both decorators in the
  // same order, so a bare `indexOf` found the comment and passed either way.
  const stockAt = decoratorAt(source, '@Get("stock")');
  const idAt = decoratorAt(source, '@Get(":id")');

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

  // The same trap one level down: `POST stock/:code/import` has three segments,
  // and since `E2.4` so does `@Post(":id/seeded-rules/reapply")`. The two
  // cannot match each other's requests — their literal segments differ — but
  // the declaration order is what keeps that true against a future
  // `@Post(":id/:verb/:x")`, so it is asserted rather than trusted.
  const stockImportAt = decoratorAt(source, '@Post("stock/:code/import")');
  expect(stockImportAt, "the controller must declare the stock import route").toBeGreaterThan(-1);
  const firstIdPostAt = decoratorAt(source, '@Post(":id');
  expect(firstIdPostAt, 'the controller must declare a @Post(":id/…") route').toBeGreaterThan(-1);
  expect(
    stockImportAt,
    '@Post("stock/:code/import") must be declared BEFORE the first @Post(":id/…"). The order ' +
      'is what makes it safe against a three-segment @Post(":id/:verb/:x"), and since E2.4 ' +
      'one exists: @Post(":id/seeded-rules/reapply").',
  ).toBeLessThan(firstIdPostAt);

  // `E2.4` / ADR 0058 decision 8 — the two seeded-rules routes sit AFTER
  // `@Post(":id/instantiate")`, which is where the plan placed them, and the
  // three-segment POST sits after the stock import for the reason above.
  const instantiateAt = decoratorAt(source, '@Post(":id/instantiate")');
  const seededListAt = decoratorAt(source, '@Get(":id/seeded-rules")');
  const seededReapplyAt = decoratorAt(source, '@Post(":id/seeded-rules/reapply")');
  expect(instantiateAt, "the controller must declare the instantiate route").toBeGreaterThan(-1);
  expect(seededListAt, 'the controller must declare @Get(":id/seeded-rules")').toBeGreaterThan(-1);
  expect(
    seededReapplyAt,
    'the controller must declare @Post(":id/seeded-rules/reapply")',
  ).toBeGreaterThan(-1);
  expect(
    seededListAt,
    '@Get(":id/seeded-rules") must be declared after @Post(":id/instantiate") (plan U6)',
  ).toBeGreaterThan(instantiateAt);
  expect(
    seededReapplyAt,
    '@Post(":id/seeded-rules/reapply") must be declared after @Get(":id/seeded-rules")',
  ).toBeGreaterThan(seededListAt);
  expect(
    stockImportAt,
    '@Post("stock/:code/import") must be declared BEFORE @Post(":id/seeded-rules/reapply") — ' +
      "the first three-segment :id POST this controller has",
  ).toBeLessThan(seededReapplyAt);

  // **The guard on `GET stock` is proven here, not only exercised.** The
  // integration suite's `assertListNeedsAMasterDataRole` calls the *service*
  // method, so a refactor that drops the `assertCanList` line from the handler
  // leaves every other gate green while any authenticated principal — a
  // `viewer` included — enumerates the shipped catalog. That is the `F3.36`
  // security finding on the dashboard route, and the `F2.13` security review
  // asked for this assertion so it cannot recur silently.
  const listStock = methodBody(source, "async listStock(", "@Get(");
  expect(
    listStock,
    "listStock must call this.stock.assertCanList(user) before it returns the catalog",
  ).toContain("this.stock.assertCanList(user)");

  // And `:code` is parsed before it reaches the catalog lookup or the 400
  // message — a bounded, lowercase-kebab segment (`stockCodeParamSchema`),
  // the way every `:id` on this controller goes through `idParamSchema`.
  const importStock = methodBody(source, "async importStock(", "@Post(");
  expect(
    importStock,
    "importStock must parse :code with stockCodeParamSchema before using it",
  ).toContain("stockCodeParamSchema.parse(code)");
}

