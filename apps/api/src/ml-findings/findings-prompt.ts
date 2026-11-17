import type { MlFindingsKind } from "@bms/shared";

/**
 * One message of the prompt. Structurally an `LlmMessage` (`../llm/llm-port`),
 * declared here so only the service imports the LLM core (plan T3.5).
 */
export type FindingsPromptMessage = { readonly role: "system" | "user"; readonly content: string };

/**
 * `E1.9c` / ADR 0135 Amendment 8 decisions 5 and 6 (plan §4.4, R-s, T3.2) — the
 * prompt that asks for the findings paragraph. Pure: no database, no clock.
 *
 * The version is part of the cache key's text (`findings-pseudonymise.ts`), so a
 * change to this prompt never serves a paragraph written under the old one.
 * **Bump it whenever `FINDINGS_SYSTEM_PROMPT` or the user message's shape
 * changes.**
 *
 * One fixed system message (decision 5's rules in plain words) and one user
 * message: the kind and the pseudonymised lines. No organization name, no id,
 * no user. The model is told the rules; `checkFindingsParagraph` is what holds them.
 *
 * Version 2 (`E1.9g`, ADR 0135 Amendment 10 decision 3) adds one line after the
 * one-paragraph rule: a short count sentence, then two to four short sentences,
 * one point each, so the web can show a headline and points. The stored text is
 * still one paragraph; the ten version-1 lines are unchanged, and
 * `findings-prompt.spec.ts` pins them and the SHA-256 of the whole text.
 */
export const FINDINGS_PROMPT_VERSION = 2;

export const FINDINGS_SYSTEM_PROMPT = [
  "You write one short advisory paragraph that summarises machine-learning findings for building and plant operators.",
  "The user message gives the kind of findings and a list of fact lines. Use only these facts. Do not add advice, causes or actions that the facts do not state.",
  "Rules:",
  "- Write numbers as digits, copied exactly as they appear in the facts. Never spell a number as a word, and never compute a new number, a percentage or a ratio.",
  "- Names are placeholders such as [A1], [R1] and [T1]. Copy each placeholder exactly as written, brackets included. Never invent a placeholder and never put any other text in square brackets.",
  "- Write one paragraph of plain text: no line breaks, no lists, no headings, no markdown, no links. At most 600 characters.",
  "- Start with one short sentence that states the overall count. Then write two to four short sentences, one point each, strongest signal first.",
  "- If a fact line starts with \"Strongest signal:\", mention that asset first, before any other asset.",
  "- If the facts say the marks come from the Baseline method only, call them a weak signal and use the word \"weak\".",
  "- Keep a calm, factual tone. Do not use alarming words such as emergency, danger, urgent, critical, failure or fault.",
  "Reply with the paragraph only.",
].join("\n");

/** The two messages of one call: the fixed rules, then the kind and the lines, one per line. */
export function buildFindingsPrompt(kind: MlFindingsKind, lines: readonly string[]): FindingsPromptMessage[] {
  return [
    { role: "system", content: FINDINGS_SYSTEM_PROMPT },
    { role: "user", content: `Kind: ${kind}\nFacts:\n${lines.join("\n")}` },
  ];
}
