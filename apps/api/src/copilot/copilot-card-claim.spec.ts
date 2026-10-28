import { expect } from "vitest";

import {
  appliedSinceLastUserMessage,
  claimsACard,
  claimsApplied,
  COPILOT_CARD_CLAIM_PATTERNS,
  COPILOT_NO_CHANGE_APPLIED_NOTE,
  withNoAppliedNote,
  withNoChangeNote,
} from "./copilot-card-claim";
import { COPILOT_REPLY_REDACTED } from "./copilot-secret-scrub";
import { COPILOT_ATTACHMENT_UNREADABLE_REPLY, COPILOT_TURN_FAILED_REPLY } from "./copilot-turn.service";

/**
 * `F4.286` — the card-claim phrase list and the append. Vitest entry point: the
 * sibling `.test.ts`.
 */

/** The F4.283 live reply, verbatim. */
export const LIVE_CLAIM = "The card is showing on your screen — the server will check the asset id when you Confirm";

/** The F4.283 live reply claims a card. */
export function theLiveReplyClaimsACard(): void {
  expect(claimsACard(LIVE_CLAIM)).toBe(true);
}

/** A plain answer claims nothing. */
export function aPlainAnswerClaimsNothing(): void {
  expect(claimsACard("Two assets.")).toBe(false);
}

/** A correct refusal that uses the verb "propose" is not tagged. */
export function aRefusalNamingProposeClaimsNothing(): void {
  expect(claimsACard("No propose tool fits that; the Assets page does it.")).toBe(false);
}

/** Each pattern fires on its own sample, and only that pattern. */
export function eachPatternFiresOnItsOwnSample(): void {
  const samples = ["Your proposal is waiting.", "Confirm the card.", "Press Confirm.", "It is on your screen."];
  expect(samples.map((sample) => COPILOT_CARD_CLAIM_PATTERNS.map((pattern) => pattern.test(sample)))).toEqual([
    [true, false, false, false],
    [false, true, false, false],
    [false, false, true, false],
    [false, false, false, true],
  ]);
}

/** Bare words are not claims (owner ruling 2026-10-26): a widget noun, a clarifying "confirm", a past Confirm. */
export function bareWordsAreNotTagged(): void {
  const replies = [
    "It has a KPI tile and two module summary cards.",
    "Which alarm do you mean? Please confirm the alarm id.",
    "The card you confirmed acknowledged A-12.",
    "Two proposals were applied yesterday.",
  ];
  expect(replies.map(claimsACard)).toEqual([false, false, false, false]);
}

/** A claim does not reach across a sentence end: a noun in one sentence and a state word in the next are not a claim. */
export function aClaimStopsAtASentenceEnd(): void {
  expect(claimsACard("It has two cards. The pump is ready.")).toBe(false);
}

/** A claim with no pending change gets the note appended after one space; the reply is kept. */
export function aClaimWithNoChangeGetsTheNote(): void {
  expect(withNoChangeNote("Confirm the card.", 0)).toBe("Confirm the card. No change was proposed in this turn.");
}

/** A claim with a pending change is untouched. */
export function aClaimWithAChangeIsUntouched(): void {
  expect(withNoChangeNote("Confirm the card.", 1)).toBe("Confirm the card.");
}

/** A reply with no claim is untouched. */
export function aReplyWithNoClaimIsUntouched(): void {
  expect(withNoChangeNote("Two assets.", 0)).toBe("Two assets.");
}

/** The fixed replies never pick up the note. */
export function theFixedRepliesClaimNothing(): void {
  expect([COPILOT_REPLY_REDACTED, COPILOT_TURN_FAILED_REPLY, COPILOT_ATTACHMENT_UNREADABLE_REPLY].map(claimsACard)).toEqual([false, false, false]);
}

/** `F4.293`: the two AWS wordings F4.286's list missed, each tagged by the pattern that owns it. */
export function theAwsCardWordingsAreTagged(): void {
  const samples = ["Here's the card: Pump C 000000010 — Chlorine pump off.", "Confirm on the card to apply it."];
  expect(samples.map((sample) => COPILOT_CARD_CLAIM_PATTERNS.map((pattern) => pattern.test(sample)))).toEqual([
    [true, false, false, false],
    [false, true, false, false],
  ]);
}

/** `F4.293`: the three AWS "applied" replies, verbatim, are applied claims. */
export function theAwsAppliedRepliesAreTagged(): void {
  const replies = [
    "Noted — the clearwell rule for PHE-PUMP-C-000000010 is applied.",
    "Applied — the PUMP-M-000000011-BREAKER-OPEN rule is live for PHE-PUMP-M-000000011 (Bhutnirghat II).",
    "Applied — PUMP-C-000000011-CHLORINE-OFF is live for PHE-PUMP-C-000000011 (Bhutnirghat II).",
  ];
  expect(replies.map(claimsApplied)).toEqual([true, true, true]);
}

/** `F4.293`: a future, a past report and a question are not applied claims. */
export function aFutureOrPastApplyIsNotTagged(): void {
  const replies = [
    "Once you press Confirm, the rule will be applied.",
    "Two proposals were applied yesterday.",
    "Is the rule live? I can check its state.",
    "Two assets.",
  ];
  expect(replies.map(claimsApplied)).toEqual([false, false, false, false]);
}

/** `F4.293`: the applied note is appended only when no action record follows the last user message. */
export function theAppliedNoteNeedsNoRecord(): void {
  const claim = "Applied — the rule is live.";
  expect([withNoAppliedNote(claim, false), withNoAppliedNote(claim, true), withNoAppliedNote("Two assets.", false)]).toEqual([
    `${claim} ${COPILOT_NO_CHANGE_APPLIED_NOTE}`,
    claim,
    "Two assets.",
  ]);
}

/** `F4.293`: an action record after the last user message counts; one before it, or none, does not. */
export function anActionRecordCountsOnlyAfterTheLastUserMessage(): void {
  expect([
    appliedSinceLastUserMessage(["user", "assistant", "action", "assistant"]),
    appliedSinceLastUserMessage(["action", "assistant", "user", "assistant"]),
    appliedSinceLastUserMessage([]),
  ]).toEqual([true, false, false]);
}
