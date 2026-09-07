import "reflect-metadata";

import { BadRequestException } from "@nestjs/common";

import { DEFAULT_RULE_CATEGORY_CODE } from "@bms/shared";
import type { BmsDb } from "@bms/db";

import type { AlarmRaiser } from "../alarms/alarm-raise.service";
import type { NotificationsService } from "../notifications/notifications.service";
import type { VocabulariesService } from "../vocabularies/vocabularies.service";
import { mergeRuleDraft } from "./rule-mapping";
import { ruleRow } from "./rule-mapping.spec";
import { RulesService } from "./rules.service";
import type { RuleDraftBody } from "./rules.schema";
import type { RuleDraftValues, RuleRow } from "./rules.types";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * `validateRuleDraft` is private, and reached here through one cast rather than
 * through a public method, because every public caller wraps it in a database
 * transaction.
 *
 * The cast is to a named shape rather than to `any` (AGENTS.md §4.1), and it is
 * worth being exact about what that does and does not buy. Because the shape
 * names `RuleDraftBody` and `RuleDraftValues`, a change to either type fails
 * the build **here**, at `:24` — which is the change most likely to invalidate
 * these cases. What it does not do is check that `RulesService` still has a
 * method by this name: `as unknown as` erases that, so a rename would surface
 * only when this spec runs. It does run in CI (§4.6), which is what makes that
 * acceptable rather than merely known.
 */
type ValidateAccess = {
  validateRuleDraft: (
    dto: RuleDraftBody,
    currentId: string | undefined,
    organizationId: string | null,
  ) => Promise<RuleDraftValues>;
};

type Chain = {
  from: () => Chain;
  innerJoin: () => Chain;
  where: () => Chain;
  orderBy: () => Chain;
  limit: () => Chain;
  then: (resolve: (rows: unknown[]) => void) => void;
};

/**
 * A thenable that answers every Drizzle builder call with itself and resolves
 * to `rows`. Enough for the three reads `validateRuleDraft` can perform: the
 * code uniqueness scan (`.select().from().orderBy()`), `assertCompatiblePoint`'s
 * asset lookup (`.select().from().where().limit()`) and — since `E2.4` widened
 * that check — `templatePointKeysForAsset`'s
 * `.select().from().innerJoin().where()`.
 */
function selectChain(rows: unknown[]): Chain {
  const chain: Chain = {
    from: () => chain,
    innerJoin: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => chain,
    then: (resolve) => resolve(rows),
  };
  return chain;
}

/**
 * `rows` answers every select, which is what every case written before `E2.4`
 * relies on. `queue`, when given, answers the selects **in order** and falls
 * back to `rows` once it is spent — the one thing `rows` alone cannot do, and
 * exactly what the widened `assertCompatiblePoint` needs: its asset lookup and
 * the template-point read are two selects that must answer differently.
 */
function validator(rows: unknown[] = [], queue?: unknown[][]): ValidateAccess {
  const pending = queue ? [...queue] : undefined;
  const nextRows = (): unknown[] => pending?.shift() ?? rows;
  // E7.1b: `validateRuleDraft`'s reads (the code scan, `assertCompatiblePoint`)
  // moved to `fleetDb`, so the same thenable stands in for both pools here.
  const db = { select: () => selectChain(nextRows()) } as unknown as BmsDb;
  // Both vocabularies are data — categories under ADR 0031 Amendment 1,
  // severities under ADR 0032 — and live in `bms.rule_categories` and
  // `bms.alarm_severities`. Whether a code is live is not what these cases are
  // about, so both checks are satisfied rather than exercised.
  const vocabularies = {
    assertRuleCategory: async () => undefined,
    assertAlarmSeverity: async () => undefined,
  } as unknown as VocabulariesService;
  // `validateRuleDraft` never raises — F3.6's addition to the constructor,
  // untouched by anything this file exercises.
  const alarmRaiser = {} as unknown as AlarmRaiser;
  // `F3.7`: nothing this file exercises raises, so nothing dispatches — the
  // stand-in resolves rather than being `{}`, so a regression that started
  // calling it here would fail on the assertion rather than on a TypeError.
  const notifications = {
    dispatch: () => Promise.resolve([]),
  } as unknown as NotificationsService;
  return new RulesService(
    db,
    db,
    vocabularies,
    alarmRaiser,
    notifications,
  ) as unknown as ValidateAccess;
}

const HVAC_ASSET = [{ code: "AHU-1", domain: "hvac" }];
const ASSET_ID = "11111111-1111-4111-8111-111111111111";

function thresholdDraft(severity?: RuleDraftBody["severity"]): RuleDraftBody {
  return {
    name: "Supply air high",
    description: null,
    category: DEFAULT_RULE_CATEGORY_CODE,
    ruleType: "threshold",
    assetId: ASSET_ID,
    pointKey: "supply_air_temp_c",
    operator: "gt",
    thresholdValue: 24,
    severity,
    condition: { window: "latest" },
    action: { type: "notify", target: "ops" },
  };
}

function timeWindowDraft(severity?: RuleDraftBody["severity"]): RuleDraftBody {
  return {
    name: "Weekday energy review",
    description: null,
    category: DEFAULT_RULE_CATEGORY_CODE,
    ruleType: "time_window",
    severity,
    condition: { days: ["mon", "tue"], startTime: "09:00", endTime: "17:00" },
    action: { type: "review", target: "ops" },
  };
}

/**
 * `F4.46`. A rule may legitimately have **no** severity, and this is the one
 * place that used to refuse to believe it.
 *
 * `automation_rules.severity` is nullable (`bms-schema.ts:560`), the write
 * schema accepts `null` (`rules.schema.ts:71`), `mergeRuleDraft` carefully
 * distinguishes an absent key from an explicit null (`rule-mapping.ts:171`),
 * and the read contract returns `z.string().nullable()`
 * (`contracts/operations.ts:359`). Every layer round-trips the null except this
 * one, which substituted `"warning"` for threshold rules and `"info"` for
 * time-window rules — on **all four** write paths, `updateRule` included. So an
 * update that simply did not mention severity overwrote a stored null.
 *
 * The defaults were not merely unused, they were misplaced. `alarms.severity`
 * is `NOT NULL` (`bms-schema.ts:474`) and that boundary already has its own
 * default: `defaultAlarmSeverity` (`alarm-severity-default.ts:21`) maps a null
 * rule to `"warning"` when `AlarmRaiser` raises it (F3.6 — this function used
 * to live as `AlarmThresholdService.normalizeSeverity` and was extracted when
 * the streaming and on-demand engines were unified). The time-window default
 * protected nothing at all — the streaming cache query filters to `ruleType =
 * "threshold"` (`alarm-engine.service.ts:81`), and `shouldRaise`
 * (`alarm-raise.service.ts`) makes the same exclusion explicit for the
 * on-demand evaluator, so a time-window rule never reaches either engine to
 * need a severity.
 */
export async function runRuleSeverityRoundTripTests(): Promise<void> {
  // `organizationId` is `null` throughout this function: none of these drafts
  // set `code`, so `validateRuleDraft`'s code-uniqueness scan never runs
  // regardless of what is passed — see `runRuleCodeUniquenessTests` below for
  // the cases that actually exercise it.
  const omittedThreshold = await validator(HVAC_ASSET).validateRuleDraft(
    thresholdDraft(),
    undefined,
    null,
  );
  assert(
    omittedThreshold.severity === null,
    `omitting severity on a threshold draft must store null, got ${String(omittedThreshold.severity)}`,
  );

  const explicitNullThreshold = await validator(HVAC_ASSET).validateRuleDraft(
    thresholdDraft(null),
    undefined,
    null,
  );
  assert(
    explicitNullThreshold.severity === null,
    `an explicit null on a threshold draft must survive, got ${String(explicitNullThreshold.severity)}`,
  );

  const criticalThreshold = await validator(HVAC_ASSET).validateRuleDraft(
    thresholdDraft("critical"),
    undefined,
    null,
  );
  assert(
    criticalThreshold.severity === "critical",
    `a chosen severity must survive, got ${String(criticalThreshold.severity)}`,
  );

  // The time-window branch reads no asset and, with `code` omitted, runs no
  // uniqueness scan either — so it needs no rows at all.
  const omittedWindow = await validator().validateRuleDraft(timeWindowDraft(), undefined, null);
  assert(
    omittedWindow.severity === null,
    `omitting severity on a time-window draft must store null, got ${String(omittedWindow.severity)}`,
  );

  const explicitWindow = await validator().validateRuleDraft(
    timeWindowDraft("info"),
    undefined,
    null,
  );
  assert(
    explicitWindow.severity === "info",
    `a chosen severity must survive on a time-window draft, got ${String(explicitWindow.severity)}`,
  );

  await runComposedUpdateTest();
}

/**
 * The round trip this fix is named for, over the two real functions that make
 * it up rather than over either one alone.
 *
 * `updateRule` does not hand a draft to `validateRuleDraft`; it hands one to
 * `mergeRuleDraft` first, which folds the PATCH body over the stored row. The
 * cases above prove the default is gone from the validator, and
 * `rule-mapping.spec.ts` proves the merge keeps an absent key — but the defect
 * lived in the **seam**: a stored null, plus a body that never mentions
 * severity, which is exactly what the builder sends for a rule that has none.
 * Nothing exercised the two together, so nothing would have caught it.
 */
async function runComposedUpdateTest(): Promise<void> {
  // The fixture's own asset/point pairing is kept — an `electrical` asset
  // reading `kw` — so `assertCompatiblePoint` passes on real data rather than
  // on a pairing invented here. Only the severity is overridden, because the
  // severity is the case.
  const stored = ruleRow({ severity: null });

  // organizationId: null — this case is about severity, not code identity,
  // and skipping the scan keeps it from depending on `stored`'s code never
  // colliding with the asset row's own `code` field the mock reuses below.
  const merged = await validator([
    { code: stored.assetCode, domain: stored.assetDomain },
  ]).validateRuleDraft(mergeRuleDraft(stored, {}), undefined, null);

  assert(
    merged.severity === null,
    `an update that never mentions severity must leave a null one alone, got ${String(merged.severity)}`,
  );

  assert(
    merged.clearHoldSeconds === 300,
    `a stored clear hold must survive an update that never mentions it, got ${String(merged.clearHoldSeconds)}`,
  );

  // `F3.10` — the same seam, one column over. `clearHoldSeconds` is nullable
  // for the same reason severity is (null means "the default, applied where
  // the value is consumed"), so the composed path has to preserve it too.
  // Neither `rule-mapping.spec.ts` nor the validator cases above see this
  // pair; that is what let `F4.46` live.
  const hold = ruleRow({ clearHoldSeconds: null });
  const mergedHold = await validator([
    { code: hold.assetCode, domain: hold.assetDomain },
  ]).validateRuleDraft(mergeRuleDraft(hold, {}), undefined, null);
  assert(
    mergedHold.clearHoldSeconds === null,
    `an update that never mentions the clear hold must leave a null one alone, got ${String(mergedHold.clearHoldSeconds)}`,
  );
}

/**
 * `E7.1c` Task 9 — the code-uniqueness check (`rule-codes.ts`,
 * `assertRuleCodeAvailable`) actually runs when a draft carries an explicit
 * `code`, and `organizationId: null` actually skips it.
 *
 * **What this does and does not prove.** `selectChain` (above) answers every
 * `.where(...)` call with the same fixed `rows`, regardless of what condition
 * is passed — so this mock cannot tell an org-scoped query from an unscoped
 * one, and a test built only on it would pass whether or not the real query
 * filters by `organizationId`. That would be exactly the "passes vacuously"
 * failure this task exists to avoid. The genuine two-organization proof — that
 * the SAME code succeeds in a second organization and still 400s twice in
 * the same one — runs against real Postgres in
 * `rules.service.rls.integration.spec.ts`
 * (`assertSameRuleCodePublishesInBothOrganizations`), where the database, not
 * a mock, does the filtering. This case only proves the check is wired in at
 * all, so a revert that deletes the call (rather than the filter) is caught
 * here too.
 */
export async function runRuleCodeUniquenessTests(): Promise<void> {
  const orgId = "22222222-2222-4222-8222-222222222222";
  const collisionRows = [{ id: "existing-rule-id", code: "DUP-CODE", lifecycleStatus: "draft" }];

  let threw = false;
  try {
    await validator(collisionRows).validateRuleDraft(
      { ...thresholdDraft(), code: "dup-code" },
      undefined,
      orgId,
    );
  } catch (err) {
    threw = err instanceof BadRequestException;
  }
  assert(threw, "a code already used by another rule must be rejected with a BadRequestException");

  // organizationId: null (previewRule's contract) skips the scan outright, so
  // the SAME colliding rows do not stop the draft from validating.
  const skipped = await validator(HVAC_ASSET).validateRuleDraft(
    { ...thresholdDraft(), code: "dup-code" },
    undefined,
    null,
  );
  assert(
    skipped.code === "DUP-CODE",
    `organizationId: null must skip the uniqueness check entirely, got code=${String(skipped.code)}`,
  );
}

/**
 * `E2.4` Q1 — `assertCompatiblePoint` accepts a point key the asset's **pinned
 * template** declares, not only one from `rule-points.ts`'s hard-coded map.
 *
 * The map falls through to `ELECTRICAL_POINT_KEYS` for every domain it does not
 * name, so before this widening a water, mechanical or facility asset built
 * from a template could not be given a rule on any of its own points. ADR
 * 0058's local override and its commissioning PATCH — the one that arms a
 * seeded philosophy row — both run through `validateRuleDraft`, so both were
 * API-refused for exactly the assets the ADR is about.
 *
 * The third case is the load-bearing one and it asserts on **existing**
 * behaviour: decision 3's update-path guard is already implemented, by
 * `validateRuleDraft`'s own threshold branch, and `ruleUpdateBodySchema` has no
 * `enabled` field at all. Only the toggle needed a new guard. This case exists
 * so the refusal has a name and a message pinned to it, and nobody later adds a
 * second copy of a guard that is already here.
 */
export async function runCompatiblePointWideningTests(): Promise<void> {
  // `domain: "water"` names no branch in `pointKeysForAsset`, so the hard-coded
  // lookup falls through to the electrical list, which this key is not in.
  const WATER_ASSET = [{ code: "WTP-1", domain: "water" }];
  const TEMPLATE_KEY = "residual_chlorine_mgl";
  // No `code` on the draft, so no uniqueness scan runs and the queue is exactly
  // two selects deep: the asset lookup, then the template-point read.
  const draft: RuleDraftBody = { ...thresholdDraft(), pointKey: TEMPLATE_KEY };

  const accepted = await validator(
    [],
    [WATER_ASSET, [{ pointKey: TEMPLATE_KEY }]],
  ).validateRuleDraft(draft, undefined, null);
  assert(
    accepted.pointKey === TEMPLATE_KEY,
    `a point key the pinned template declares must be accepted, got ${String(accepted.pointKey)}`,
  );

  // The same asset and the same key, with the template read answering nothing —
  // so this fails unless the widening genuinely consults the template set,
  // rather than accepting any key once the asset resolves.
  let refused: string | null = null;
  try {
    await validator([], [WATER_ASSET, []]).validateRuleDraft(draft, undefined, null);
  } catch (err) {
    refused = err instanceof BadRequestException ? err.message : `not a 400: ${String(err)}`;
  }
  assert(
    refused === "Selected telemetry point is not compatible with asset",
    `a key in neither set must keep the existing refusal, got ${String(refused)}`,
  );

  // ADR 0058 decision 3, update path — already guarded, pinned here.
  let halfBuilt: string | null = null;
  try {
    await validator(HVAC_ASSET).validateRuleDraft(
      { ...thresholdDraft(), operator: null },
      undefined,
      null,
    );
  } catch (err) {
    halfBuilt = err instanceof BadRequestException ? err.message : `not a 400: ${String(err)}`;
  }
  assert(
    halfBuilt === "Threshold rules require asset, point, operator, and threshold value",
    `a threshold draft with a null operator must already be refused on the update path, got ${String(halfBuilt)}`,
  );
}

type ReadChain = {
  from: () => ReadChain;
  leftJoin: () => ReadChain;
  where: () => ReadChain;
  orderBy: () => ReadChain;
  limit: () => ReadChain;
  then: (resolve: (rows: unknown[]) => void) => void;
};

/**
 * The read stand-in for {@link duplicatedValues} below. Like {@link selectChain}
 * it answers every Drizzle builder call with itself, but it discriminates on
 * `.leftJoin()`, because `duplicateRule` drives four reads that need two
 * different answers.
 *
 * The two that must resolve to the rule join the asset: `selectRuleRows`
 * (behind `getRuleRow`) and `selectRuleRowById` (the E7.1c read-back, which
 * 404s on an empty answer). The two that must resolve to nothing do not join:
 * `nextRuleCode`'s collision probe, which throws after a hundred taken
 * candidates, and `resolveActorId`'s `bms.users` lookup, where an unresolved
 * actor is a legitimate null rather than a failure.
 */
function ruleReadChain(row: RuleRow): ReadChain {
  let joined = false;
  const chain: ReadChain = {
    from: () => chain,
    leftJoin: () => {
      joined = true;
      return chain;
    },
    where: () => chain,
    orderBy: () => chain,
    limit: () => chain,
    then: (resolve) => resolve(joined ? [row] : []),
  };
  return chain;
}

/**
 * `.values()` has to be both awaitable and chainable: `insertRuleAuditLog`
 * awaits it bare, while the rule insert calls `.returning()` on it.
 */
type InsertResult = {
  returning: () => Promise<{ id: string }[]>;
  then: (resolve: (rows: unknown[]) => void) => void;
};

/** Runs the real `duplicateRule` and hands back the values it inserted. */
async function duplicatedValues(row: RuleRow): Promise<Record<string, unknown>> {
  const inserts: Record<string, unknown>[] = [];
  const tx = {
    // `withTenant`'s `set_config` — the fake has no GUC to set.
    execute: () => Promise.resolve(undefined),
    select: () => ruleReadChain(row),
    insert: () => ({
      values: (values: Record<string, unknown>): InsertResult => {
        inserts.push(values);
        return {
          returning: () => Promise.resolve([{ id: "copy-1" }]),
          then: (resolve) => resolve([]),
        };
      },
    }),
  };
  // One fake for both pools, as `validator` above does: `duplicateRule` reads
  // the source row and the actor on `fleetDb` and writes on the tenant handle,
  // and the chain discriminator, not the pool, decides what each read answers.
  const db = {
    transaction: (fn: (handle: unknown) => Promise<unknown>) => fn(tx),
    select: () => ruleReadChain(row),
  } as unknown as BmsDb;
  const vocabularies = {
    assertRuleCategory: async () => undefined,
    assertAlarmSeverity: async () => undefined,
  } as unknown as VocabulariesService;
  const alarmRaiser = {} as unknown as AlarmRaiser;
  const notifications = {
    dispatch: () => Promise.resolve([]),
  } as unknown as NotificationsService;

  const service = new RulesService(db, db, vocabularies, alarmRaiser, notifications);
  await service.duplicateRule(row.id, {}, {
    sub: "00000000-0000-4000-8000-0000000000d1",
    email: "duplicator@bms.local",
  });

  // Two inserts run: the rule copy and its audit row. The copy is the one
  // carrying `duplicatedFromRuleId`, which the audit entry never has.
  const copy = inserts.find((values) => "duplicatedFromRuleId" in values);
  if (!copy) {
    throw new Error("duplicateRule inserted no automation_rules row");
  }
  return copy;
}

/**
 * `F3.10` — the duplicate carries the source rule's clear hold.
 *
 * `duplicateRule` is the one write path that never reaches `validateRuleDraft`.
 * It enumerates the columns it copies inline, so a column added to
 * `automation_rules` is copied only if someone adds it to that list by hand —
 * and `clearHoldSeconds` was not on it. `clear_hold_seconds` is nullable with
 * no database default (`alarms-schema.ts:216`) and `null` MEANS "the default",
 * so the omission was silent: the copy stored null and the lifecycle sweep then
 * applied `DEFAULT_CLEAR_HOLD_SECONDS` to a rule whose operator had chosen 300.
 *
 * The assertion is on the object handed to `.values()`, because that is exactly
 * where the defect lived — the insert never carried the key at all. The
 * real-Postgres proof would belong in `rules.service.rls.integration.spec.ts`,
 * which has no `duplicateRule` case of any kind; that gap is reported rather
 * than filled here.
 */
export async function runDuplicateRuleCopiesClearHoldTests(): Promise<void> {
  const withHold = await duplicatedValues(ruleRow());
  assert(
    withHold.clearHoldSeconds === 300,
    `a duplicated rule must copy the stored clear hold, got ${String(withHold.clearHoldSeconds)}`,
  );

  // `=== null`, not a falsy or `== null` check. An ABSENT key is the whole
  // defect and `undefined` would satisfy either of those, so only strict
  // equality tells "copied a null" apart from "never copied the column".
  const withoutHold = await duplicatedValues(ruleRow({ clearHoldSeconds: null }));
  assert(
    withoutHold.clearHoldSeconds === null,
    `a null clear hold must be copied as null, got ${String(withoutHold.clearHoldSeconds)}`,
  );
}
