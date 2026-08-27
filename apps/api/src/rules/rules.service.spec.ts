import "reflect-metadata";

import { BadRequestException } from "@nestjs/common";

import { DEFAULT_RULE_CATEGORY_CODE } from "@bms/shared";
import type { BmsDb } from "@bms/db";

import type { AlarmRaiser } from "../alarms/alarm-raise.service";
import type { VocabulariesService } from "../vocabularies/vocabularies.service";
import { mergeRuleDraft } from "./rule-mapping";
import { ruleRow } from "./rule-mapping.spec";
import { RulesService } from "./rules.service";
import type { RuleDraftBody } from "./rules.schema";
import type { RuleDraftValues } from "./rules.types";

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
  where: () => Chain;
  orderBy: () => Chain;
  limit: () => Chain;
  then: (resolve: (rows: unknown[]) => void) => void;
};

/**
 * A thenable that answers every Drizzle builder call with itself and resolves
 * to `rows`. Enough for the two reads `validateRuleDraft` can perform: the code
 * uniqueness scan (`.select().from().orderBy()`) and `assertCompatiblePoint`'s
 * asset lookup (`.select().from().where().limit()`).
 */
function selectChain(rows: unknown[]): Chain {
  const chain: Chain = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => chain,
    then: (resolve) => resolve(rows),
  };
  return chain;
}

function validator(rows: unknown[] = []): ValidateAccess {
  // E7.1b: `validateRuleDraft`'s reads (the code scan, `assertCompatiblePoint`)
  // moved to `fleetDb`, so the same thenable stands in for both pools here.
  const db = { select: () => selectChain(rows) } as unknown as BmsDb;
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
  return new RulesService(db, db, vocabularies, alarmRaiser) as unknown as ValidateAccess;
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
