import { readFileSync } from "node:fs";
import { join } from "node:path";

import { BadRequestException } from "@nestjs/common";
import { expect } from "vitest";

import type { JwtPayload } from "@bms/shared";

import type { SiteLayoutReplaceService } from "../../control-room/site-layout-replace.service";
import { repoRoot } from "../../testing/repo-root";
import { decoratorAt } from "../../testing/source-scan";
import { DashboardTemplatesController } from "../dashboard-templates/dashboard-templates.controller";
import { LocationsAdminController } from "./locations.controller";

/**
 * `F4.320` PR 2 (ADR 0087 Amendment 4) — the four Replace route claims: each decorator sits on its
 * handler, and the parsed id (and, per site, the parsed Make body) reaches the service with the
 * caller. Replace itself is `site-layout-replace.integration.spec.ts`'s. A direct call with a
 * recording stub, the `locations.controller.spec.ts` shape. Vitest entry point: the sibling `.test.ts`.
 */
const JWT: JwtPayload = { sub: "00000000-0000-4000-8000-000000004320", email: "admin@bms.local", name: "spec", role: "admin" };
const SITE = "11111111-1111-4111-8111-111111111111";
const TEMPLATE = "22222222-2222-4222-8222-222222222222";
const GROUP = "33333333-3333-4333-8333-333333333333";

const ROUTES: ReadonlyArray<{ file: string; decorator: string; handler: string }> = [
  { file: "admin/locations/locations.controller.ts", decorator: '@Post(":id/site-layout/replace")', handler: "replaceSiteLayout" },
  {
    file: "admin/locations/locations.controller.ts",
    decorator: '@Get(":id/site-layout/replace-preview")',
    handler: "previewSiteLayoutReplace",
  },
  {
    file: "admin/dashboard-templates/dashboard-templates.controller.ts",
    decorator: '@Post(":id/replace-site-layouts")',
    handler: "replaceSiteLayouts",
  },
  {
    file: "admin/dashboard-templates/dashboard-templates.controller.ts",
    decorator: '@Get(":id/replace-site-layouts/preview")',
    handler: "previewReplaceSiteLayouts",
  },
];

function recorder(): { siteLayout: SiteLayoutReplaceService; calls: Array<[string, unknown[]]> } {
  const calls: Array<[string, unknown[]]> = [];
  const record =
    (name: string) =>
    async (...args: unknown[]) => {
      calls.push([name, args]);
      return { ok: name };
    };
  const siteLayout = {
    replaceForSite: record("replaceForSite"),
    replaceForOrganization: record("replaceForOrganization"),
    previewReplaceForSite: record("previewReplaceForSite"),
    previewReplaceForOrganization: record("previewReplaceForOrganization"),
  } as unknown as SiteLayoutReplaceService;
  return { siteLayout, calls };
}

async function refusal(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error("expected the controller to refuse the call");
}

/** Each decorator sits directly on its handler. */
export function assertTheReplaceRoutesAreDeclared(): void {
  for (const route of ROUTES) {
    const source = readFileSync(join(repoRoot(), "apps/api/src", route.file), "utf8");
    const at = decoratorAt(source, route.decorator);
    expect(at, `${route.file} must declare ${route.decorator}`).toBeGreaterThan(-1);
    const between = source.slice(at + route.decorator.length, source.indexOf(`async ${route.handler}(`, at));
    expect(between.trim(), `${route.decorator} must sit directly on ${route.handler}`).toBe("");
  }
}

/** Per site: the path id and the parsed Make body reach `replaceForSite`; the preview takes the id. */
export async function assertThePerSiteRoutesReachTheService(): Promise<void> {
  const { siteLayout, calls } = recorder();
  const controller = new LocationsAdminController({} as never, {} as never, {} as never, siteLayout);
  await controller.replaceSiteLayout(SITE, { templateId: TEMPLATE, tabGroups: { sld: GROUP } }, JWT);
  await controller.replaceSiteLayout(SITE, undefined, JWT);
  await controller.previewSiteLayoutReplace(SITE, JWT);
  expect(calls).toEqual([
    ["replaceForSite", [JWT, { locationId: SITE, templateId: TEMPLATE, tabGroups: { sld: GROUP } }]],
    ["replaceForSite", [JWT, { locationId: SITE }]],
    ["previewReplaceForSite", [JWT, SITE]],
  ]);
}

/** The per-site body is the `.strict()` Make body: an unknown key or a bad id is a 400 before the service. */
export async function assertThePerSiteBodyIsStrict(): Promise<void> {
  const { siteLayout, calls } = recorder();
  const controller = new LocationsAdminController({} as never, {} as never, {} as never, siteLayout);
  expect(await refusal(controller.replaceSiteLayout(SITE, { tabGroup: {} }, JWT))).toBeInstanceOf(BadRequestException);
  expect(await refusal(controller.replaceSiteLayout("not-a-uuid", {}, JWT))).toBeInstanceOf(BadRequestException);
  expect(calls).toEqual([]);
}

/** Bulk: the parsed template id reaches `replaceForOrganization` and its preview. */
export async function assertTheBulkRoutesReachTheService(): Promise<void> {
  const { siteLayout, calls } = recorder();
  const controller = new DashboardTemplatesController({} as never, {} as never, {} as never, {} as never, siteLayout);
  await controller.replaceSiteLayouts(TEMPLATE, JWT);
  await controller.previewReplaceSiteLayouts(TEMPLATE, JWT);
  expect(calls).toEqual([
    ["replaceForOrganization", [JWT, TEMPLATE]],
    ["previewReplaceForOrganization", [JWT, TEMPLATE]],
  ]);
}
