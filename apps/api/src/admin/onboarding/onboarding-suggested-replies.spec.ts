import { agentReplies, filterSuggestedReplies, VIEW_DRAFT_REPLY } from "./onboarding-suggested-replies";

/**
 * F3.25 (ADR 0094 decision 9) — the reply list the agent path answers. The
 * model offers at most 4 chips through `suggest_replies`; code drops what a
 * chip must never send and adds the step label and `View draft`.
 */
function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function same(actual: readonly string[], expected: readonly string[], label: string): void {
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

/** The commit phrase acts: a chip is sent as a turn, so it never offers it, in any case or spacing. */
export function assertTheCommitPhraseIsDropped(): void {
  same(filterSuggestedReplies(["Confirm Commit ", "Yes"]), ["Yes"], "confirm commit");
}

/** The undo phrase acts too; `Undo.` normalises to it. */
export function assertTheUndoPhraseIsDropped(): void {
  same(filterSuggestedReplies(["undo", "Undo.", "Yes"]), ["Yes"], "undo");
}

/** Adjacent positive: a step label does not act on its own, so it stays. */
export function assertAStepLabelIsKept(): void {
  same(filterSuggestedReplies(["confirm rtu"]), ["confirm rtu"], "confirm rtu");
}

export function assertACredentialIsDropped(): void {
  same(filterSuggestedReplies(["password=hunter2", "MQTT"]), ["MQTT"], "credential");
}

/** Drop, never cut: a cut chip would send a cut message. A reply at the bound stays. */
export function assertAnOverLongReplyIsDroppedNotCut(): void {
  const atBound = "a".repeat(40);
  same(filterSuggestedReplies(["b".repeat(41), atBound]), [atBound], "41 characters");
}

export function assertDuplicatesKeepTheFirst(): void {
  same(filterSuggestedReplies(["MQTT", "mqtt", " ", "Modbus"]), ["MQTT", "Modbus"], "dedupe");
}

export function assertAgentRepliesAddTheStepLabelAndViewDraft(): void {
  same(agentReplies(["a", "b", "c", "d"], "rtu"), ["a", "b", "c", "d", "confirm rtu", VIEW_DRAFT_REPLY], "rtu");
}

/** The model's list is cut to 4 before the two code chips, so the cap of 6 holds by construction. */
export function assertAgentRepliesHoldAtSix(): void {
  same(agentReplies(["a", "b", "c", "d", "e"], "assets"), ["a", "b", "c", "d", "confirm assets", VIEW_DRAFT_REPLY], "five offered");
}

export function assertLocationAndReviewHaveNoStepLabel(): void {
  same(agentReplies([], "location"), [VIEW_DRAFT_REPLY], "location");
  same(agentReplies([], "review"), [VIEW_DRAFT_REPLY], "review");
}
