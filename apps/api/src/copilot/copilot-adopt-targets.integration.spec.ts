import { expect } from "vitest";

import type { BmsDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import { alreadyPinnedMessage, organizationMismatchMessage } from "../admin/asset-templates/asset-templates-adopt-messages";
import { type AdoptAccess, adoptMalformedIdMessage, resolveAdoptTarget } from "./copilot-adopt-targets";

/**
 * `F4.312` PR 2 (ADR 0099 Amendment 12) — the `assetTemplateAdopt` target on a
 * real database, read as `bms_tenant` so the tenant policy and the explicit
 * organization filter both bind. The adopt route pins template-less assets of
 * the version's own organization only, so the card must not be offered for a
 * list the route would refuse. The access checks are a global administrator's
 * (every check admits), so each refusal below is the read's, not the gate's.
 *
 * `F4.315` PR A (ADR 0099 Amendment 14): in scope, the refusal names its
 * cause with the route's sentence; an id found in no allowed organization
 * keeps the one refusal (`null`); a non-UUID version id is the malformed
 * sentence before any query (the query itself answers a Postgres `22P02`;
 * the propose tool's argument guard already refuses one, so this is the
 * resolver's second line).
 *
 * Mutation: drop `row.templateId !== null` from `adoptBatchRefusal` and
 * {@link aPinnedAssetIsRefused} reddens (its unit twin was seen red).
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
  /** The code of `versionA` (its version is 1). */
  versionCode: string;
  /** An asset of `orgA` pinned to `versionA`. */
  pinnedA: string;
  pinnedACode: string;
  /** The code of `bareB`. */
  bareBCode: string;
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

/** An asset of the other organization, both allowed, refuses the batch by the organization sentence (Amendment 14 decision 2). */
export async function anAssetOfTheOtherOrganizationIsRefused(ctx: AdoptTargetsCtx): Promise<void> {
  await expect(resolve(ctx, [ctx.bareA, ctx.bareB])).rejects.toThrow(
    organizationMismatchMessage({ code: ctx.bareBCode }, { code: ctx.versionCode, version: 1 }),
  );
}

/** A pinned asset beside a template-less one refuses the batch by the pinned sentence: the route's `already_pinned`. */
export async function aPinnedAssetIsRefused(ctx: AdoptTargetsCtx): Promise<void> {
  await expect(resolve(ctx, [ctx.bareA, ctx.pinnedA])).rejects.toThrow(
    alreadyPinnedMessage({ code: ctx.pinnedACode }, { code: ctx.versionCode, version: 1 }),
  );
}

/** An asset id found in no allowed organization keeps the one refusal (decision 3). */
export async function anAssetFoundNowhereKeepsTheGeneralRefusal(ctx: AdoptTargetsCtx, unknownId: string): Promise<void> {
  expect(await resolve(ctx, [ctx.bareA, unknownId])).toBeNull();
}

/** A version id that is not a UUID is the malformed sentence, before any query reaches Postgres. */
export async function aMalformedVersionIdIsTheMalformedSentence(ctx: AdoptTargetsCtx): Promise<void> {
  await expect(
    resolveAdoptTarget(ctx.tenantDb, GLOBAL_ADMIN, JWT, "PUMP-M", [ctx.bareA], [ctx.orgA, ctx.orgB]),
  ).rejects.toThrow(adoptMalformedIdMessage("PUMP-M"));
}
