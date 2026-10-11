import { expect } from "vitest";

import { looksLikeCredential } from "../llm/credential-detect";
import {
  argumentsCarryCredential,
  COPILOT_HISTORY_MESSAGE_MAX_CHARS,
  COPILOT_REDACTED,
  COPILOT_REPLY_REDACTED,
  scrubCopilotMessages,
  scrubToolResult,
} from "./copilot-secret-scrub";

/** `F3.85` PR 7 / ADR 0099 decision 9. Vitest entry point: the sibling `.test.ts` (ADR 0014). */

const SECRET = "password: hunter2";

/** Neither marker matches the detector, or a scrubbed history would be scrubbed again forever. */
export function assertTheMarkersDoNotMatchThemselves(): void {
  expect(looksLikeCredential(COPILOT_REDACTED)).toBe(false);
  expect(looksLikeCredential(COPILOT_REPLY_REDACTED)).toBe(false);
  // Positive control: the detector does fire on the fixture secret.
  expect(looksLikeCredential(SECRET)).toBe(true);
}

/** History: a credential is withheld whole, before the cut; plain text is only cut. */
export function assertHistoryIsScrubbedThenCut(): void {
  const long = `${"a".repeat(COPILOT_HISTORY_MESSAGE_MAX_CHARS - 5)} ${SECRET}`;
  const out = scrubCopilotMessages([
    { role: "user", content: long },
    { role: "assistant", content: "b".repeat(3_000) },
    { role: "user", content: "plain" },
  ]);
  expect(out[0]?.content).toBe(COPILOT_REDACTED);
  expect(out[1]?.content.length).toBe(COPILOT_HISTORY_MESSAGE_MAX_CHARS);
  expect(out[2]).toEqual({ role: "user", content: "plain" });
}

/** A tool result: every string that looks like a credential is replaced at any depth; the rest is kept. */
export function assertAToolResultIsScrubbedAtAnyDepth(): void {
  const out = scrubToolResult({
    items: [{ code: "AL-1", message: `note ${SECRET}`, nested: { deep: [SECRET] }, meta: { wifiPassword: "Summer2026" } }],
    count: 1,
  });
  expect(out).toEqual({
    items: [
      { code: "AL-1", message: COPILOT_REDACTED, nested: { deep: [COPILOT_REDACTED] }, meta: { wifiPassword: COPILOT_REDACTED } },
    ],
    count: 1,
  });
}

/** Arguments: a secret-named key or a secret-looking string at any depth carries a credential; plain ones do not. */
export function assertArgumentsAreWalkedForCredentials(): void {
  expect(argumentsCarryCredential({ filter: { note: SECRET } })).toBe(true);
  expect(argumentsCarryCredential({ a: { b: { password: "x" } } })).toBe(true);
  expect(argumentsCarryCredential([SECRET])).toBe(true);
  expect(argumentsCarryCredential({ organizationId: "00000000-0000-4000-8000-000000000001", state: "active" })).toBe(false);
}
