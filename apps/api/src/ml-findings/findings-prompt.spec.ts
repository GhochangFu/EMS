import { createHash } from "node:crypto";

import { expect } from "vitest";

import { UUID_TEXT, fixtureSecrets, fxaForecastCard, fxbAnomalyCard } from "./findings-paragraph.fixture";
import { FINDINGS_PROMPT_VERSION, FINDINGS_SYSTEM_PROMPT, buildFindingsPrompt } from "./findings-prompt";
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
    // E1.9g, prompt version 2 (ADR 0135 Amendment 10 decision 3).
    "states the overall count",
    "two to four short sentences, one point each, strongest signal first",
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

/**
 * `E1.9g` / ADR 0135 Amendment 10 decision 3 (plan §4.2, T1.3) — version 2 adds one line
 * after the one-paragraph rule; the ten lines of version 1 stay byte for byte.
 */
const VERSION_1_LINES: readonly string[] = [
  "You write one short advisory paragraph that summarises machine-learning findings for building and plant operators.",
  "The user message gives the kind of findings and a list of fact lines. Use only these facts. Do not add advice, causes or actions that the facts do not state.",
  "Rules:",
  "- Write numbers as digits, copied exactly as they appear in the facts. Never spell a number as a word, and never compute a new number, a percentage or a ratio.",
  "- Names are placeholders such as [A1], [R1] and [T1]. Copy each placeholder exactly as written, brackets included. Never invent a placeholder and never put any other text in square brackets.",
  "- Write one paragraph of plain text: no line breaks, no lists, no headings, no markdown, no links. At most 600 characters.",
  "- If a fact line starts with \"Strongest signal:\", mention that asset first, before any other asset.",
  "- If the facts say the marks come from the Baseline method only, call them a weak signal and use the word \"weak\".",
  "- Keep a calm, factual tone. Do not use alarming words such as emergency, danger, urgent, critical, failure or fault.",
  "Reply with the paragraph only.",
];

const VERSION_2_LINE =
  "- Start with one short sentence that states the overall count. Then write two to four short sentences, one point each, strongest signal first.";

export function theOldRulesAreKeptWordForWord(): void {
  const lines = FINDINGS_SYSTEM_PROMPT.split("\n");
  const added = lines.indexOf(VERSION_2_LINE);
  expect(added, "the version-2 line is in the prompt").toBeGreaterThan(-1);
  expect(lines.filter((_, i) => i !== added)).toEqual(VERSION_1_LINES);
  const paragraphRule = lines.findIndex((l) => l.startsWith("- Write one paragraph of plain text:"));
  expect(added, "the new line follows the one-paragraph rule").toBe(paragraphRule + 1);
}

/**
 * The version is part of the cache key's text, so a prompt edit without a version bump would
 * serve paragraphs written under the old words. This hash pins the text to the version.
 */
const VERSION_2_SHA256 = "82163c87043148d359640d6906b2f954c5c1df4643321069c4821124de3dfc70";

export function theVersionMovesWithTheText(): void {
  expect(FINDINGS_PROMPT_VERSION).toBe(2);
  const hash = createHash("sha256").update(FINDINGS_SYSTEM_PROMPT, "utf8").digest("hex");
  expect(
    hash,
    "FINDINGS_SYSTEM_PROMPT changed: bump FINDINGS_PROMPT_VERSION and this hash together, in the same commit",
  ).toBe(VERSION_2_SHA256);
}
