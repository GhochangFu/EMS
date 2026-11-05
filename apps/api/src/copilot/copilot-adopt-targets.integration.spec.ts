import { expect } from "vitest";

import type { BmsDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import { type AdoptAccess, resolveAdoptTarget } from "./copilot-adopt-targets";

/**
 * `F4.312` PR 2 (ADR 0099 Amendment 12) — the `assetTemplateAdopt` target on a
 * real database, read as `bms_tenant` so the tenant policy and the explicit
 * organization filter both bind. The adopt route pins template-less assets of
 * the version's own organization only, so the card must not be offered for a
 * list the route would refuse. The access checks are a global administrator's
 * (every check admits), so each refusal below is the read's, not the gate's.
 *
 * Mutation: drop `row.templateId !== null` from `adoptBatchAdmits` and
 * {@link aPinnedAssetIsRefused} reddens (its unit twin was seen red; this
 * file runs only where a database is, in CI).
 * Vitest entry point and the fixture lifecycle: the sibling `.test.ts`
 * (ADR 0014).
 */
export type AdoptTargetsCtx = {
  tenantDb: BmsDb;
  orgA: string;
  orgB: string;
  /** A published version of `orgA`. */
  versionA: string;
  /** A template-less asset of `orgA`, in the version's domain. */
  bareA: string;
  /** An asset of `orgA` pinned to `versionA`. */
  pinnedA: string;
  /** A template-less asset of `orgB`, in the version's domain. */
  bareB: string;
};

const JWT = { sub: "f4312-adopt-integration", role: "admin" } as JwtPayload;

/** A global administrator's answers: every check admits, and every site is writable. */
const GLOBAL_ADMIN: AdoptAccess = {
  requireMasterDataUser: async () => undefined,
  canManageOrganization: async () => true,
  writableLocationIds: async () => null,
} as unknown as AdoptAccess;

const resolve = (ctx: AdoptTargetsCtx, assetIds: string[]) =>
  resolveAdoptTarget(ctx.tenantDb, GLOBAL_ADMIN, JWT, ctx.versionA, assetIds, [ctx.orgA, ctx.orgB]);

/** The allowed twin: a template-less asset of the version's organization resolves to that organization. */
export async function aTemplateLessAssetOfTheVersionsOrganizationResolves(ctx: AdoptTargetsCtx): Promise<void> {
  expect((await resolve(ctx, [ctx.bareA]))?.organizationId).toBe(ctx.orgA);
}

/** An asset of the other organization, both allowed, refuses the batch: the route pins the version's organization's only. */
export async function anAssetOfTheOtherOrganizationIsRefused(ctx: AdoptTargetsCtx): Promise<void> {
  expect(await resolve(ctx, [ctx.bareA, ctx.bareB])).toBeNull();
}

/** A pinned asset beside a template-less one refuses the batch: the route refuses `already_pinned`. */
export async function aPinnedAssetIsRefused(ctx: AdoptTargetsCtx): Promise<void> {
  expect(await resolve(ctx, [ctx.bareA, ctx.pinnedA])).toBeNull();
}
