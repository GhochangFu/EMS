import { randomUUID } from "node:crypto";

import { expect } from "vitest";

import type { BmsDb } from "@bms/db";

import { findCalcPointBatch } from "./copilot-calc-point-targets";

/**
 * `F4.311` PR 3 (ADR 0099 Amendment 11 G3) — the `calcPointBatch` target on a
 * real database, read as `bms_tenant` so the tenant policy and the explicit
 * organization filter both bind. The batch route writes one organization's
 * **template-less** assets only, so the card must not be offered for a list
 * the route would refuse. Mutation: drop `isNull(assets.templateId)` from
 * `findCalcPointBatch` and {@link aPinnedAssetInTheListIsRefused} reddens.
 * Vitest entry point and the fixture lifecycle: the sibling `.test.ts`
 * (ADR 0014).
 */
export type CalcPointTargetsCtx = {
  tenantDb: BmsDb;
  orgA: string;
  orgB: string;
  /** Two template-less assets of `orgA`, each with `sharedKey`; `bareA1` also has `onlyA1Key`. */
  bareA1: string;
  bareA2: string;
  /** An asset of `orgA` pinned to a template version. */
  pinnedA: string;
  /** A template-less asset of `orgB`. */
  bareB: string;
  sharedKey: string;
  onlyA1Key: string;
};

/** The allowed twin: two template-less assets of one organization resolve to it, the refs the keys both have. */
export async function twoTemplateLessAssetsResolveToTheirOrganization(ctx: CalcPointTargetsCtx): Promise<void> {
  const batch = await findCalcPointBatch(ctx.tenantDb, [ctx.bareA1, ctx.bareA2], [ctx.orgA, ctx.orgB]);
  expect(batch).toEqual({ organizationId: ctx.orgA, assetIds: [ctx.bareA1, ctx.bareA2], pointKeys: [ctx.sharedKey] });
}

/** A pinned asset beside template-less ones refuses the batch: the route would refuse it. */
export async function aPinnedAssetInTheListIsRefused(ctx: CalcPointTargetsCtx): Promise<void> {
  expect(await findCalcPointBatch(ctx.tenantDb, [ctx.bareA1, ctx.pinnedA], [ctx.orgA, ctx.orgB])).toBeNull();
}

/** A twenty-sixth id is refused (`CALC_POINT_BATCH_MAX_ASSETS`), although every real asset in it is template-less. */
export async function twentySixIdsAreRefused(ctx: CalcPointTargetsCtx): Promise<void> {
  const ids = [ctx.bareA1, ctx.bareA2, ...Array.from({ length: 24 }, () => randomUUID())];
  expect(ids).toHaveLength(26);
  expect(await findCalcPointBatch(ctx.tenantDb, ids, [ctx.orgA, ctx.orgB])).toBeNull();
}

/** Assets of two organizations, both allowed, refuse the batch: the route writes one organization's. */
export async function twoOrganizationsAreRefused(ctx: CalcPointTargetsCtx): Promise<void> {
  expect(await findCalcPointBatch(ctx.tenantDb, [ctx.bareA1, ctx.bareB], [ctx.orgA, ctx.orgB])).toBeNull();
}

/** An asset outside the turn's allowed organizations is never found, so the batch naming it is refused. */
export async function anAssetOutsideTheAllowedOrganizationsIsRefused(ctx: CalcPointTargetsCtx): Promise<void> {
  expect(await findCalcPointBatch(ctx.tenantDb, [ctx.bareB], [ctx.orgA])).toBeNull();
}
