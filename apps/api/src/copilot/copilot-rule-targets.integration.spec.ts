import { expect } from "vitest";
import { z } from "zod";

import type { BmsDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";
import type { CatalogEntry } from "@bms/shared/copilot";

import { NO_GRANTS, NO_USERS } from "../testing/copilot-user-checks";
import { findRuleBatch } from "./copilot-rule-targets";
import { CopilotTargetResolver } from "./copilot-target-resolver";

/**
 * `F4.289` (ADR 0099 Amendment 9 E3) — the `ruleBatch` target on a real
 * database, as `bms_tenant`: the rows' assets are read under each allowed
 * organization's tenant policy, the batch resolves to the one organization
 * that holds every asset, and the resolver's gate is the rule routes' own (the
 * `configuration` role class, then every row's asset in the read scope).
 *
 * The access service is a recorder (copied from
 * `copilot-target-resolver.integration.spec.ts`, which is at the line cap): it
 * keeps every call, so an assertion names the class the gate asked for. Each
 * refusal sits beside its accepted twin. Vitest entry point: the sibling
 * `.integration.test.ts` (ADR 0014).
 */

export type RuleTargetsCtx = {
  tenantDb: BmsDb;
  orgA: string;
  orgB: string;
  orgNameA: string;
  /** Two assets of A, one of B. */
  assetA1: string;
  assetA2: string;
  assetB: string;
};

type Call = [string, ...unknown[]];

/** An access service that records each call; `readable` is the caller's read scope (`null` = every asset). */
function recorder(readable: string[] | null = null) {
  const calls: Call[] = [];
  const access = {
    assertOperationsWriteRole: async (_user: JwtPayload, writeClass: string) => {
      calls.push(["assertOperationsWriteRole", writeClass]);
    },
    readableAssetIds: async () => {
      calls.push(["readableAssetIds"]);
      return readable;
    },
  };
  return { calls, access: access as never };
}

const JWT = { sub: "f4289-rule-targets" } as JwtPayload;

/** A catalog entry with only what the resolver reads: the `ruleBatch` target and no refs. */
const ENTRY: CatalogEntry = {
  id: "fixture.ruleBatch",
  title: "Fixture",
  method: "POST",
  path: "/fixtures",
  params: {},
  body: z.object({}).strict(),
  bodyName: null,
  clientOnly: [],
  risk: "create",
  target: { kind: "ruleBatch", field: "rules" },
  refs: [],
  formulas: [],
  steps: [],
  summary: () => "fixture",
};

const resolverWith = (ctx: RuleTargetsCtx, access: never) => new CopilotTargetResolver(ctx.tenantDb, access, NO_USERS, NO_GRANTS);
const body = (...assetIds: string[]) => ({ rules: assetIds.map((assetId) => ({ assetId })) });

/** Two rows on two assets of A resolve to A, named by the organization, with both assets. */
export async function twoRowsOnOneOrganizationResolveToIt(ctx: RuleTargetsCtx): Promise<void> {
  expect(await findRuleBatch(ctx.tenantDb, body(ctx.assetA1, ctx.assetA2).rules, [ctx.orgB, ctx.orgA])).toEqual({
    organizationId: ctx.orgA,
    assetIds: [ctx.assetA1, ctx.assetA2],
  });
  const resolved = await resolverWith(ctx, recorder().access).resolve(ENTRY, {}, body(ctx.assetA1, ctx.assetA2), [ctx.orgA], JWT);
  expect(resolved).toMatchObject({ organizationId: ctx.orgA, organizationName: ctx.orgNameA, targetName: ctx.orgNameA });
}

/** Rows split across two organizations are refused, whichever row is the odd one. */
export async function rowsSplitAcrossOrganizationsAreRefused(ctx: RuleTargetsCtx): Promise<void> {
  const allowed = [ctx.orgA, ctx.orgB];
  expect(await findRuleBatch(ctx.tenantDb, body(ctx.assetA1, ctx.assetA2, ctx.assetB).rules, allowed)).toBeNull();
  expect(await findRuleBatch(ctx.tenantDb, body(ctx.assetB, ctx.assetA1).rules, allowed)).toBeNull();
  expect(await resolverWith(ctx, recorder().access).resolve(ENTRY, {}, body(ctx.assetA1, ctx.assetB), allowed, JWT)).toBeNull();
}

/** An asset in no allowed organization is not found: the batch is refused. */
export async function anAssetOutsideTheAllowedOrganizationsIsRefused(ctx: RuleTargetsCtx): Promise<void> {
  expect(await findRuleBatch(ctx.tenantDb, body(ctx.assetA1, ctx.assetB).rules, [ctx.orgA])).toBeNull();
}

/** A row whose asset is outside the caller's read scope is refused; with both assets readable the batch resolves. */
export async function aRowWhoseAssetIsOutsideTheReadScopeIsRefused(ctx: RuleTargetsCtx): Promise<void> {
  const narrow = recorder([ctx.assetA1]);
  expect(await resolverWith(ctx, narrow.access).resolve(ENTRY, {}, body(ctx.assetA1, ctx.assetA2), [ctx.orgA], JWT)).toBeNull();
  expect(narrow.calls).toContainEqual(["readableAssetIds"]);
  const wide = recorder([ctx.assetA1, ctx.assetA2]);
  expect(await resolverWith(ctx, wide.access).resolve(ENTRY, {}, body(ctx.assetA1, ctx.assetA2), [ctx.orgA], JWT)).not.toBeNull();
}

/** The gate asks for the `configuration` role class, the rule routes' own (not the work-order batch's `operational`). */
export async function theGateIsTheConfigurationRoleClass(ctx: RuleTargetsCtx): Promise<void> {
  const access = recorder();
  await resolverWith(ctx, access.access).resolve(ENTRY, {}, body(ctx.assetA1), [ctx.orgA], JWT);
  expect(access.calls.filter((call) => call[0] === "assertOperationsWriteRole")).toEqual([["assertOperationsWriteRole", "configuration"]]);
}
