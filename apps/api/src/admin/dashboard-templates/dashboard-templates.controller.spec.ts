import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect } from "vitest";
import { ZodError } from "zod";

import type { JwtPayload } from "@bms/shared";

import type { SiteLayoutService } from "../../control-room/site-layout.service";
import { repoRoot } from "../../testing/repo-root";
import { decoratorAt, methodBody } from "../../testing/source-scan";
import { DashboardTemplatesController } from "./dashboard-templates.controller";

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
 * Resolved through `repoRoot()`, which walks up to the workspace manifest.
 *
 * **This used to be `join(process.cwd(), …)` and that was a real defect.** It is
 * correct under `pnpm --filter api exec vitest run`, whose cwd is `apps/api`,
 * and wrong under `pnpm test` — the ROOT runner CI actually invokes, where cwd
 * is already the repository root. The suite passed every targeted run and failed
 * with `ENOENT` on the only runner that matters.
 *
 * `import.meta.dirname` is not available here: `apps/api` compiles with
 * `"module": "commonjs"` and `tsc` refuses the meta-property (`TS1343`).
 */
const CONTROLLER = join(
  repoRoot(),
  "apps/api/src/admin/dashboard-templates/dashboard-templates.controller.ts",
);

export function runDashboardTemplatesControllerTests(): void {
  const source = readFileSync(CONTROLLER, "utf8");

  // **Anchored to a line start, never a bare `indexOf`** — see
  // `testing/source-scan.ts`. The class docblock quotes both decorators in the
  // same order some forty lines before the real ones, so the original
  // `indexOf` matched the comment and this check passed with the routes in
  // either order. Found by the `F2.13` code review on the asset-template twin.
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

  // The same trap one level down: `POST stock/:code/import` must not be
  // swallowed by `POST :id/...`. The literal segment leads, so it is safe by
  // construction — asserted so a later reorder cannot quietly break it.
  const stockImportAt = decoratorAt(source, '@Post("stock/:code/import")');
  expect(stockImportAt, "the controller must declare the stock import route").toBeGreaterThan(-1);
  const firstIdPostAt = decoratorAt(source, '@Post(":id');
  expect(firstIdPostAt, 'the controller must declare a @Post(":id/…") route').toBeGreaterThan(-1);
  expect(
    stockImportAt,
    '@Post("stock/:code/import") must be declared BEFORE the first @Post(":id/…"). Three ' +
      "segments against two is safe by segment count today; the order makes it safe against a " +
      'future three-segment @Post(":id/:verb/:x") as well, which the comment above promises.',
  ).toBeLessThan(firstIdPostAt);

  // The guard on `GET stock` is proven here, not only exercised: the
  // integration suite calls the *service*, so a refactor dropping the line
  // from the handler leaves every other gate green while any authenticated
  // principal enumerates the catalog — the `F3.36` security finding itself.
  const listStock = methodBody(source, "async listStock(", "@Get(");
  expect(
    listStock,
    "listStock must call this.stock.assertCanList(user) before it returns the catalog",
  ).toContain("this.stock.assertCanList(user)");

  const importStock = methodBody(source, "async importStock(", "@Post(");
  expect(
    importStock,
    "importStock must parse :code with stockCodeParamSchema before using it",
  ).toContain("stockCodeParamSchema.parse(code)");
}

/**
 * `F3.73` plan Task 4.2 — the `POST /admin/dashboard-templates/:id/apply-to-sites` route claims:
 * the decorator on `applyToSites`, and the parsed id reaching `makeForOrganization` with the
 * caller (a direct call with a recording stub; the bulk itself is the integration spec's S7).
 */
const BULK_JWT: JwtPayload = {
  sub: "00000000-0000-4000-8000-000000000373",
  email: "admin@bms.local",
  name: "spec",
  role: "admin",
};

function bulkController(): { controller: DashboardTemplatesController; calls: unknown[][] } {
  const calls: unknown[][] = [];
  const siteLayout = {
    makeForOrganization: async (...args: unknown[]) => {
      calls.push(args);
      return { made: [], skipped: [] };
    },
  } as unknown as SiteLayoutService;
  const controller = new DashboardTemplatesController({} as never, {} as never, {} as never, siteLayout);
  return { controller, calls };
}

/** The decorator sits on `applyToSites`, with no other decorator between them. */
export function assertApplyToSitesRouteIsDeclared(): void {
  const source = readFileSync(CONTROLLER, "utf8");
  const literal = '@Post(":id/apply-to-sites")';
  const at = decoratorAt(source, literal);
  expect(at, `the controller must declare ${literal}`).toBeGreaterThan(-1);
  const between = source.slice(at + literal.length, source.indexOf("async applyToSites(", at));
  expect(between.trim(), "the route decorator must sit directly on applyToSites").toBe("");
}

/** The path id reaches `makeForOrganization` with the caller, and its answer is the response. */
export async function assertApplyToSitesCallsTheBulk(): Promise<void> {
  const { controller, calls } = bulkController();
  const id = "22222222-2222-4222-8222-222222222222";
  expect(await controller.applyToSites(id, BULK_JWT)).toEqual({ made: [], skipped: [] });
  expect(calls).toEqual([[BULK_JWT, id]]);
}

/** A non-uuid id is a `ZodError` (the global filter's 400) and the bulk never runs. */
export async function assertApplyToSitesRefusesABadId(): Promise<void> {
  const { controller, calls } = bulkController();
  let thrown: unknown;
  try {
    await controller.applyToSites("not-a-uuid", BULK_JWT);
  } catch (err) {
    thrown = err;
  }
  expect(thrown).toBeInstanceOf(ZodError);
  expect(calls).toEqual([]);
}
