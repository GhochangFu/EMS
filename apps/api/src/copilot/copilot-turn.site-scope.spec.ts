import { expect } from "vitest";

import { COPILOT_SITE_SCOPE_PROMPT_RULE, COPILOT_SYSTEM_PROMPT } from "./copilot-turn.service";
import { COPILOT_READ_TOOL_DEFINITIONS } from "./tools/copilot-read-tool-set";

/**
 * `F4.291` PR 3 (ADR 0099 Amendment 9 E5; owner ruling P3) — the system
 * prompt tells the model how to read one site, a period and the next page.
 * The no-date, no-id rule for the fixed prompt is
 * `copilot-turn-cache-prefix.spec.ts`'s. Assertions here; the sibling
 * `.test.ts` is the Vitest entry (ADR 0014), one `it()` per claim.
 */

/** The prompt carries the site-scope rule as its own line. */
export function thePromptCarriesTheRule(): void {
  expect(COPILOT_SYSTEM_PROMPT.split("\n")).toContain(COPILOT_SITE_SCOPE_PROMPT_RULE);
}

/** The rule names the site argument, the relative range, both statistics tools and the cursor. */
export function theRuleNamesTheArgumentsAndTools(): void {
  for (const word of ["locationId", "lastDays", "get_alarm_stats", "get_point_stats", "cursor"]) {
    expect(COPILOT_SITE_SCOPE_PROMPT_RULE, word).toContain(word);
  }
}

/** Every tool the rule names is a read tool the model is given (a renamed tool cannot leave the prompt pointing at nothing). */
export function everyToolTheRuleNamesExists(): void {
  const named = [...COPILOT_SITE_SCOPE_PROMPT_RULE.matchAll(/\b(?:list|get)_[a-z_]+\b/g)].map((m) => m[0]);
  expect(named.length).toBeGreaterThan(3);
  const registry = new Set(COPILOT_READ_TOOL_DEFINITIONS.map((tool) => tool.name));
  expect(named.filter((name) => !registry.has(name))).toEqual([]);
}
