import { expect } from "vitest";

import { UUID_TEXT, fixtureSecrets, fxaForecastCard, fxbAnomalyCard } from "./findings-paragraph.fixture";
import { FINDINGS_SYSTEM_PROMPT, buildFindingsPrompt } from "./findings-prompt";
import { pseudonymiseFacts } from "./findings-pseudonymise";

/**
 * `E1.9c` / ADR 0135 Amendment 8 decisions 5 and 6 (plan §4.4, T3.2) — the two
 * messages of one call. Assertions live here; `findings-prompt.test.ts` is the
 * vitest entry point (ADR 0014).
 */
export function theSystemTextHoldsEachRule(): void {
  for (const rule of [
    "Use only these facts",
    "Write numbers as digits",
    "Never spell a number as a word",
    "Copy each placeholder exactly as written",
    "Never invent a placeholder",
    "one paragraph of plain text",
    "no markdown",
    "no links",
    "At most 600 characters",
    "Strongest signal:",
    "\"weak\"",
    "Do not add advice",
    "calm, factual tone",
  ]) {
    expect(FINDINGS_SYSTEM_PROMPT, rule).toContain(rule);
  }
}

export function theUserTextIsExactlyTheKindAndTheLines(): void {
  const messages = buildFindingsPrompt("anomalies", ["line one", "line two"]);
  expect(messages).toEqual([
    { role: "system", content: FINDINGS_SYSTEM_PROMPT },
    { role: "user", content: "Kind: anomalies\nFacts:\nline one\nline two" },
  ]);
}

export function thePromptHoldsNoFixtureNameAndNoUuid(): void {
  for (const [kind, card] of [
    ["forecasts", fxaForecastCard()],
    ["anomalies", fxbAnomalyCard()],
  ] as const) {
    const p = pseudonymiseFacts(kind, card);
    if (!p.sendable) throw new Error("the fixture cards must be sendable");
    const text = JSON.stringify(buildFindingsPrompt(kind, p.lines.map((l) => l.text)));
    for (const secret of fixtureSecrets()) expect(text, secret).not.toContain(secret);
    expect(text).not.toMatch(UUID_TEXT);
  }
}
