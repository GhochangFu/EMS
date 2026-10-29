import { expect } from "vitest";

import {
  copilotRuleBatchModelBodySchema,
  copilotRuleCreateModelBodySchema,
  RULE_BATCH_MAX_ROWS,
  ruleBatchBodySchema,
  ruleDraftBodySchema,
  ruleToggleBodySchema,
  ruleUpdateBodySchema,
} from "./rule-writes";

/**
 * `F4.278` (ADR 0099 Amendment 8, ADR 0030) — the alarm-rule request bodies,
 * now in `@bms/shared`. No database: every claim is a parse.
 */

const THRESHOLD = {
  name: "Chiller high",
  code: "chiller-high",
  ruleType: "threshold",
  pointKey: "supply_temp_c",
  operator: "gt",
  thresholdValue: 3,
  condition: { window: "latest" },
  action: { type: "notify", target: "Operations" },
};

const ASSET = "00000000-0000-4000-8000-000000000001";

/** `.strict()` survives `.partial().extend()`: an unknown key is refused. */
export function theUpdateBodyRefusesAnUnknownKey(): void {
  expect(ruleUpdateBodySchema.safeParse({ name: "Chiller high", colour: "red" }).success).toBe(false);
}

/** The positive control for the strict update: a known key alone parses. */
export function theUpdateBodyAcceptsAKnownKeyAlone(): void {
  expect(ruleUpdateBodySchema.safeParse({ name: "Chiller high" }).success).toBe(true);
}

/** The toggle body accepts `{ enabled: true }`. */
export function theToggleBodyAcceptsEnabled(): void {
  expect(ruleToggleBodySchema.safeParse({ enabled: true }).success).toBe(true);
}

/** The toggle body refuses `{ active: true }`. */
export function theToggleBodyRefusesActive(): void {
  expect(ruleToggleBodySchema.safeParse({ active: true }).success).toBe(false);
}

/** The copilot's create model body refuses a draft without an asset. */
export function theCreateModelBodyRefusesNoAsset(): void {
  expect(copilotRuleCreateModelBodySchema.safeParse(THRESHOLD).success).toBe(false);
}

/** The copilot's create model body accepts the same draft with an asset. */
export function theCreateModelBodyAcceptsAnAsset(): void {
  expect(copilotRuleCreateModelBodySchema.safeParse({ ...THRESHOLD, assetId: ASSET }).success).toBe(true);
}

/** The route's own draft body still accepts an asset-less draft (the 400 is the service's). */
export function theDraftBodyAcceptsNoAsset(): void {
  expect(ruleDraftBodySchema.safeParse(THRESHOLD).success).toBe(true);
}

/** `code` is trimmed and upper-cased by the preprocess. */
export function theCodeIsTrimmedAndUpperCased(): void {
  const parsed = ruleDraftBodySchema.parse({ ...THRESHOLD, code: "  chiller-high " });
  expect(parsed.code).toBe("CHILLER-HIGH");
}

/** `F4.289` (Amendment 9 E3) — `n` copies of the threshold draft, each on the asset. */
function drafts(n: number): Record<string, unknown>[] {
  return Array.from({ length: n }, () => ({ ...THRESHOLD, assetId: ASSET }));
}

/** The batch body refuses an empty `rules`. */
export function aBatchBodyRefusesNoRows(): void {
  expect(ruleBatchBodySchema.safeParse({ rules: [] }).success).toBe(false);
}

/** The batch body refuses a twenty-sixth row. */
export function aBatchBodyRefusesTwentySixRows(): void {
  expect(ruleBatchBodySchema.safeParse({ rules: drafts(26) }).success).toBe(false);
}

/** The positive control for the bound: twenty-five rows parse, and the bound is the exported constant. */
export function aBatchBodyAcceptsTwentyFiveRows(): void {
  expect(RULE_BATCH_MAX_ROWS).toBe(25);
  expect(ruleBatchBodySchema.safeParse({ rules: drafts(25) }).success).toBe(true);
}

/** An excluded row index past the last possible row (24) is refused. */
export function aBatchBodyRefusesAnExcludedRowPastTheBound(): void {
  expect(ruleBatchBodySchema.safeParse({ rules: drafts(25), excludedRows: [25] }).success).toBe(false);
}

/** The first and the last possible row index are accepted as excluded rows. */
export function aBatchBodyAcceptsTheFirstAndLastExcludedRow(): void {
  expect(ruleBatchBodySchema.safeParse({ rules: drafts(25), excludedRows: [0, 24] }).success).toBe(true);
}

/** The batch body is strict: an unknown top-level key is refused. */
export function aBatchBodyRefusesAnUnknownKey(): void {
  expect(ruleBatchBodySchema.safeParse({ rules: drafts(1), checks: [] }).success).toBe(false);
}

/** The model body refuses `excludedRows`: only the user's ticks may send it. */
export function theBatchModelBodyRefusesExcludedRows(): void {
  expect(copilotRuleBatchModelBodySchema.safeParse({ rules: drafts(2), excludedRows: [1] }).success).toBe(false);
}

/** The positive control for the strict model body: the same rows alone parse. */
export function theBatchModelBodyAcceptsTheRowsAlone(): void {
  expect(copilotRuleBatchModelBodySchema.safeParse({ rules: drafts(2) }).success).toBe(true);
}

/** The model body refuses a row without an asset. */
export function theBatchModelBodyRefusesAnAssetlessRow(): void {
  expect(copilotRuleBatchModelBodySchema.safeParse({ rules: [THRESHOLD] }).success).toBe(false);
}

/** The route's batch body accepts an asset-less row (the 400 is the service's, as for one draft). */
export function theBatchBodyAcceptsAnAssetlessRow(): void {
  expect(ruleBatchBodySchema.safeParse({ rules: [THRESHOLD] }).success).toBe(true);
}
