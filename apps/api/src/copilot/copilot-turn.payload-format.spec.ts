import { expect } from "vitest";

import { COPILOT_PAYLOAD_FORMAT_PROMPT_RULE, COPILOT_SYSTEM_PROMPT } from "./copilot-turn.service";
import { COPILOT_READ_TOOL_DEFINITIONS } from "./tools/copilot-read-tool-set";

/**
 * `F4.334` PR 5 (ADR 0099 Amendment 17 decisions 2, 3) — the system prompt tells the model to
 * propose a payload format only after a decode of the user's sample read what the user expects,
 * and never to ask for broker credentials. Assertions here; the sibling `.test.ts` is the Vitest
 * entry (ADR 0014), one `it()` per claim.
 */

/** The prompt carries the payload-format rule as its own line. */
export function thePromptCarriesTheRule(): void {
  expect(COPILOT_SYSTEM_PROMPT.split("\n")).toContain(COPILOT_PAYLOAD_FORMAT_PROMPT_RULE);
}

/** The rule names the decode tool, the user's sample and the readings, and forbids asking for credentials. */
export function theRuleNamesTheDecodeAndRefusesCredentials(): void {
  for (const word of ["decode_payload_sample", "user's own sample", "readings", "Never ask for broker credentials"]) {
    expect(COPILOT_PAYLOAD_FORMAT_PROMPT_RULE, word).toContain(word);
  }
}

/** The decode tool the rule names is a read tool the model is given. */
export function theToolTheRuleNamesExists(): void {
  const names = new Set(COPILOT_READ_TOOL_DEFINITIONS.map((tool) => tool.name));
  expect(names.has("decode_payload_sample")).toBe(true);
}

/** The prompt no longer says flatly that nothing can be deleted: a red delete card is a propose_ tool's. */
export function thePromptLetsAProposeToolDelete(): void {
  expect(COPILOT_SYSTEM_PROMPT).not.toContain("Nothing can be deleted, and");
  expect(COPILOT_SYSTEM_PROMPT).toContain("Nothing can be deleted except through a propose_ tool that offers it");
}
