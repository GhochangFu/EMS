import type {
  AssetInstantiationResultDto,
  DefaultDashboardsBackfillResultDto,
} from "@bms/shared";

import { backfillSummary, instantiationSummary } from "./default-dashboards-report";

/**
 * `F3.2` — the two report sentences (ADR 0067 decision 7, Q5).
 *
 * Assertions live here; `default-dashboards-report.test.ts` is the Vitest
 * entry point (ADR 0014).
 *
 * **One claim per exported function, on purpose.** `assert` throws, so only the
 * first failing claim inside a function ever reddens. The two claims a mutation
 * of the template string must reach — `dashboardCount` is in the sentence, and
 * `ruleCount` is in the sentence — are therefore each in their own function
 * with their own `it()`, rather than trailing a pluralisation claim that would
 * fire first and hide them.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** A batch of two assets: the ADR Q5 sentence, verbatim. */
function instantiated(
  overrides: Partial<AssetInstantiationResultDto> = {},
): AssetInstantiationResultDto {
  return {
    templateId: "11111111-1111-4111-8111-111111111111",
    templateCode: "electrical-feeder",
    templateVersion: 2,
    locationId: "22222222-2222-4222-8222-222222222222",
    rtuId: null,
    sourceKind: "unmapped",
    assets: [],
    assetCount: 2,
    pointCount: 8,
    ruleCount: 3,
    disabledRuleCount: 1,
    dashboardCount: 2,
    ...overrides,
  } as AssetInstantiationResultDto;
}

function backfilled(
  overrides: Partial<DefaultDashboardsBackfillResultDto> = {},
): DefaultDashboardsBackfillResultDto {
  return {
    templateId: "11111111-1111-4111-8111-111111111111",
    templateCode: "electrical-feeder",
    templateVersion: 2,
    assets: [],
    createdCount: 5,
    skippedCount: 3,
    ...overrides,
  } as DefaultDashboardsBackfillResultDto;
}

/** ADR 0067 Q5 fixes this sentence; it is quoted, not paraphrased. */
export function instantiationSummaryMatchesTheRuledSentence(): void {
  assert(
    instantiationSummary(instantiated()) === "Built 2 assets · 8 points · 3 rules · 2 dashboards",
    `ruled sentence changed: ${instantiationSummary(instantiated())}`,
  );
}

/**
 * The mutation this case exists for: drop `dashboardCount` from the template
 * string and this reddens. It asserts the *number* is present as its own
 * labelled clause, so a sentence that merely ends in the word "dashboards"
 * does not satisfy it.
 */
export function instantiationSummaryCarriesTheDashboardCount(): void {
  const sentence = instantiationSummary(instantiated({ dashboardCount: 7 }));
  assert(sentence.includes("7 dashboards"), `dashboard count missing from: ${sentence}`);
}

/**
 * The same for `ruleCount` — ADR 0058 decision 10's count, which has never
 * reached a screen before this row.
 */
export function instantiationSummaryCarriesTheRuleCount(): void {
  const sentence = instantiationSummary(instantiated({ ruleCount: 9 }));
  assert(sentence.includes("9 rules"), `rule count missing from: ${sentence}`);
}

/** One of everything: every noun drops its `s`, and none of the four is missed. */
export function instantiationSummarySingularisesEveryNoun(): void {
  const sentence = instantiationSummary(
    instantiated({ assetCount: 1, pointCount: 1, ruleCount: 1, dashboardCount: 1 }),
  );
  assert(
    sentence === "Built 1 asset · 1 point · 1 rule · 1 dashboard",
    `singular form wrong: ${sentence}`,
  );
}

/** Zero is plural, and a zero count is printed rather than dropped. */
export function instantiationSummaryPrintsZeroCounts(): void {
  const sentence = instantiationSummary(
    instantiated({ assetCount: 0, pointCount: 0, ruleCount: 0, dashboardCount: 0 }),
  );
  assert(
    sentence === "Built 0 assets · 0 points · 0 rules · 0 dashboards",
    `zero form wrong: ${sentence}`,
  );
}

/** `disabledRuleCount` is not one of Q5's four counts. */
export function instantiationSummaryOmitsTheDisabledRuleCount(): void {
  const sentence = instantiationSummary(instantiated({ ruleCount: 3, disabledRuleCount: 1 }));
  assert(!sentence.includes("disabled"), `disabled count leaked into: ${sentence}`);
}

/** Decision 4's sentence, verbatim. */
export function backfillSummaryMatchesTheRuledSentence(): void {
  const sentence = backfillSummary(backfilled());
  assert(
    sentence === "Created dashboards for 5 assets · 3 already had one",
    `ruled sentence changed: ${sentence}`,
  );
}

/** One created asset inflects the noun; "already had one" never inflects. */
export function backfillSummarySingularisesTheAssetNoun(): void {
  const sentence = backfillSummary(backfilled({ createdCount: 1, skippedCount: 1 }));
  assert(
    sentence === "Created dashboards for 1 asset · 1 already had one",
    `singular form wrong: ${sentence}`,
  );
}

/**
 * The second call of the backfill: nothing created, everything skipped. The
 * skipped clause is printed at zero too — a constant sentence shape is what the
 * browser layer asserts by exact match.
 */
export function backfillSummaryPrintsZeroCounts(): void {
  const both = backfillSummary(backfilled({ createdCount: 0, skippedCount: 0 }));
  assert(
    both === "Created dashboards for 0 assets · 0 already had one",
    `zero form wrong: ${both}`,
  );
}
