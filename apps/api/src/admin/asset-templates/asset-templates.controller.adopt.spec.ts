import { BadRequestException } from "@nestjs/common";
import { expect } from "vitest";

import type { JwtPayload } from "@bms/shared";

import type { AssetDashboardsInstantiateService } from "./asset-dashboards-instantiate.service";
import type { AssetTemplateAdoptionService } from "./asset-templates-adopt.service";
import type { AssetTemplateInstantiationService } from "./asset-templates-instantiate.service";
import type { AssetTemplateMigrationService } from "./asset-templates-migrate.service";
import type { AssetTemplateSeededRulesService } from "./asset-templates-seeded-rules.service";
import type { AssetTemplatesStockService } from "./asset-templates-stock.service";
import { AssetTemplatesAdminController } from "./asset-templates.controller";
import type { AssetTemplatesAdminService } from "./asset-templates.service";

/**
 * `F4.312` — the two adoption routes parse the body with the shared
 * `adoptAssetsBodySchema` before the service is reached, and hand the parsed
 * body to the adoption service. Constructed directly with stubs (AGENTS.md
 * §4.6: no Nest module in a test). The `.test.ts` sibling runs these.
 */

const JWT = { sub: "u", email: "admin@bms.local", role: "admin" } as unknown as JwtPayload;
const TEMPLATE = "00000000-0000-4000-8000-000000000001";
const ids = (n: number): string[] =>
  Array.from({ length: n }, (_, i) => `00000000-0000-4000-8000-${String(i + 10).padStart(12, "0")}`);

function controllerWith(calls: string[]): AssetTemplatesAdminController {
  const adoption = {
    preview: async (_jwt: JwtPayload, id: string, body: { assetIds: string[] }) => {
      calls.push(`preview ${id} ${body.assetIds.length}`);
      return {};
    },
    adopt: async (_jwt: JwtPayload, id: string, body: { assetIds: string[] }) => {
      calls.push(`adopt ${id} ${body.assetIds.length}`);
      return {};
    },
  };
  return new AssetTemplatesAdminController(
    {} as unknown as AssetTemplatesAdminService,
    {} as unknown as AssetTemplateInstantiationService,
    {} as unknown as AssetTemplateMigrationService,
    {} as unknown as AssetTemplatesStockService,
    {} as unknown as AssetTemplateSeededRulesService,
    {} as unknown as AssetDashboardsInstantiateService,
    adoption as unknown as AssetTemplateAdoptionService,
  );
}

/**
 * 26 ids is a 400 and the service is never reached. Mutation: the route parses
 * with `migrateAssetsBodySchema` (cap 200) or not at all.
 */
export async function anAdoptOverTheCapIsA400(): Promise<void> {
  const calls: string[] = [];
  const result = await controllerWith(calls)
    .adopt(TEMPLATE, { assetIds: ids(26) }, JWT)
    .then(() => "resolved", (err: unknown) => (err instanceof BadRequestException ? "400" : String(err)));
  expect([result, calls]).toEqual(["400", []]);
}

/** Mutation: the preview route calls `adopt`, or the migration service. */
export async function thePreviewRouteCallsThePreview(): Promise<void> {
  const calls: string[] = [];
  await controllerWith(calls).previewAdoption(TEMPLATE, { assetIds: ids(2) }, JWT);
  expect(calls).toEqual([`preview ${TEMPLATE} 2`]);
}

/** Mutation: the adopt route calls `preview`, so nothing is ever written. */
export async function theAdoptRouteCallsAdopt(): Promise<void> {
  const calls: string[] = [];
  await controllerWith(calls).adopt(TEMPLATE, { assetIds: ids(1) }, JWT);
  expect(calls).toEqual([`adopt ${TEMPLATE} 1`]);
}
