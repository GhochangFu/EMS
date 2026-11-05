import { expect } from "vitest";

import type { BmsDb } from "@bms/db";

import { withTenant } from "../database/tenant-context";
import { findConfigurationAsset, readAssetTarget } from "./copilot-asset-targets";

/**
 * `F4.316` PR 7 (ADR 0111 decision 5, ruling Q4) — the copilot's `asset`
 * target on a real database, read as `bms_tenant` under the asset's tenant:
 * the card names the asset `<code> · <RTU display name>`, and an asset with
 * no RTU `<code> · <location name>` (the LEFT JOIN keeps it). Vitest entry
 * point and the fixture lifecycle: the sibling `.test.ts` (ADR 0014).
 */
export type AssetTargetsCtx = {
  tenantDb: BmsDb;
  organizationId: string;
  /** An asset on `rtuName`'s RTU, and one with `rtu_id IS NULL`; both at `locationName`. */
  withRtu: string;
  withRtuCode: string;
  withoutRtu: string;
  withoutRtuCode: string;
  rtuName: string;
  locationName: string;
};

function read(ctx: AssetTargetsCtx, id: string) {
  return withTenant(ctx.tenantDb, ctx.organizationId, (tx) => readAssetTarget(tx, id, ctx.organizationId));
}

/** Q4: an asset on an RTU is named `<code> · <RTU display name>`. */
export async function anAssetOnAnRtuIsNamedByItsRtu(ctx: AssetTargetsCtx): Promise<void> {
  expect((await read(ctx, ctx.withRtu))?.name).toBe(`${ctx.withRtuCode} · ${ctx.rtuName}`);
}

/** The RTU-less twin: the asset is still found, and named `<code> · <location name>`. */
export async function anAssetWithNoRtuIsNamedByItsLocation(ctx: AssetTargetsCtx): Promise<void> {
  expect((await read(ctx, ctx.withoutRtu))?.name).toBe(`${ctx.withoutRtuCode} · ${ctx.locationName}`);
}

/** A rule, maintenance or work-order create names its asset by the same label, in the organization that holds it. */
export async function aCreatesAssetIsNamedByItsLabel(ctx: AssetTargetsCtx): Promise<void> {
  expect(await findConfigurationAsset(ctx.tenantDb, ctx.withRtu, [ctx.organizationId])).toEqual({
    organizationId: ctx.organizationId,
    name: `${ctx.withRtuCode} · ${ctx.rtuName}`,
    assetId: ctx.withRtu,
  });
}
