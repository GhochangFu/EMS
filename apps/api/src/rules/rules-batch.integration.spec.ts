import { randomUUID } from "node:crypto";

import { BadRequestException, HttpException, NotFoundException } from "@nestjs/common";
import { expect } from "vitest";
import type pg from "pg";

import { ruleBatchBodySchema } from "@bms/shared";
import type { JwtPayload, RuleBatchBody, RulesResponse } from "@bms/shared";

import { copilotContext } from "../copilot/copilot-request-context";
import { EVERY_ROW_EXCLUDED, ONE_ORGANIZATION_PER_BATCH, type RulesBatchService } from "./rules-batch.service";

/**
 * `F4.289` (ADR 0099 Amendment 9 E3) — `RulesBatchService.createAndPublish`
 * against real, non-owner roles: the inserts run on a real `bms_tenant`
 * connection under `withTenant`, so a published row, its audit rows and the
 * all-or-none rollback are read back from the database, not from a fake.
 *
 * Counts are taken on this suite's own fixture assets (`asset_id = ANY`), never
 * on a whole organization: a concurrent suite writing rules into the same
 * seeded organization cannot move them.
 */

export type RulesBatchFixtures = {
  service: RulesBatchService;
  /** The same service with an audit funnel whose `writeMany` throws (the rollback proof). */
  failingAuditService: RulesBatchService;
  /** A `bms_fleet` (BYPASSRLS) pool, for the verification reads only. */
  ownerPool: pg.Pool;
  /** Two assets in organization A, one in organization B, each with a compatible point key. */
  assetA1: string;
  assetA2: string;
  assetB: string;
  pointA1: string;
  pointA2: string;
  pointB: string;
  /** The per-run prefix; every rule name and explicit code starts with it. */
  prefix: string;
  actor: Pick<JwtPayload, "sub" | "email">;
};

type Row = { assetId: string; pointKey: string; name: string; code?: string };

/** A parsed batch body (the route's own parse, so `category` takes its default and `code` its preprocess). */
function batch(rows: readonly Row[], excludedRows?: number[]): RuleBatchBody {
  return ruleBatchBodySchema.parse({
    rules: rows.map((row) => ({
      ...(row.code === undefined ? {} : { code: row.code }),
      name: row.name,
      ruleType: "threshold",
      assetId: row.assetId,
      pointKey: row.pointKey,
      operator: "gt",
      thresholdValue: 999_999,
      severity: null,
      condition: { window: "latest" },
      action: { type: "notify", target: "Operations" },
    })),
    ...(excludedRows === undefined ? {} : { excludedRows }),
  });
}

const a1 = (ctx: RulesBatchFixtures, name: string, code?: string): Row => ({
  assetId: ctx.assetA1,
  pointKey: ctx.pointA1,
  name: `${ctx.prefix}${name}`,
  ...(code === undefined ? {} : { code: `${ctx.prefix}${code}` }),
});
const a2 = (ctx: RulesBatchFixtures, name: string): Row => ({ assetId: ctx.assetA2, pointKey: ctx.pointA2, name: `${ctx.prefix}${name}` });
const b = (ctx: RulesBatchFixtures, name: string): Row => ({ assetId: ctx.assetB, pointKey: ctx.pointB, name: `${ctx.prefix}${name}` });

/** The rules on one fixture asset. */
async function rulesOn(ctx: RulesBatchFixtures, assetId: string): Promise<number> {
  const result = await ctx.ownerPool.query<{ n: string }>(
    "SELECT count(*) AS n FROM bms.automation_rules WHERE asset_id = $1",
    [assetId],
  );
  return Number(result.rows[0]?.n ?? 0);
}

/** The rejection of `promise`, or a failure when it resolves. */
async function refusal(promise: Promise<unknown>): Promise<HttpException> {
  const outcome = await promise.then(
    () => null,
    (err: unknown) => err,
  );
  expect(outcome, "the call must be refused").toBeInstanceOf(HttpException);
  return outcome as HttpException;
}

async function auditRows(
  ctx: RulesBatchFixtures,
  created: RulesResponse,
): Promise<{ entity_id: string; action: string; payload: Record<string, unknown> | null }[]> {
  const result = await ctx.ownerPool.query<{ entity_id: string; action: string; payload: Record<string, unknown> | null }>(
    `SELECT entity_id, action, payload FROM bms.audit_log
      WHERE entity_type = 'automation_rule' AND entity_id = ANY($1) ORDER BY entity_id, action`,
    [created.items.map((item) => item.id)],
  );
  return result.rows;
}

/** Three rows become three rules, each stored published, enabled and stamped `published_at`. */
export async function threeRowsBecomeThreePublishedEnabledRules(ctx: RulesBatchFixtures): Promise<void> {
  const created = await ctx.service.createAndPublish(batch([a1(ctx, "three one"), a1(ctx, "three two"), a2(ctx, "three three")]), ctx.actor, null);
  expect(created.items).toHaveLength(3);
  const stored = await ctx.ownerPool.query<{ lifecycle_status: string; enabled: boolean; published: boolean }>(
    `SELECT lifecycle_status, enabled, published_at IS NOT NULL AS published
       FROM bms.automation_rules WHERE id = ANY($1)`,
    [created.items.map((item) => item.id)],
  );
  expect(stored.rows).toEqual([
    { lifecycle_status: "published", enabled: true, published: true },
    { lifecycle_status: "published", enabled: true, published: true },
    { lifecycle_status: "published", enabled: true, published: true },
  ]);
}

/** Every created rule has exactly two audit rows: its draft create and its publish (owner ruling P6). */
export async function everyRuleHasADraftCreateAndAPublishAuditRow(ctx: RulesBatchFixtures): Promise<void> {
  const created = await ctx.service.createAndPublish(batch([a1(ctx, "audit one"), a2(ctx, "audit two")]), ctx.actor, null);
  const rows = await auditRows(ctx, created);
  const actions = created.items
    .map((item) => rows.filter((row) => row.entity_id === item.id).map((row) => row.action))
    .map((list) => [...list].sort());
  expect(actions).toEqual([
    ["rule_draft_create", "rule_publish"],
    ["rule_draft_create", "rule_publish"],
  ]);
}

/** Inside a confirmed copilot change, every audit row of the batch carries `via: "copilot"` and the change id. */
export async function everyAuditRowCarriesTheCopilotMark(ctx: RulesBatchFixtures): Promise<void> {
  const changeId = randomUUID();
  const created = await copilotContext.run({ change: { via: "copilot", changeId } }, () =>
    ctx.service.createAndPublish(batch([a1(ctx, "mark one"), a2(ctx, "mark two")]), ctx.actor, null),
  );
  const marks = (await auditRows(ctx, created)).map((row) => [row.payload?.via, row.payload?.changeId]);
  expect(marks).toEqual(Array.from({ length: 4 }, () => ["copilot", changeId]));
}

/** The positive control for the mark: outside a copilot change, no audit row of the batch carries `via`. */
export async function outsideACopilotChangeNoAuditRowCarriesTheMark(ctx: RulesBatchFixtures): Promise<void> {
  const created = await ctx.service.createAndPublish(batch([a1(ctx, "nomark one")]), ctx.actor, null);
  const rows = await auditRows(ctx, created);
  expect(rows).toHaveLength(2);
  expect(rows.map((row) => row.payload?.via ?? null)).toEqual([null, null]);
}

/**
 * A failure inside the transaction (the audit write throws) leaves no rule
 * behind: all or none. The rejection must be the fixture's own audit error:
 * a pre-write refusal that fired on this fixture before the transaction opened
 * would also leave the count unchanged, and the claim would then prove nothing.
 */
export async function aFailureInsideTheTransactionCreatesNothing(ctx: RulesBatchFixtures): Promise<void> {
  const before = await rulesOn(ctx, ctx.assetA1);
  const err = await ctx.failingAuditService
    .createAndPublish(batch([a1(ctx, "fail one"), a1(ctx, "fail two")]), ctx.actor, null)
    .then(
      () => null,
      (e: unknown) => e,
    );
  expect(err instanceof Error && err.message).toBe("F4.289: the audit write fails on purpose");
  expect(await rulesOn(ctx, ctx.assetA1)).toBe(before);
}

/** An excluded row is not created; the kept rows are, by name. */
export async function excludedRowsAreNotCreated(ctx: RulesBatchFixtures): Promise<void> {
  const created = await ctx.service.createAndPublish(
    batch([a1(ctx, "keep zero"), a1(ctx, "drop one"), a2(ctx, "keep two")], [1]),
    ctx.actor,
    null,
  );
  expect(created.items.map((item) => item.name)).toEqual([`${ctx.prefix}keep zero`, `${ctx.prefix}keep two`]);
}

/** Every row excluded is a 400 with the sentence, and nothing is written. */
export async function everyRowExcludedIsRefused(ctx: RulesBatchFixtures): Promise<void> {
  const before = await rulesOn(ctx, ctx.assetA1);
  const err = await refusal(
    ctx.service.createAndPublish(batch([a1(ctx, "ex zero"), a1(ctx, "ex one"), a1(ctx, "ex two")], [0, 1, 2]), ctx.actor, null),
  );
  expect([err instanceof BadRequestException, err.message]).toEqual([true, EVERY_ROW_EXCLUDED]);
  expect(await rulesOn(ctx, ctx.assetA1)).toBe(before);
}

/**
 * Rows on two organizations' assets are a 400 before any write — and the odd
 * row is the third (A, A, B), so a check that compares only the first two rows
 * would insert organization B's rule under A's GUC instead. Counted on every
 * fixture asset of both organizations.
 */
export async function rowsOnTwoOrganizationsAreRefusedBeforeAnyWrite(ctx: RulesBatchFixtures): Promise<void> {
  const assetIds = [ctx.assetA1, ctx.assetA2, ctx.assetB];
  const before = await Promise.all(assetIds.map((id) => rulesOn(ctx, id)));
  const err = await refusal(
    ctx.service.createAndPublish(batch([a1(ctx, "org one"), a2(ctx, "org two"), b(ctx, "org three")]), ctx.actor, null),
  );
  expect([err instanceof BadRequestException, err.message]).toEqual([true, ONE_ORGANIZATION_PER_BATCH]);
  expect(await Promise.all(assetIds.map((id) => rulesOn(ctx, id)))).toEqual(before);
}

/** A row on an asset outside the caller's readable set is the route's own `Rule not found`, named by its row. */
export async function aRowOutsideTheReadableAssetsIsRefusedWithTheRouteSentence(ctx: RulesBatchFixtures): Promise<void> {
  const err = await refusal(
    ctx.service.createAndPublish(batch([a1(ctx, "scope one"), a2(ctx, "scope two")]), ctx.actor, [ctx.assetA1]),
  );
  expect([err instanceof NotFoundException, err.message]).toEqual([true, "Row 2: Rule not found"]);
}

/**
 * A row the validator refuses is a 400 named by its row. (`assertArmable` can
 * never refuse a row the validator accepts — the validator already demands an
 * operator and a threshold for a threshold rule — so the row-number claim is
 * made on an incompatible point; the service still calls `assertArmable`.)
 */
export async function aRowTheValidatorRefusesNamesItsRow(ctx: RulesBatchFixtures): Promise<void> {
  const before = await rulesOn(ctx, ctx.assetA1);
  const err = await refusal(
    ctx.service.createAndPublish(
      batch([a1(ctx, "valid one"), { ...a1(ctx, "invalid two"), pointKey: "F4289_NOT_A_POINT" }]),
      ctx.actor,
      null,
    ),
  );
  expect([err instanceof BadRequestException, err.message]).toEqual([
    true,
    "Row 2: Selected telemetry point is not compatible with asset",
  ]);
  expect(await rulesOn(ctx, ctx.assetA1)).toBe(before);
}

/** Two rows with the same name and no code get two distinct generated codes (Task 3, `nextRuleCode`'s `exclude`). */
export async function twoRowsWithTheSameNameGetDistinctCodes(ctx: RulesBatchFixtures): Promise<void> {
  const created = await ctx.service.createAndPublish(batch([a1(ctx, "same name"), a2(ctx, "same name")]), ctx.actor, null);
  const codes = created.items.map((item) => item.code);
  expect(new Set(codes).size).toBe(2);
}

/** Two rows with the same explicit code are a 400 naming both rows. */
export async function twoRowsWithTheSameExplicitCodeAreRefused(ctx: RulesBatchFixtures): Promise<void> {
  const err = await refusal(
    ctx.service.createAndPublish(
      batch([a1(ctx, "dup one", "DUP"), a2(ctx, "dup two"), a1(ctx, "dup three", "dup")]),
      ctx.actor,
      null,
    ),
  );
  expect([err instanceof BadRequestException, err.message]).toEqual([true, "Row 1 and row 3 carry the same code"]);
}

/**
 * Row 1 has no code, and row 2's explicit code is the one row 1's name would
 * generate: row 1 skips it, and both rows are created (not a 500 on the unique
 * index). The plan critic's code-generation defect.
 */
export async function anExplicitCodeLaterInTheBatchIsNotGeneratedForAnEarlierRow(ctx: RulesBatchFixtures): Promise<void> {
  const explicit = `${ctx.prefix}LATER`.toUpperCase();
  const created = await ctx.service.createAndPublish(
    batch([a1(ctx, "LATER"), { ...a2(ctx, "explicit later"), code: explicit }]),
    ctx.actor,
    null,
  );
  expect(created.items.map((item) => item.code)).toEqual([`${explicit}-2`, explicit]);
}

/**
 * A code that exists only in another organization does not move this
 * organization's generated code to the next suffix. `nextRuleCode` scans the
 * caller's organization alone, as the `(organization_id, code)` unique index
 * does: a global scan told a caller whether a code existed in another tenant.
 */
export async function aCodeTakenInAnotherOrganizationDoesNotMoveTheGeneratedCode(ctx: RulesBatchFixtures): Promise<void> {
  const elsewhere = `${ctx.prefix}ELSEWHERE`.toUpperCase();
  await ctx.service.createAndPublish(batch([{ ...b(ctx, "elsewhere b"), code: elsewhere }]), ctx.actor, null);
  const created = await ctx.service.createAndPublish(batch([a1(ctx, "ELSEWHERE")]), ctx.actor, null);
  expect(created.items.map((item) => item.code)).toEqual([elsewhere]);
}
