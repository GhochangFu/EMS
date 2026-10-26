import { Logger } from "@nestjs/common";
import { expect } from "vitest";

import { copilotTurnResponseDtoSchema } from "@bms/shared";

import { calls, FakeLlmProvider, toolCall } from "../admin/onboarding/onboarding-agent-loop.spec";
import { COPILOT_CARD_CLAIM_PROMPT_RULE } from "./copilot-card-claim";
import { COPILOT_REPLY_REDACTED } from "./copilot-secret-scrub";
import { COPILOT_SYSTEM_PROMPT } from "./copilot-turn.service";
import { APPLIED, CHANGE_ID, GLOBAL_ADMIN, harness, JWT, turn } from "./copilot-turn.service.spec";

/**
 * `F4.286` (ADR 0099 decisions 4 and 9; owner ruling 2026-10-25) — a final
 * reply that claims a card while the turn stored no pending change gets the
 * fixed note appended, stored and returned; a turn that proposed is untouched.
 * Vitest entry point: the sibling `.test.ts`.
 */

/** The F4.283 live reply, verbatim. */
const CLAIM = "The card is showing on your screen — the server will check the asset id when you Confirm";
const NOTED = `${CLAIM} No change was proposed in this turn.`;
const TEMPLATE_T = "55555555-5555-4555-8555-555555555555";

function lastAssistant(h: ReturnType<typeof harness>): string | undefined {
  return [...h.history].reverse().find((m) => m.role === "assistant")?.content;
}

/** A claim with zero pending changes: the note is appended, returned and stored; the contract still parses. */
export async function aClaimWithNoChangeIsNotedStoredAndReturned(): Promise<void> {
  const h = harness(new FakeLlmProvider([{ kind: "final", text: CLAIM }]));
  const response = await turn(h, "record a manual reading for asset 00000000-0000-4000-8000-000000000bad");
  expect(copilotTurnResponseDtoSchema.parse(response)).toEqual(response);
  expect([response.reply, response.pendingChanges, lastAssistant(h)]).toEqual([NOTED, [], NOTED]);
}

/** The same reply with one pending change is untouched. */
export async function aClaimWithAChangeIsUntouched(): Promise<void> {
  const h = harness(new FakeLlmProvider([calls(toolCall("propose_dashboardTemplate_publish", { id: TEMPLATE_T })), { kind: "final", text: CLAIM }]));
  const response = await turn(h, "publish template T");
  expect([response.reply, response.pendingChanges.length]).toEqual([CLAIM, 1]);
}

/** A reply with no claim and zero pending changes is untouched, returned and stored. */
export async function aReplyWithNoClaimIsUntouched(): Promise<void> {
  const h = harness(new FakeLlmProvider([{ kind: "final", text: "Two assets." }]));
  const response = await turn(h, "assets?");
  expect([response.reply, lastAssistant(h)]).toEqual(["Two assets.", "Two assets."]);
}

/** The "copilot turn" log lines' noteAppended flags for the turns `run` makes. */
async function noteFlags(run: () => Promise<void>): Promise<unknown[]> {
  const logged: unknown[][] = [];
  const original = Logger.prototype.log;
  Logger.prototype.log = function (...args: unknown[]) {
    logged.push(args);
  } as typeof Logger.prototype.log;
  try {
    await run();
  } finally {
    Logger.prototype.log = original;
  }
  return logged.filter((args) => args[1] === "copilot turn").map((args) => (args[0] as { noteAppended?: unknown }).noteAppended);
}

const REDACTABLE_CLAIM = "Sure, the card: password: hunter2";

/** A reply that claims a card and carries a credential is returned as the redacted reply, unchanged. */
export async function theRedactedReplyIsReturnedUnchanged(): Promise<void> {
  const h = harness(new FakeLlmProvider([{ kind: "final", text: REDACTABLE_CLAIM }]));
  const response = await turn(h, "what is the password?");
  expect(response.reply).toBe(COPILOT_REPLY_REDACTED);
}

/** The scrub runs before the append: the redacted reply's log line says no note was appended. */
export async function theScrubRunsBeforeTheAppend(): Promise<void> {
  const flags = await noteFlags(async () => {
    await turn(harness(new FakeLlmProvider([{ kind: "final", text: REDACTABLE_CLAIM }])), "what is the password?");
  });
  expect(flags).toEqual([false]);
}

/** A follow-up turn takes the same check. */
export async function aFollowUpClaimIsNoted(): Promise<void> {
  const h = harness(new FakeLlmProvider([{ kind: "final", text: CLAIM }]), { finished: APPLIED });
  await h.service.followUp({ identity: GLOBAL_ADMIN, user: JWT }, CHANGE_ID);
  expect(lastAssistant(h)).toBe(NOTED);
}

/** The system prompt carries the card-claim rule as its own line. */
export function thePromptCarriesTheRule(): void {
  expect(COPILOT_SYSTEM_PROMPT.split("\n")).toContain(COPILOT_CARD_CLAIM_PROMPT_RULE);
}

/** The "copilot turn" log line says whether the note was appended: true for a noted claim, false for a plain answer. */
export async function theTurnLogSaysWhetherTheNoteWasAppended(): Promise<void> {
  const flags = await noteFlags(async () => {
    await turn(harness(new FakeLlmProvider([{ kind: "final", text: CLAIM }])), "record a reading");
    await turn(harness(new FakeLlmProvider([{ kind: "final", text: "Two assets." }])), "assets?");
  });
  expect(flags).toEqual([true, false]);
}
