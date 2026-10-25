import { expect } from "vitest";

import {
  copilotRuleCreateModelBodySchema,
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
