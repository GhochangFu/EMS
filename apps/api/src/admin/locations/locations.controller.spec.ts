import { readFileSync } from "node:fs";
import { join } from "node:path";

import { BadRequestException } from "@nestjs/common";
import { expect } from "vitest";

import type { JwtPayload } from "@bms/shared";

import { SiteLayoutConflict, type SiteLayoutService } from "../../control-room/site-layout.service";
import { repoRoot } from "../../testing/repo-root";
import { decoratorAt } from "../../testing/source-scan";
import { LocationsAdminController } from "./locations.controller";

/**
 * `F3.73` plan Task 4.2 — the `POST /admin/locations/:id/site-layout` route claims. The copy
 * itself is `site-layout.service.integration.spec.ts`'s; what is here is the controller's own
 * work: the route, the id and body parse, and what reaches the service. A direct call on the
 * class with a recording stub (the `audit.controller.spec.ts` shape) — `F4.20`: esbuild emits no
 * `design:paramtypes` here, so the Nest router cannot be asked. Assertions live here;
 * `locations.controller.test.ts` is the Vitest entry point (ADR 0014).
 */
const CONTROLLER = join(repoRoot(), "apps/api/src/admin/locations/locations.controller.ts");

const JWT: JwtPayload = {
  sub: "00000000-0000-4000-8000-000000000373",
  email: "admin@bms.local",
  name: "spec",
  role: "admin",
};

const SITE = "11111111-1111-4111-8111-111111111111";
const TEMPLATE = "22222222-2222-4222-8222-222222222222";
const GROUP = "33333333-3333-4333-8333-333333333333";

function controllerWith(answer: () => Promise<unknown>): { controller: LocationsAdminController; calls: unknown[][] } {
  const calls: unknown[][] = [];
  const siteLayout = {
    makeForSite: async (...args: unknown[]) => {
      calls.push(args);
      return answer();
    },
  } as unknown as SiteLayoutService;
  return { controller: new LocationsAdminController({} as never, {} as never, siteLayout), calls };
}

async function refusal(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error("expected the controller to refuse the call");
}

/** The decorator sits on `makeSiteLayout`, with no other decorator between them. */
export function assertSiteLayoutRouteIsDeclared(): void {
  const source = readFileSync(CONTROLLER, "utf8");
  const at = decoratorAt(source, '@Post(":id/site-layout")');
  expect(at, 'the controller must declare @Post(":id/site-layout")').toBeGreaterThan(-1);
  const between = source.slice(at + '@Post(":id/site-layout")'.length, source.indexOf("async makeSiteLayout(", at));
  expect(between.trim(), "the route decorator must sit directly on makeSiteLayout").toBe("");
}

/** The parsed body and the path id reach `makeForSite`, with the caller. */
export async function assertBodyReachesTheService(): Promise<void> {
  const { controller, calls } = controllerWith(async () => ({ made: true }));
  const result = await controller.makeSiteLayout(SITE, { templateId: TEMPLATE, tabGroups: { sld: GROUP } }, JWT);
  expect(result).toEqual({ made: true });
  expect(calls).toEqual([[JWT, { locationId: SITE, templateId: TEMPLATE, tabGroups: { sld: GROUP } }]]);
}

/** No body is the notice button's call: the organization's newest template, no choice. */
export async function assertNoBodyIsTheDefaultCall(): Promise<void> {
  const { controller, calls } = controllerWith(async () => ({ made: true }));
  await controller.makeSiteLayout(SITE, undefined, JWT);
  expect(calls).toEqual([[JWT, { locationId: SITE }]]);
}

/** The body is `.strict()`: an unknown key is a 400 and the service is never called. */
export async function assertUnknownBodyKeyIs400(): Promise<void> {
  const { controller, calls } = controllerWith(async () => ({ made: true }));
  const err = await refusal(controller.makeSiteLayout(SITE, { locationId: SITE }, JWT));
  expect(err).toBeInstanceOf(BadRequestException);
  expect(calls).toEqual([]);
}

/** A path id that is not a uuid is a 400 and the service is never called. */
export async function assertBadIdIs400(): Promise<void> {
  const { controller, calls } = controllerWith(async () => ({ made: true }));
  const err = await refusal(controller.makeSiteLayout("not-a-uuid", {}, JWT));
  expect(err).toBeInstanceOf(BadRequestException);
  expect(calls).toEqual([]);
}

/** The service's 409 — the ambiguous body with its candidates — passes through unchanged. */
export async function assertConflictPassesThrough(): Promise<void> {
  const conflict = new SiteLayoutConflict("ambiguous", "ambiguous", [
    { tabKey: "sld", domain: "electrical", candidates: [{ id: GROUP, code: "electrical-a", name: "A" }] },
  ]);
  const { controller } = controllerWith(async () => {
    throw conflict;
  });
  expect(await refusal(controller.makeSiteLayout(SITE, {}, JWT))).toBe(conflict);
}
