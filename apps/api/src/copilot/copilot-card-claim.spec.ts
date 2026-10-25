import { expect } from "vitest";

import { claimsACard, withNoChangeNote } from "./copilot-card-claim";
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

/** Each pattern fires on its own sample. */
export function eachPatternFiresOnItsOwnSample(): void {
  const samples = ["the card is ready", "your proposal is waiting", "press Confirm to apply", "it is on your screen"];
  expect(samples.map(claimsACard)).toEqual([true, true, true, true]);
}

/** Bare-word matching (the recommended drafter choice; owner ruling pending): a widget noun and a clarifying "confirm" are tagged. */
export function bareWordsAreTagged(): void {
  expect(["It has a KPI tile and two module summary cards.", "Which alarm do you mean? Please confirm the alarm id."].map(claimsACard)).toEqual([
    true,
    true,
  ]);
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
