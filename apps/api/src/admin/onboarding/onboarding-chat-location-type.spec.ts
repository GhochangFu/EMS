/**
 * `F4.157` / ADR 0077 decision 7 — the onboarding chat asks for the location
 * type instead of defaulting it, and refuses a type the vocabulary does not
 * hold.
 *
 * Before this row the rule-based branch tested the message for `rsmoc` and
 * `csmoc` and wrote `smoc_campus` for everything else, so every site onboarded
 * by chat became a campus. Now a name with no type word is answered with a
 * question whose suggested replies are the active labels, and the next turn
 * that names one sets it.
 *
 * A sibling of `onboarding-chat.service.spec.ts`, split from it only because
 * the combined file would pass AGENTS.md §4.5's 1,000-line ceiling.
 */
import type { LocationTypeDto, OnboardingDraft, OnboardingPhase } from "@bms/shared";

import { OnboardingChatService } from "./onboarding-chat.service";
import * as locationTypes from "./onboarding-location-type-match";
import type { ChatTurnResult } from "./onboarding-chat.service";
import { OnboardingValidateService } from "./onboarding-validate.service";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** The four seeded rows of `bms.location_types`, in `sort_order`. */
const FOUR: readonly LocationTypeDto[] = [
  { code: "smoc_campus", label: "SMOC campus" },
  { code: "rsmoc", label: "RSMOC" },
  { code: "csmoc", label: "CSMOC" },
  { code: "pump_station", label: "Pump station" },
];

/** The four codes, as the validator takes them (`F4.162`, plan D9). */
const CODES: readonly string[] = FOUR.map((row) => row.code);

/**
 * The four plus one row whose label is **not** its code with spaces.
 *
 * Every seeded label is its code with `_` read as a space, so a matcher that
 * read codes only would still match every seeded label. This row is what tells
 * a label match from a code match.
 */
const WITH_DISTINCT_LABEL: readonly LocationTypeDto[] = [
  ...FOUR,
  { code: "wtp", label: "Water treatment plant" },
];

/** A chat service whose vocabulary is `rows`, with the real validator behind it. */
function serviceWith(rows: readonly LocationTypeDto[]): OnboardingChatService {
  return new OnboardingChatService(
    new OnboardingValidateService(),
    {} as never,
    {} as never,
    {} as never,
    { listLocationTypes: async () => [...rows] } as never,
  );
}

/** One rule-based turn: `OPENAI_API_KEY` removed for the call, as `.env.example` ships it. */
async function ruleBasedTurn(
  message: string,
  draft: OnboardingDraft,
  phase: OnboardingPhase,
  rows: readonly LocationTypeDto[] = FOUR,
): Promise<ChatTurnResult> {
  const savedKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    return await serviceWith(rows).handleTurn(message, draft, phase, "Ion Exchange");
  } finally {
    if (savedKey !== undefined) {
      process.env.OPENAI_API_KEY = savedKey;
    }
  }
}

/** The first turn of H1: a name with no type word. */
async function nameOnlyTurn(): Promise<ChatTurnResult> {
  return ruleBasedTurn("Lotapata", {}, "location");
}

/**
 * The draft the chat holds after {@link nameOnlyTurn}: its patch stored through
 * the real `mergeDraft`, as `OnboardingService.chat` stores it, and the phase
 * the turn reported.
 */
async function draftAwaitingType(): Promise<{ draft: OnboardingDraft; phase: OnboardingPhase }> {
  const first = await nameOnlyTurn();
  return {
    draft: serviceWith(FOUR).mergeDraft({}, first.draftPatch) as OnboardingDraft,
    phase: first.currentPhase,
  };
}

/** H1 — a name with no type word stays in the location phase and asks the question. */
export async function assertNameWithoutTypeAsksForTheType(): Promise<void> {
  const turn = await nameOnlyTurn();
  assert(turn.currentPhase === "location", `the phase stays location, got ${turn.currentPhase}`);
  assert(
    turn.assistantMessage === "Which type of location is **Lotapata**?",
    `the reply asks for the type, got "${turn.assistantMessage}"`,
  );
}

/** H1 — the suggested replies are the active labels, in the vocabulary's order. */
export async function assertTypeQuestionSuggestsTheActiveLabels(): Promise<void> {
  const turn = await nameOnlyTurn();
  const expected = FOUR.map((row) => row.label);
  assert(
    JSON.stringify(turn.suggestedReplies) === JSON.stringify(expected),
    `the suggested replies are the four labels, got ${JSON.stringify(turn.suggestedReplies)}`,
  );
}

/**
 * H1 — the patch stores the name and no type. The name is the positive
 * control: the absence check reads a location this branch really wrote.
 */
export async function assertTypeQuestionPatchesNoType(): Promise<void> {
  const turn = await nameOnlyTurn();
  const location = turn.draftPatch.location;
  assert(location?.name === "Lotapata", `the patch stores the name, got ${JSON.stringify(location)}`);
  assert(
    location !== undefined && !("type" in location),
    `the patch must carry no type, got ${JSON.stringify(location?.type)}`,
  );
}

/** H2 — a reply naming a type by its words sets it and keeps the stored name. */
export async function assertTypeReplySetsTheType(): Promise<void> {
  const { draft, phase } = await draftAwaitingType();
  const turn = await ruleBasedTurn("pump station", draft, phase);
  const location = turn.draftPatch.location;
  assert(location?.type === "pump_station", `the reply sets the type, got ${JSON.stringify(location?.type)}`);
  assert(location?.name === "Lotapata", `the stored name is kept, got ${JSON.stringify(location?.name)}`);
}

/** H2 — once the type is set, the chat moves on to the RTU question, exactly as before. */
export async function assertTypeReplyAsksTheRtuQuestion(): Promise<void> {
  const { draft, phase } = await draftAwaitingType();
  const turn = await ruleBasedTurn("pump station", draft, phase);
  assert(
    turn.assistantMessage === "Got it — location **Lotapata**. Which communication protocol will RTU 1 use?",
    `the chat asks the RTU question, got "${turn.assistantMessage}"`,
  );
  assert(turn.currentPhase === "rtu", `the phase moves to rtu, got ${turn.currentPhase}`);
}

/** H2 — a reply that names a label which is not its code with spaces is matched on the label. */
export async function assertTypeReplyMatchesALabel(): Promise<void> {
  const { draft, phase } = await draftAwaitingType();
  const turn = await ruleBasedTurn("Water Treatment Plant", draft, phase, WITH_DISTINCT_LABEL);
  assert(
    turn.draftPatch.location?.type === "wtp",
    `the label sets its code, got ${JSON.stringify(turn.draftPatch.location?.type)}`,
  );
}

/**
 * A reply that names no type while one is awaited asks again, and does not
 * rename the location to the reply's text.
 */
export async function assertUnmatchedReplyAsksAgain(): Promise<void> {
  const { draft, phase } = await draftAwaitingType();
  const turn = await ruleBasedTurn("not sure", draft, phase);
  assert(
    turn.assistantMessage === "Which type of location is **Lotapata**?",
    `the chat asks again about the stored name, got "${turn.assistantMessage}"`,
  );
  assert(
    turn.draftPatch.location?.name === "Lotapata" && turn.draftPatch.location.slug === "lotapata",
    `an unmatched reply must not rename the location, got ${JSON.stringify(turn.draftPatch.location)}`,
  );
}

/** H3 — a name and a type word in one message set both in that turn. */
export async function assertNameWithTypeSetsTheTypeInOneTurn(): Promise<void> {
  const turn = await ruleBasedTurn("Lotapata pump station", {}, "location");
  assert(
    turn.draftPatch.location?.type === "pump_station",
    `the type is set in the same turn, got ${JSON.stringify(turn.draftPatch.location?.type)}`,
  );
  assert(turn.currentPhase === "rtu", `the chat moves on to the RTU, got ${turn.currentPhase}`);
}

/** H3 — the same, where only the label names the type. */
export async function assertNameWithLabelSetsTheTypeInOneTurn(): Promise<void> {
  const turn = await ruleBasedTurn("Lotapata water treatment plant", {}, "location", WITH_DISTINCT_LABEL);
  assert(
    turn.draftPatch.location?.type === "wtp",
    `the label sets the type in the same turn, got ${JSON.stringify(turn.draftPatch.location?.type)}`,
  );
}

/**
 * Whole words only: `rsmoc` does not name a type whose code is `smoc`. The name
 * in the patch is the positive control — the branch ran and wrote a location,
 * it just set no type on it.
 */
export async function assertTypeWordMatchesWholeWords(): Promise<void> {
  const turn = await ruleBasedTurn("Lotapata rsmoc", {}, "location", [{ code: "smoc", label: "SMOC" }]);
  const location = turn.draftPatch.location;
  assert(location?.name === "Lotapata rsmoc", `the branch wrote the location, got ${JSON.stringify(location)}`);
  assert(
    location !== undefined && !("type" in location),
    `rsmoc must not match smoc, got ${JSON.stringify(location?.type)}`,
  );
}

/**
 * The type reply keeps the stored slug and code, not ones derived again from
 * the name. A location the wizard edited by hand carries a slug and a code the
 * chat would never derive, and answering "Which type…?" must not replace them.
 */
export async function assertTypeReplyKeepsTheStoredIdentifiers(): Promise<void> {
  const draft = {
    location: { name: "Lotapata", slug: "lotapata-pump-house", code: "LTP-01", latitude: 22.3, longitude: 87.3 },
  } as OnboardingDraft;
  const turn = await ruleBasedTurn("pump station", draft, "location");
  const location = turn.draftPatch.location;
  assert(location?.type === "pump_station", `the reply sets the type, got ${JSON.stringify(location?.type)}`);
  assert(
    location?.slug === "lotapata-pump-house" && location.code === "LTP-01",
    `the stored slug and code are kept, got ${JSON.stringify({ slug: location?.slug, code: location?.code })}`,
  );
}

// ---------------------------------------------------------------------------
// H4 — the OpenAI branch. The `openai` module is mocked in the `.test.ts`
// wrapper, as `onboarding-prompt-budget.test.ts` does; `captured` carries the
// request the mock was handed and the reply it returns.
// ---------------------------------------------------------------------------

export type OpenAiCapture = { requests: unknown[]; reply: string };

/** A model reply whose patch carries a whole, schema-valid location of type `type`. */
function replyWithLocationType(type: string): string {
  return JSON.stringify({
    assistantMessage: "I've updated the location.",
    draftPatch: {
      location: {
        name: "Lotapata",
        slug: "lotapata",
        code: "LOTAPATA",
        type,
        latitude: 22.3,
        longitude: 87.3,
      },
    },
    currentPhase: "location",
  });
}

/** One turn through the OpenAI branch with `reply` as the model's answer, against the stored `draft`. */
async function openAiTurn(
  captured: OpenAiCapture,
  reply: string,
  draft: OnboardingDraft = {},
): Promise<ChatTurnResult> {
  captured.requests.length = 0;
  const savedReply = captured.reply;
  const savedKey = process.env.OPENAI_API_KEY;
  captured.reply = reply;
  process.env.OPENAI_API_KEY = "not-a-real-key";
  try {
    const turn = await serviceWith(FOUR).handleTurn("Tell me about the site", draft, "location", "Ion Exchange");
    // The catch around the OpenAI branch turns a broken mock into a green
    // rule-based answer, so every case first proves the model was asked.
    assert(captured.requests.length === 1, "the OpenAI branch must have run");
    return turn;
  } finally {
    captured.reply = savedReply;
    if (savedKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = savedKey;
    }
  }
}

/** H4 — a `location.type` the vocabulary does not hold is dropped from the model's patch. */
export async function assertOpenAiPatchLosesAnInactiveType(captured: OpenAiCapture): Promise<void> {
  const turn = await openAiTurn(captured, replyWithLocationType("space_port"));
  const location = turn.draftPatch.location;
  assert(location?.name === "Lotapata", `the rest of the location is kept, got ${JSON.stringify(location)}`);
  assert(
    location !== undefined && !("type" in location),
    `an inactive type must be dropped, got ${JSON.stringify(location?.type)}`,
  );
}

/** H4, the positive control — an active code in the model's patch is kept. */
export async function assertOpenAiPatchKeepsAnActiveType(captured: OpenAiCapture): Promise<void> {
  const turn = await openAiTurn(captured, replyWithLocationType("pump_station"));
  assert(
    turn.draftPatch.location?.type === "pump_station",
    `an active type is kept, got ${JSON.stringify(turn.draftPatch.location?.type)}`,
  );
}

/** H4 — the system prompt names every active code, so the model has the list to choose from. */
export async function assertOpenAiPromptListsTheActiveCodes(captured: OpenAiCapture): Promise<void> {
  await openAiTurn(captured, replyWithLocationType("pump_station"));
  const request = captured.requests[0] as { messages?: { content?: string }[] } | undefined;
  const system = request?.messages?.[0]?.content ?? "";
  for (const row of FOUR) {
    assert(system.includes(row.code), `the system prompt names ${row.code}`);
  }
}

/** `F3.33` (ADR 0083, OQ6) — the system prompt names `IONSiTE NEXUS`, not `TRINETRA`. */
export async function assertOpenAiSystemPromptNamesIonsiteNexus(captured: OpenAiCapture): Promise<void> {
  await openAiTurn(captured, replyWithLocationType("pump_station"));
  const request = captured.requests[0] as { messages?: { content?: string }[] } | undefined;
  const system = request?.messages?.[0]?.content ?? "";
  assert(
    system.startsWith("You are an IONSiTE NEXUS BMS onboarding assistant for organization "),
    `got ${JSON.stringify(system.slice(0, 90))}`,
  );
  assert(!/trinetra/i.test(system), "the system prompt still names the old product");
}

// ---------------------------------------------------------------------------
// F4.157 review — a stored type. Each case starts from a stored draft, takes
// the first phase from `inferPhase` as `PATCH :id/draft` does, and stores each
// turn through the real `mergeDraft`, never through a hand-built draft.
//
// Owner ruling, 2026-09-27: the message is the location name, as before F4.157,
// in every location-phase turn except while the chat waits for a type (a stored
// non-empty name and no active stored type). A stored type counts only when it
// is an active code.
// ---------------------------------------------------------------------------

/** A workbook with a blank name cell and a blank code cell, and a type. */
const TYPED_BLANK = {
  location: { name: "", slug: "", code: "", type: "pump_station", latitude: 22.3, longitude: 87.3 },
} as OnboardingDraft;

/** A named, typed location whose code and slug a `PATCH :id/draft` cleared. */
const TYPED_NAMED_NO_CODE = {
  location: { name: "Lotapata", slug: "", code: "", type: "smoc_campus", latitude: 22.3, longitude: 87.3 },
} as OnboardingDraft;

/** A named location with no type and a blank code and slug: the chat waits for a type. */
const AWAITING_NO_CODE = {
  location: { name: "Lotapata", slug: "", code: "", latitude: 22.3, longitude: 87.3 },
} as OnboardingDraft;

/** A named location whose stored type is not an active code. */
const NAMED_INACTIVE_TYPE = {
  location: {
    name: "Lotapata",
    slug: "lotapata",
    code: "LOTAPATA",
    type: "space_port",
    latitude: 22.3,
    longitude: 87.3,
  },
} as OnboardingDraft;

/** One rule-based turn from `stored`, and the draft `mergeDraft` stores after it. */
async function storedTurn(
  message: string,
  stored: OnboardingDraft,
  phase: OnboardingPhase = new OnboardingValidateService().inferPhase(stored, CODES),
): Promise<{ turn: ChatTurnResult; draft: OnboardingDraft }> {
  const turn = await ruleBasedTurn(message, stored, phase);
  return { turn, draft: serviceWith(FOUR).mergeDraft(stored, turn.draftPatch) as OnboardingDraft };
}

/** R1 — a name typed for a location whose type is stored is not asked "Which type…?". */
export async function assertStoredTypeIsNotAskedFor(): Promise<void> {
  const { turn } = await storedTurn("Lotapata", TYPED_BLANK);
  assert(
    turn.assistantMessage === "Got it — location **Lotapata**. Which communication protocol will RTU 1 use?",
    `a stored type is not asked for again, got "${turn.assistantMessage}"`,
  );
}

/** R2 — the type-word turn that follows never renames the location to "Pump station". */
export async function assertStoredTypeKeepsTheNameThroughTwoTurns(): Promise<void> {
  const first = await storedTurn("Lotapata", TYPED_BLANK);
  const second = await storedTurn("Pump station", first.draft, first.turn.currentPhase);
  assert(
    second.draft.location?.name === "Lotapata",
    `the name typed in turn 1 survives turn 2, got ${JSON.stringify(second.draft.location?.name)}`,
  );
}

/** R3 — the turn does not report a missing type the stored draft holds. */
export async function assertStoredTypeReportsNoMissingType(): Promise<void> {
  const { turn } = await storedTurn("Lotapata", TYPED_BLANK);
  assert(Array.isArray(turn.validationErrors), "the turn reports its validation");
  const missing = (turn.validationErrors ?? []).filter((e) => e.message === "Location type is required");
  assert(missing.length === 0, `a stored type is not reported missing, got ${JSON.stringify(missing)}`);
}

/**
 * R4 — a named, typed location is not waiting for a type, so the message is its
 * new name, as before F4.157 (the owner's example, "Berhampur Pump Station").
 */
export async function assertNameMessageRenamesATypedLocation(): Promise<void> {
  const { draft } = await storedTurn("Berhampur Pump Station", TYPED_NAMED_NO_CODE);
  assert(
    draft.location?.name === "Berhampur Pump Station",
    `the message is the new name, got ${JSON.stringify(draft.location?.name)}`,
  );
}

/** R4 — the same message sets the type it names over the stored one. */
export async function assertNameMessageSetsTheTypeItNames(): Promise<void> {
  const { draft } = await storedTurn("Berhampur Pump Station", TYPED_NAMED_NO_CODE);
  assert(
    draft.location?.type === "pump_station",
    `the type the message names wins, got ${JSON.stringify(draft.location?.type)}`,
  );
}

/** R4 — the same message's code is derived from the new name. */
export async function assertNameMessageDerivesTheCode(): Promise<void> {
  const { draft } = await storedTurn("Berhampur Pump Station", TYPED_NAMED_NO_CODE);
  assert(
    draft.location?.code === "BERHAMPUR_PUMP_STATION",
    `the code is derived from the new name, got ${JSON.stringify(draft.location?.code)}`,
  );
}

/**
 * R4 — while the chat waits for a type, the reply keeps the stored name, read
 * back from the draft `mergeDraft` stores.
 */
export async function assertAwaitingTypeReplyKeepsTheStoredName(): Promise<void> {
  const { draft, phase } = await draftAwaitingType();
  const second = await storedTurn("Pump station", draft, phase);
  assert(
    second.draft.location?.name === "Lotapata",
    `a type answer never renames the location, got ${JSON.stringify(second.draft.location?.name)}`,
  );
}

/**
 * R4 — a kept location's empty code is derived from its name. A stored `""`
 * spread over the derived value would leave the phase on `location`, and the
 * next message ("MQTT") would be read as a new name.
 */
export async function assertTypeReplyFillsAnEmptyStoredCode(): Promise<void> {
  const { draft } = await storedTurn("Pump station", AWAITING_NO_CODE);
  assert(
    draft.location?.code === "LOTAPATA",
    `an empty stored code is derived, got ${JSON.stringify(draft.location?.code)}`,
  );
}

/** R4 — the same for an empty stored slug. */
export async function assertTypeReplyFillsAnEmptyStoredSlug(): Promise<void> {
  const { draft } = await storedTurn("Pump station", AWAITING_NO_CODE);
  assert(
    draft.location?.slug === "lotapata",
    `an empty stored slug is derived, got ${JSON.stringify(draft.location?.slug)}`,
  );
}

/**
 * R6 — a stored type that is not an active code does not pass silently: the
 * chat is waiting for a type, so it asks about the stored name.
 */
export async function assertStoredInactiveTypeIsAskedFor(): Promise<void> {
  const { turn } = await storedTurn("not sure", NAMED_INACTIVE_TYPE, "location");
  assert(
    turn.assistantMessage === "Which type of location is **Lotapata**?",
    `an inactive stored type is asked for again, got "${turn.assistantMessage}"`,
  );
}

/**
 * R6 — the same turn's patch carries no type: the inactive code is not copied
 * back into it. The stored name is the positive control.
 */
export async function assertStoredInactiveTypeIsNotPatched(): Promise<void> {
  const { turn } = await storedTurn("not sure", NAMED_INACTIVE_TYPE, "location");
  const location = turn.draftPatch.location;
  assert(location?.name === "Lotapata", `the patch keeps the stored name, got ${JSON.stringify(location)}`);
  assert(
    location !== undefined && !("type" in location),
    `the patch must carry no type, got ${JSON.stringify(location?.type)}`,
  );
}

/**
 * R5 — the OpenAI branch validates the draft `mergeDraft` will store. The
 * stored draft has an active type and `code: ""`; the model's patch supplies
 * the code and no type, so only the merged draft is complete and the phase
 * moves to `rtu`. Validating a shallow `{ ...draft, ...patch }` (the type is
 * lost) or the pre-turn draft (the code is empty) leaves it on `location`. The
 * reply's own `currentPhase` is `location`, so `rtu` can come only from
 * validation.
 */
export async function assertOpenAiTurnValidatesTheMergedDraft(captured: OpenAiCapture): Promise<void> {
  const stored = {
    location: {
      name: "Lotapata",
      slug: "lotapata",
      code: "",
      type: "pump_station",
      latitude: 22.3,
      longitude: 87.3,
    },
  } as OnboardingDraft;
  const reply = JSON.stringify({
    assistantMessage: "I've set the code.",
    draftPatch: {
      location: { name: "Lotapata", slug: "lotapata", code: "LOTAPATA", latitude: 22.3, longitude: 87.3 },
    },
    currentPhase: "location",
  });
  const turn = await openAiTurn(captured, reply, stored);
  assert(turn.draftPatch.location?.code === "LOTAPATA", "the model's patch passed the parse");
  assert(turn.currentPhase === "rtu", `the merged draft is complete, got ${turn.currentPhase}`);
}

// ---------------------------------------------------------------------------
// F4.162 (ADR 0077 Amendment 1, plan D9, owner ruling OQ3) — a type retired
// after it was stored. The stored phase is whatever `inferPhase` said at the
// last write, and before the type was retired that was `rtu` or later, so these
// cases pass `rtu` explicitly. The chat must treat the type as missing and ask
// for it again before the RTU step.
// ---------------------------------------------------------------------------

/** H5's turn: `NAMED_INACTIVE_TYPE` stored at phase `rtu`, and the operator types the name. */
async function retiredTypeTurn(): Promise<{ turn: ChatTurnResult; draft: OnboardingDraft }> {
  return storedTurn("Lotapata", NAMED_INACTIVE_TYPE, "rtu");
}

/** H5 — the chat asks for the type again instead of taking the RTU step. */
export async function assertRetiredTypeIsAskedForAtTheRtuPhase(): Promise<void> {
  const { turn } = await retiredTypeTurn();
  assert(
    turn.assistantMessage === locationTypes.locationTypeQuestion("Lotapata"),
    `a retired stored type is asked for again, got "${turn.assistantMessage}"`,
  );
}

/** H5 — the suggested replies are the four active labels. */
export async function assertRetiredTypeQuestionSuggestsTheActiveLabels(): Promise<void> {
  const { turn } = await retiredTypeTurn();
  assert(
    JSON.stringify(turn.suggestedReplies) === JSON.stringify(FOUR.map((row) => row.label)),
    `the suggested replies are the four labels, got ${JSON.stringify(turn.suggestedReplies)}`,
  );
}

/** H5 — the turn reports the location phase. `inferPhase` holds this claim (N4). */
export async function assertRetiredTypeTurnReportsTheLocationPhase(): Promise<void> {
  const { turn } = await retiredTypeTurn();
  assert(turn.currentPhase === "location", `the phase goes back to location, got ${turn.currentPhase}`);
}

/** H5 — no RTU is appended. The patch's location is the positive control. */
export async function assertRetiredTypeTurnAddsNoRtu(): Promise<void> {
  const { turn } = await retiredTypeTurn();
  assert(
    turn.draftPatch.location?.name === "Lotapata",
    `the turn wrote the location, got ${JSON.stringify(turn.draftPatch.location)}`,
  );
  assert(turn.draftPatch.rtus === undefined, `no RTU is added, got ${JSON.stringify(turn.draftPatch.rtus)}`);
}

/** H6's turn: the reply "Pump station" to H5's question, from the draft `mergeDraft` stored. */
async function retiredTypeAnswerTurn(): Promise<ChatTurnResult> {
  const first = await retiredTypeTurn();
  const { turn } = await storedTurn("Pump station", first.draft, first.turn.currentPhase);
  return turn;
}

/** H6 — the reply sets the active type. */
export async function assertRetiredTypeAnswerSetsTheType(): Promise<void> {
  const turn = await retiredTypeAnswerTurn();
  assert(
    turn.draftPatch.location?.type === "pump_station",
    `the reply sets the type, got ${JSON.stringify(turn.draftPatch.location?.type)}`,
  );
}

/** H6 — the reply is answered with the RTU question. */
export async function assertRetiredTypeAnswerAsksTheRtuQuestion(): Promise<void> {
  const turn = await retiredTypeAnswerTurn();
  assert(
    turn.assistantMessage === "Got it — location **Lotapata**. Which communication protocol will RTU 1 use?",
    `the chat asks the RTU question, got "${turn.assistantMessage}"`,
  );
}

/** H6 — the turn reports the `rtu` phase: `finalizeTurn` validated with the active codes. */
export async function assertRetiredTypeAnswerMovesToTheRtuPhase(): Promise<void> {
  const turn = await retiredTypeAnswerTurn();
  assert(turn.currentPhase === "rtu", `the phase moves to rtu, got ${turn.currentPhase}`);
}

/** H7 — H5's turn reports the error at `location.type`, so the wizard shows it. */
export async function assertRetiredTypeTurnReportsTheTypeError(): Promise<void> {
  const { turn } = await retiredTypeTurn();
  const paths = (turn.validationErrors ?? []).map((error) => error.path);
  assert(paths.includes("location.type"), `the turn reports location.type, got ${JSON.stringify(paths)}`);
}

/**
 * A draft complete in every section whose stored type is not active. H5's
 * draft has no RTU, so its `readyToCommit` is false for other reasons; this
 * one is false only because of the type.
 */
const COMPLETE_INACTIVE_TYPE = {
  location: { ...NAMED_INACTIVE_TYPE.location },
  rtus: [
    {
      code: "RTU-1",
      displayName: "RTU 1",
      protocol: "modbus_tcp",
      config: { host: "10.0.0.1", port: 502 },
      credentialsSet: false,
      ingestEnabled: false,
    },
  ],
  pointKeys: [{ code: "kw", name: "Active Power", domain: "electrical", unit: "kW" }],
  assets: [
    { code: "LOTAPATA-ASSET-1", name: "Asset 1", siteName: "Lotapata", rtuIndex: 0, domain: "electrical" },
  ],
  assetPoints: [{ assetIndex: 0, pointKey: "kw", sourceDataKey: "s01" }],
} as OnboardingDraft;

/**
 * H7 — a turn on a complete draft whose type is not active is not ready to
 * commit, so the wizard's Commit button agrees with the commit's 400. Two
 * guards hold this claim: the `location.type` error (N3) and the location
 * phase (N4); only both removed redden it.
 */
export async function assertRetiredTypeTurnIsNotReadyToCommit(): Promise<void> {
  const { turn } = await storedTurn("Lotapata", COMPLETE_INACTIVE_TYPE, "review");
  assert(turn.readyToCommit === false, "a draft whose type is not active is never ready to commit");
}
