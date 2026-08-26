import { BadRequestException, NotFoundException } from "@nestjs/common";
import { expect } from "vitest";
import pg from "pg";

import { DEFAULT_RULE_CATEGORY_CODE } from "@bms/shared";
import type { BmsDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import { countingDb } from "../testing/counting-db";
import type { RulesService } from "./rules.service";
import type { RuleDraftBody } from "./rules.schema";

/**
 * `E7.1b` — the org-stamping and ruling-4 proof for `RulesService.createDraft`
 * against real, non-owner roles.
 *
 * `createDraft` is the one rule-authoring write this unit tenant-wraps.
 * `automation_rules.organization_id` derives from the rule's asset (migration
 * `0046`) and the table gains a `tenant_isolation` policy + `FORCE` in `0047`.
 * Constructing the service with a real `bms_tenant` connection is the only proof
 * it stamps that column under `withTenant` — the owner/fleet connection bypasses
 * row-level security and would pass regardless — and that its actor resolution
 * still lands a non-NULL `audit_log.actor_id` from the pre-tenant `fleetDb`
 * identity read. It also proves ruling 4: an asset-less `time_window` create has
 * no org to derive and is refused rather than inserting a NULL.
 */
export type RulesRlsFixtures = {
  service: RulesService;
  /** The real `bms_tenant` handle — for building a counting-wrapped service. */
  tenantDb: BmsDb;
  /** The real `bms_fleet` handle — for building a counting-wrapped service. */
  fleetDb: BmsDb;
  /** Rebuilds the service with swapped db handles (the counter probe). */
  makeService: (tenantDb: BmsDb, fleetDb: BmsDb) => RulesService;
  /** A `bms_fleet` (BYPASSRLS) pool, for the verification reads only. */
  ownerPool: pg.Pool;
  organizationId: string;
  /** A seeded asset in `organizationId` and a point key compatible with it. */
  assetId: string;
  pointKey: string;
  /** An org-scoped actor whose email matches a seeded `bms.users` row. */
  scopedActor: Pick<JwtPayload, "sub" | "email">;
  /** A global admin (no single tenant), for the ruling-4 refusal. */
  adminActor: Pick<JwtPayload, "sub" | "email">;
  /** Rule ids the assertions create, for the lifecycle file to clean up. */
  createdRuleIds: string[];
  /** An asset in a second organization, outside the single-org caller's scope. */
  foreignAssetId: string;
  /** A seeded rule on `assetId` (org A) — the two-org read must include it. */
  inScopeRuleId: string;
  /** A seeded rule on `foreignAssetId` (org B) — likewise. */
  foreignRuleId: string;
};

function thresholdDraft(ctx: RulesRlsFixtures, code: string): RuleDraftBody {
  return {
    code,
    name: `E7.1b threshold ${code}`,
    description: null,
    // The default category is seeded, so `assertRuleCategory` (fleetDb) passes.
    category: DEFAULT_RULE_CATEGORY_CODE,
    ruleType: "threshold",
    assetId: ctx.assetId,
    pointKey: ctx.pointKey,
    operator: "gt",
    thresholdValue: 999_999,
    // null severity skips the alarm-severity vocab check — F4.46.
    severity: null,
    condition: { window: "latest" },
    action: { type: "notify", target: "Operations" },
  };
}

function timeWindowDraft(code: string): RuleDraftBody {
  return {
    code,
    name: `E7.1b window ${code}`,
    description: null,
    category: DEFAULT_RULE_CATEGORY_CODE,
    ruleType: "time_window",
    severity: null,
    condition: { days: ["mon"], startTime: "09:00", endTime: "17:00" },
    action: { type: "review", target: "Operations" },
  };
}

/**
 * A threshold `createDraft` under a real `bms_tenant` connection stamps
 * `automation_rules.organization_id` from the asset, and its audit row resolves
 * a non-NULL actor id from the pre-tenant `fleetDb` identity read.
 */
export async function assertCreateStampsOrgAndActorUnderRealRls(
  ctx: RulesRlsFixtures,
  code: string,
): Promise<void> {
  const created = await ctx.service.createDraft(
    thresholdDraft(ctx, code),
    ctx.scopedActor,
    [ctx.assetId],
  );
  ctx.createdRuleIds.push(created.id);

  const rule = await ctx.ownerPool.query<{ organization_id: string | null }>(
    "SELECT organization_id FROM bms.automation_rules WHERE id = $1",
    [created.id],
  );
  expect(rule.rows[0]?.organization_id, "automation_rules.org = the asset's org").toBe(
    ctx.organizationId,
  );

  const audit = await ctx.ownerPool.query<{ actor_id: string | null }>(
    `SELECT actor_id FROM bms.audit_log
      WHERE entity_type = 'automation_rule' AND entity_id = $1 AND action = 'rule_draft_create'`,
    [created.id],
  );
  expect(audit.rows.length, "the create wrote one audit row").toBe(1);
  expect(
    audit.rows[0]?.actor_id,
    "the actor resolved on fleetDb, so audit_log.actor_id is not NULL",
  ).not.toBeNull();
}

/**
 * Ruling 4: an asset-less `time_window` rule has no asset to derive an org from.
 * A global admin (no single tenant) is refused with a 4xx rather than inserting
 * a NULL `organization_id`, and nothing is written.
 */
export async function assertAssetlessTimeWindowRefusedForAdmin(
  ctx: RulesRlsFixtures,
  code: string,
): Promise<void> {
  await expect(
    // assetIds = null → the global-admin path; assertAssetInScope passes, then
    // resolveWriteOrg refuses because there is no asset to derive an org from.
    ctx.service.createDraft(timeWindowDraft(code), ctx.adminActor, null),
  ).rejects.toBeInstanceOf(BadRequestException);

  const rows = await ctx.ownerPool.query(
    "SELECT id FROM bms.automation_rules WHERE code = $1",
    [code],
  );
  expect(rows.rows.length, "a refused create writes no automation_rules row").toBe(0);
}

/**
 * Ruling 4, refuse-only (2026-08-26 decision): a scoped actor's asset-less
 * `time_window` create is 404'd by `assertAssetInScope` before org resolution —
 * the pre-existing behaviour E7.1b deliberately keeps. Org-scoped asset-less
 * creation waits for the E7.1d org-picker.
 */
export async function assertAssetlessTimeWindowRefusedForScoped(
  ctx: RulesRlsFixtures,
  code: string,
): Promise<void> {
  await expect(
    ctx.service.createDraft(timeWindowDraft(code), ctx.scopedActor, [ctx.assetId]),
  ).rejects.toBeInstanceOf(NotFoundException);

  const rows = await ctx.ownerPool.query(
    "SELECT id FROM bms.automation_rules WHERE code = $1",
    [code],
  );
  expect(rows.rows.length, "a 404'd create writes no automation_rules row").toBe(0);
}

/**
 * Decision 3: one `listRules` whose `assetIds` span two organizations returns
 * BOTH orgs' rules — the run-time fleet fallback resolves across organizations. A
 * `withTenant(one org)` regression would drop the other org's rows.
 */
export async function assertRuleListReturnsBothOrgsForTwoOrgActor(
  ctx: RulesRlsFixtures,
): Promise<void> {
  const both = await ctx.service.listRules([ctx.assetId, ctx.foreignAssetId]);
  const ids = both.items.map((i) => i.id);
  expect(ids, "org A's rule is returned on the two-org path").toContain(ctx.inScopeRuleId);
  expect(ids, "org B's rule is returned on the same read (fleet fallback)").toContain(
    ctx.foreignRuleId,
  );
}

/**
 * The mechanism seam: a single-organization `listRules` opens exactly one
 * **tenant** transaction (`withReadScope` → `withTenant`; `selectRuleRows` runs
 * inside it) and zero fleet transactions (org resolution uses `fleetDb.select`,
 * not `.transaction`). A revert of `listRules` to a bare `fleetDb` read drops the
 * tenant count to zero.
 */
export async function assertSingleOrgRuleListRunsOnTenantTransaction(
  ctx: RulesRlsFixtures,
): Promise<void> {
  const tenant = countingDb(ctx.tenantDb);
  const fleet = countingDb(ctx.fleetDb);
  const svc = ctx.makeService(tenant.db, fleet.db);
  await svc.listRules([ctx.assetId]);
  expect(tenant.transactions(), "a single-org listRules opens one tenant transaction").toBe(1);
  expect(fleet.transactions(), "a single-org listRules opens no fleet transaction").toBe(0);
}
