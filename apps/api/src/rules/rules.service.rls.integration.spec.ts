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
/**
 * `E8.6` / ADR 0046 Amendment 3 — the evaluator's IdP subject, as
 * `evaluateEnabledRules` stores it in `rule_executions.trace`.
 *
 * Fixed per module load rather than per run, because the driver seeds it and
 * the assertions read it. Deliberately **not** UUID-shaped, on the `E7.1h`
 * precedent: the assertions test for this value's *absence*, and a sentinel
 * that looked like any other identifier in the row could make that pass for the
 * wrong reason.
 */
export const EVALUATOR_SUBJECT = "e86-evaluator-subject-sentinel";

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
 * `E7.1c` (item D) — `previewRule`'s audit organization forks on whether the
 * draft resolves a real asset, the same review finding that closed
 * `rules.service.ts:286-306`'s previous unconditional `null`: a NULL on a
 * tenant-scoped row is a defect (`bms-schema.ts`'s own comment on
 * `audit_log.organization_id`), and an asset-bearing preview is the ORDINARY
 * case, not the exceptional one.
 *
 * Two branches, because a test that only exercised the asset-bearing case
 * would pass just as well if the code hard-coded a real org, and one that
 * only exercised the asset-less case would pass just as well if the revert
 * this closes still shipped.
 *
 * `countingDb`'s `.transaction()` counter is what discriminates the
 * asset-bearing branch — `withTenant` opens exactly one tenant transaction,
 * and `tx.insert(...)` inside it is a fresh Drizzle builder object the
 * counter never sees (only the top-level call is intercepted). The
 * asset-less branch opens no transaction on either pool, so
 * `countingDbMethod(db, "insert")`'s call-count is what discriminates it —
 * the same reasoning the pre-fix version of this assertion recorded.
 */
export async function assertPreviewAuditOrgForksOnAsset(
  ctx: RulesRlsFixtures,
  assetBearingCode: string,
  assetlessCode: string,
): Promise<void> {
  // `validateRuleDraft` uppercases `code` before it reaches the audit payload
  // (`rules.service.ts`: `dto.code?.trim().toUpperCase()`) — match that, or a
  // mixed-case `code` here (this file's own `PREFIX` embeds a lowercase
  // random-hex segment) finds zero rows and asserts nothing.
  async function auditOrgFor(code: string): Promise<string | null | undefined> {
    const audit = await ctx.ownerPool.query<{ organization_id: string | null }>(
      `SELECT organization_id FROM bms.audit_log
        WHERE action = 'rule_preview' AND payload->>'code' = $1
        ORDER BY created_at DESC LIMIT 1`,
      [code.toUpperCase()],
    );
    expect(audit.rows.length, `previewRule(${code}) wrote one audit row`).toBe(1);
    return audit.rows[0]?.organization_id;
  }

  // --- asset-bearing: a real org, routed through withTenant ---------------
  {
    const tenant = countingDb(ctx.tenantDb);
    const fleetInsert = countingDbMethod(ctx.fleetDb, "insert");
    const svc = ctx.makeService(tenant.db, fleetInsert.db);
    const dto: RulePreviewBody = { ...thresholdDraft(ctx, assetBearingCode), id: undefined };

    await svc.previewRule(dto, ctx.scopedActor, [ctx.assetId]);

    expect(
      tenant.transactions(),
      "an asset-bearing preview's audit write opens one tenant transaction",
    ).toBe(1);
    expect(fleetInsert.calls(), "no fleet insert for an asset-bearing preview's audit row").toBe(
      0,
    );
    expect(
      await auditOrgFor(assetBearingCode),
      "a preview whose asset resolves to a real organization stamps that organization, not null",
    ).toBe(ctx.organizationId);
  }

  // --- asset-less: nothing to derive, stays the platform-event NULL -------
  {
    const tenantInsert = countingDbMethod(ctx.tenantDb, "insert");
    const fleetInsert = countingDbMethod(ctx.fleetDb, "insert");
    const svc = ctx.makeService(tenantInsert.db, fleetInsert.db);
    const dto: RulePreviewBody = { ...timeWindowDraft(assetlessCode), id: undefined };

    // adminActor + assetIds: null, not scopedActor — a scoped actor's
    // asset-less draft 404s in `assertAssetInScope` before org resolution
    // even runs (ruling 4, refuse-only), which would prove nothing here.
    await svc.previewRule(dto, ctx.adminActor, null);

    expect(fleetInsert.calls(), "an asset-less preview's audit write reaches fleetDb").toBe(1);
    expect(
      tenantInsert.calls(),
      "no insert of any kind touches the tenant pool for an asset-less preview",
    ).toBe(0);
    expect(
      await auditOrgFor(assetlessCode),
      "a preview with no asset to derive an org from keeps decision 5's platform-event NULL",
    ).toBeNull();
  }
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
 * `E7.1c` Task 9 — the live-defect proof, on real Postgres rather than a mock.
 *
 * Before `0048` re-keyed `automation_rules`' identity to `(organization_id,
 * code)`, `validateRuleDraft`'s code-uniqueness scan read every tenant's codes
 * on `fleetDb`: creating the SAME code in a second organization found the
 * first organization's row and 400'd, and publishing carried the same defect
 * through its own re-validation. This is the one assertion that would have
 * caught it — `rules.service.spec.ts`'s mock answers every `.where(...)` with
 * the same fixed rows regardless of the filter, so it cannot tell an
 * org-scoped query from an unscoped one; only a real database, with real
 * per-organization rows, can go red on a revert of the `organizationId`
 * filter. The same code twice in the SAME organization must still 400 —
 * proving the check did not simply disappear.
 */
export async function assertSameRuleCodePublishesInBothOrganizations(
  ctx: RulesRlsFixtures,
  code: string,
): Promise<void> {
  const inOrgA = await ctx.service.createDraft(thresholdDraft(ctx, code), ctx.scopedActor, [
    ctx.assetId,
  ]);
  ctx.createdRuleIds.push(inOrgA.id);

  // Same code, a SECOND organization. `adminActor` + `assetIds: null` so
  // `assertAssetInScope` does not refuse a global admin acting on org B's
  // asset — `foreignAssetId`/`organizationId` are already used this way by
  // the decision-3 read assertions above.
  const inOrgB = await ctx.service.createDraft(
    thresholdDraft({ ...ctx, assetId: ctx.foreignAssetId }, code),
    ctx.adminActor,
    null,
  );
  ctx.createdRuleIds.push(inOrgB.id);

  // Publishing re-validates the rule's own code (scoped to its own org, since
  // Task 9): neither create's later publish may collide with the other's.
  await ctx.service.publishRule(inOrgA.id, { reason: "E7.1c org A publish" }, ctx.scopedActor, [
    ctx.assetId,
  ]);
  await ctx.service.publishRule(inOrgB.id, { reason: "E7.1c org B publish" }, ctx.adminActor, null);

  // The SAME code, a SECOND time, in the SAME organization: still refused.
  await expect(
    ctx.service.createDraft(thresholdDraft(ctx, code), ctx.scopedActor, [ctx.assetId]),
  ).rejects.toBeInstanceOf(BadRequestException);
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
  const both = await ctx.service.listExecutions(
    { limit: 200 },
    [ctx.assetId, ctx.foreignAssetId],
    // This assertion is about row isolation, not the projection. Read as the
    // global admin so the two concerns stay separable — a redacting read here
    // would still pass, and would quietly make this a test of two things.
    false,
  );
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
  const own = await ctx.service.listExecutions({ limit: 200 }, [ctx.assetId], false);
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
  await svc.listExecutions({ limit: 200 }, [ctx.assetId], false);
  expect(tenant.transactions(), "a single-org listExecutions opens one tenant transaction").toBe(1);
  expect(fleet.transactions(), "a single-org listExecutions opens no fleet transaction").toBe(0);
}

/**
 * `E8.6` / **ADR 0046 Amendment 3** — a non-`admin` reader does not see who
 * evaluated a rule.
 *
 * The third instance of the same projection rule (ADR 0043 Amendment 6, ADR
 * 0046 Amendment 2, this). `rules.service.ts` writes `evaluatedBy: actor.sub`
 * into `trace`, and `GET /rules/executions` carries **no role gate at all** —
 * it scopes on `readableAssetIds`, so `operator`, `viewer`, `location_admin`
 * and `asset_group_admin` all reach it. That audience is strictly wider than
 * the audit log's, which is why the ruling reached further than Amendment 2.
 *
 * **Step 1 is the falsifiability check and must stay first.** The fixture rows
 * carried `trace: {}` until `E8.6`; against those, every assertion below passes
 * word for word with the redaction deleted. `E7.1g` is the precedent and
 * `E7.1h` repeated it.
 *
 * **Removed, not replaced** (decision 8). Unlike the audit log — where
 * `actorEmail` survives because a ledger that cannot answer *"who changed
 * this"* fails at its purpose — the scoped reader here gains nothing in place
 * of the subject. A trace answers *what the rule saw*; the evaluator is not
 * part of that answer below `admin`. The asymmetry is the ruling, so it is
 * asserted rather than left to be re-litigated.
 */
export async function assertEvaluatorSubjectRedactedForNonAdmin(
  ctx: RulesRlsFixtures,
): Promise<void> {
  const traceOf = (item: { id: string; trace: unknown }, what: string): Record<string, unknown> => {
    expect(
      typeof item.trace === "object" && item.trace !== null && !Array.isArray(item.trace),
      `${what}: expected the parsed jsonb object, got ${
        item.trace === null ? "null" : typeof item.trace
      }. A string here means the column is no longer parsed by the driver.`,
    ).toBe(true);
    return item.trace as Record<string, unknown>;
  };

  // 1. The global admin still reads it — the forensic record is unchanged, and
  //    without this the assertions below cannot fail.
  const asAdmin = await ctx.service.listExecutions({ limit: 200 }, [ctx.assetId], false);
  const adminRow = asAdmin.items.find((i) => i.id === ctx.inScopeExecutionId);
  expect(adminRow, "the global admin reads the seeded execution").toBeDefined();
  expect(
    traceOf(adminRow!, "global admin's trace").evaluatedBy,
    "the global admin reads `evaluatedBy` unchanged. If this fails the fixture lost the key " +
      "and every assertion below is vacuous — it would pass against the unredacted reader too.",
  ).toBe(EVALUATOR_SUBJECT);

  // 2. A non-admin reader: the key is REMOVED, not blanked.
  const asScoped = await ctx.service.listExecutions({ limit: 200 }, [ctx.assetId], true);
  const scopedRow = asScoped.items.find((i) => i.id === ctx.inScopeExecutionId);
  expect(scopedRow, "the scoped reader still reads the row itself").toBeDefined();
  const scopedTrace = traceOf(scopedRow!, "scoped reader's trace");
  expect(
    "evaluatedBy" in scopedTrace,
    `the key is REMOVED, not set to null — \`trace - 'evaluatedBy'\` deletes it, and asserting ` +
      `absence is what distinguishes the two. Got: ${JSON.stringify(scopedTrace)}`,
  ).toBe(false);

  // 3. The rest of the trace survives. Without this, a reader that returned
  //    `trace: null` for every non-admin would satisfy step 2.
  expect(
    { source: scopedTrace.source, observed: scopedTrace.observed },
    "every other key survives — this removes one identity field, not the diagnostic payload " +
      "the endpoint exists to serve",
  ).toEqual({ source: "rule", observed: 1 });

  // 4. Not just the row the caller owns: redaction follows the reader, not the
  //    row's organization.
  const acrossOrgs = await ctx.service.listExecutions(
    { limit: 200 },
    [ctx.assetId, ctx.foreignAssetId],
    true,
  );
  expect(
    acrossOrgs.items.some((i) => "evaluatedBy" in traceOf(i, `row ${i.id}`)),
    "no row carries the evaluator's subject on a redacting read, in either organization",
  ).toBe(false);
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
