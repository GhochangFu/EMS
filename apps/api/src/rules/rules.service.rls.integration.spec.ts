import { BadRequestException, NotFoundException } from "@nestjs/common";
import { expect } from "vitest";
import pg from "pg";

import { DEFAULT_RULE_CATEGORY_CODE } from "@bms/shared";
import type { BmsDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import { countingDb, countingDbMethod } from "../testing/counting-db";
import type { RulesService } from "./rules.service";
import type { RuleDraftBody, RulePreviewBody } from "./rules.schema";

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
  /** A seeded execution of `inScopeRuleId` (org A) — the listExecutions reads. */
  inScopeExecutionId: string;
  /** A seeded execution of `foreignRuleId` (org B) — likewise. */
  foreignExecutionId: string;
  /**
   * A seeded execution on a THIRD asset in org A that the reads never pass. It is
   * the outside row that gates the `assetIds` SQL WHERE — there are no seeded
   * executions to serve as one, so without a decoy the exclusion is vacuous.
   */
  decoyExecutionId: string;
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
 *
 * `E7.1c` (item D) — also asserts `audit_log.organization_id` on the same row.
 * `insertRuleAuditLog` folds into `createDraft`'s own `withTenant` transaction
 * (via `tx`, `rule-audit.ts`), so `countingDb`'s `.transaction()` counter
 * cannot see this land: folding an insert into an ALREADY-OPEN transaction
 * opens no new one, and `assertCreateDraftReadsBackOnTenantTransaction` below
 * already pins that count at 1 both before and after this stamp existed. The
 * only way to prove the value landed is to read it back, which is what this
 * does.
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

  const audit = await ctx.ownerPool.query<{ actor_id: string | null; organization_id: string | null }>(
    `SELECT actor_id, organization_id FROM bms.audit_log
      WHERE entity_type = 'automation_rule' AND entity_id = $1 AND action = 'rule_draft_create'`,
    [created.id],
  );
  expect(audit.rows.length, "the create wrote one audit row").toBe(1);
  expect(
    audit.rows[0]?.actor_id,
    "the actor resolved on fleetDb, so audit_log.actor_id is not NULL",
  ).not.toBeNull();
  expect(
    audit.rows[0]?.organization_id,
    "E7.1c item D: the audit row carries the SAME org as the rule it describes",
  ).toBe(ctx.organizationId);
}

/**
 * `E7.1c` — the post-write read-back (`getRuleRow`) is folded into the write's
 * own `withTenant` transaction, so a single-org `createDraft` opens exactly one
 * tenant transaction and zero fleet transactions. Before E7.1c the read-back was
 * a separate `fleetDb.transaction(selectRuleRows)` reading every tenant's rules;
 * a revert restores that one fleet transaction, so `fleet.transactions() === 0`
 * is the discriminating assertion.
 */
export async function assertCreateDraftReadsBackOnTenantTransaction(
  ctx: RulesRlsFixtures,
  code: string,
): Promise<void> {
  const tenant = countingDb(ctx.tenantDb);
  const fleet = countingDb(ctx.fleetDb);
  const svc = ctx.makeService(tenant.db, fleet.db);
  const created = await svc.createDraft(thresholdDraft(ctx, code), ctx.scopedActor, [ctx.assetId]);
  ctx.createdRuleIds.push(created.id);
  expect(
    tenant.transactions(),
    "createDraft writes and reads back in one tenant transaction",
  ).toBe(1);
  expect(
    fleet.transactions(),
    "the folded read-back opens no fleet transaction (org/actor/code use fleet.select)",
  ).toBe(0);
}

/**
 * `E7.1c` (item D) — `previewRule` is the (b)-classified audit site: a
 * genuinely org-less write (a preview may evaluate an unsaved draft), routed
 * to `fleetDb` with `organizationId: null` rather than the default tenant
 * pool. `countingDb`'s own `.transaction()` counter cannot see this either
 * way — `previewRule` opens no transaction on any pool, tenant or fleet, so
 * that counter reads `0`/`0` regardless of which pool the insert actually
 * reached. `countingDbMethod(db, "insert")` counts the `.insert(...)` call
 * itself instead, which is the seam that actually discriminates: a revert to
 * the funnel's old `this.db` default would move this insert onto the tenant
 * pool and this assertion would flip.
 */
export async function assertPreviewAuditIsNullOrgOnFleetPool(
  ctx: RulesRlsFixtures,
  code: string,
): Promise<void> {
  const tenant = countingDbMethod(ctx.tenantDb, "insert");
  const fleet = countingDbMethod(ctx.fleetDb, "insert");
  const svc = ctx.makeService(tenant.db, fleet.db);
  const dto: RulePreviewBody = { ...thresholdDraft(ctx, code), id: undefined };

  await svc.previewRule(dto, ctx.scopedActor, [ctx.assetId]);

  expect(fleet.calls(), "previewRule's audit write reaches fleetDb, not the tenant pool").toBe(1);
  expect(tenant.calls(), "no insert of any kind touches the tenant pool for a preview").toBe(0);

  // `validateRuleDraft` uppercases `code` before it reaches the audit payload
  // (`rules.service.ts`: `dto.code?.trim().toUpperCase()`) — match that, or a
  // mixed-case `code` here (this file's own `PREFIX` embeds a lowercase
  // random-hex segment) finds zero rows and asserts nothing.
  const audit = await ctx.ownerPool.query<{ organization_id: string | null }>(
    `SELECT organization_id FROM bms.audit_log
      WHERE action = 'rule_preview' AND payload->>'code' = $1
      ORDER BY created_at DESC LIMIT 1`,
    [code.toUpperCase()],
  );
  expect(audit.rows.length, "previewRule wrote one audit row").toBe(1);
  expect(
    audit.rows[0]?.organization_id,
    "a preview has no org to attribute — decision 5's platform-event NULL",
  ).toBeNull();
}

/**
 * `E7.1c` — `updateRule` pins the inline-fold-with-pre-write variant: the
 * pre-write `getRuleRow` stays on `fleetDb` (one fleet transaction) and the
 * post-write read-back folds into the write's `withTenant` (one tenant
 * transaction). Before E7.1c the post-write `getRuleRow` added a SECOND fleet
 * transaction, so `fleet.transactions() === 1` discriminates a revert of just
 * this site.
 */
export async function assertUpdateRuleReadsBackInTenantTransaction(
  ctx: RulesRlsFixtures,
  code: string,
): Promise<void> {
  const created = await ctx.service.createDraft(thresholdDraft(ctx, code), ctx.scopedActor, [
    ctx.assetId,
  ]);
  ctx.createdRuleIds.push(created.id);

  const tenant = countingDb(ctx.tenantDb);
  const fleet = countingDb(ctx.fleetDb);
  const svc = ctx.makeService(tenant.db, fleet.db);
  await svc.updateRule(created.id, { name: `${code}-updated` }, ctx.scopedActor, [ctx.assetId]);
  expect(
    tenant.transactions(),
    "updateRule writes and reads back in one tenant transaction",
  ).toBe(1);
  expect(fleet.transactions(), "only the pre-write current-row read runs on fleet").toBe(1);
}

/**
 * `E7.1c` — `publishRule` pins the `writeLifecycleUpdate` fold variant (also used
 * by `archiveRule`): the write and its read-back run in one `withTenant`, the
 * pre-write `getRuleRow` is the only fleet transaction. Same discriminating
 * assertion as `updateRule`.
 */
export async function assertPublishRuleReadsBackInTenantTransaction(
  ctx: RulesRlsFixtures,
  code: string,
): Promise<void> {
  const created = await ctx.service.createDraft(thresholdDraft(ctx, code), ctx.scopedActor, [
    ctx.assetId,
  ]);
  ctx.createdRuleIds.push(created.id);

  const tenant = countingDb(ctx.tenantDb);
  const fleet = countingDb(ctx.fleetDb);
  const svc = ctx.makeService(tenant.db, fleet.db);
  await svc.publishRule(created.id, { reason: "E7.1c publish read-back" }, ctx.scopedActor, [
    ctx.assetId,
  ]);
  expect(
    tenant.transactions(),
    "publishRule writes and reads back in one tenant transaction",
  ).toBe(1);
  expect(fleet.transactions(), "only the pre-write current-row read runs on fleet").toBe(1);
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
  // Exactly the rows the filter allows (ADR 0043 ruling 3). On the fleet path the
  // isolation control is `filterRuleRowsByAssetIds`, not a SQL WHERE; the seed's
  // 337 rules on other assets would surface here if that post-filter were dropped.
  expect(
    both.items.every(
      (i) => i.assetId !== null && [ctx.assetId, ctx.foreignAssetId].includes(i.assetId),
    ),
    "the fleet read returns no rule outside the passed assetIds",
  ).toBe(true);
}

/**
 * The single-organization tenant path (decision 1) actually returns the caller's
 * own rule — not a silently-empty list — and excludes the other org's, under the
 * org GUC and the assetIds post-filter both.
 */
export async function assertSingleOrgRuleListReturnsOwnRow(
  ctx: RulesRlsFixtures,
): Promise<void> {
  const own = await ctx.service.listRules([ctx.assetId]);
  const ids = own.items.map((i) => i.id);
  expect(ids, "the single-org tenant read returns the caller's own rule").toContain(
    ctx.inScopeRuleId,
  );
  expect(ids, "the single-org read excludes the other org's rule").not.toContain(
    ctx.foreignRuleId,
  );
}

/**
 * `listExecutions` mirrors `listRules`: decision 3 returns both orgs' executions
 * on one fleet read behind the `assetIds` SQL WHERE; the single-org path returns
 * only the caller's own under `withTenant`; and the fleet read returns nothing
 * outside the passed assetIds.
 */
export async function assertRuleExecutionListReturnsBothOrgsForTwoOrgActor(
  ctx: RulesRlsFixtures,
): Promise<void> {
  const both = await ctx.service.listExecutions({ limit: 200 }, [ctx.assetId, ctx.foreignAssetId]);
  const ids = both.items.map((i) => i.id);
  expect(ids, "org A's execution is returned on the two-org path").toContain(ctx.inScopeExecutionId);
  expect(ids, "org B's execution is returned on the same read (fleet fallback)").toContain(
    ctx.foreignExecutionId,
  );
  // The fleet path has no GUC, so the `automationRules.assetId IN assetIds` WHERE
  // is the ONLY isolation control. The decoy's rule is on an asset never passed,
  // so dropping that WHERE would surface it here (ADR 0043 ruling 3).
  expect(
    ids,
    "an execution whose rule's asset is outside the passed assetIds is excluded",
  ).not.toContain(ctx.decoyExecutionId);
}

export async function assertSingleOrgRuleExecutionListReturnsOwnRow(
  ctx: RulesRlsFixtures,
): Promise<void> {
  const own = await ctx.service.listExecutions({ limit: 200 }, [ctx.assetId]);
  const ids = own.items.map((i) => i.id);
  expect(ids, "the single-org tenant read returns the caller's own execution").toContain(
    ctx.inScopeExecutionId,
  );
  expect(ids, "the single-org read excludes the other org's execution").not.toContain(
    ctx.foreignExecutionId,
  );
  // The decoy is in org A too, so the org GUC alone would not exclude it — the
  // assetIds WHERE must, even on the tenant path.
  expect(ids, "the single-org read excludes an in-org asset outside the scope").not.toContain(
    ctx.decoyExecutionId,
  );
}

export async function assertSingleOrgRuleExecutionListRunsOnTenantTransaction(
  ctx: RulesRlsFixtures,
): Promise<void> {
  const tenant = countingDb(ctx.tenantDb);
  const fleet = countingDb(ctx.fleetDb);
  const svc = ctx.makeService(tenant.db, fleet.db);
  await svc.listExecutions({ limit: 200 }, [ctx.assetId]);
  expect(tenant.transactions(), "a single-org listExecutions opens one tenant transaction").toBe(1);
  expect(fleet.transactions(), "a single-org listExecutions opens no fleet transaction").toBe(0);
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
