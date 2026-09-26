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

// ---------------------------------------------------------------------------
// F4.157 review — a stored type. Each case starts from a stored draft, takes
// the first phase from `inferPhase` as `PATCH :id/draft` does, and stores each
// turn through the real `mergeDraft`, never through a hand-built draft.
// ---------------------------------------------------------------------------

/** A workbook with a blank name cell and a blank code cell, and a type. */
const TYPED_BLANK = {
  location: { name: "", slug: "", code: "", type: "pump_station", latitude: 22.3, longitude: 87.3 },
} as OnboardingDraft;

/** A named, typed location whose code and slug a `PATCH :id/draft` cleared. */
const TYPED_NAMED_NO_CODE = {
  location: { name: "Lotapata", slug: "", code: "", type: "smoc_campus", latitude: 22.3, longitude: 87.3 },
} as OnboardingDraft;

/** One rule-based turn from `stored`, and the draft `mergeDraft` stores after it. */
async function storedTurn(
  message: string,
  stored: OnboardingDraft,
  phase: OnboardingPhase = new OnboardingValidateService().inferPhase(stored),
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
 * R4 — a type reply to a named, typed location never renames it. The stored
 * location has a name and a type, and the message names a type: it is a type
 * reply, whether or not the stored draft already holds one.
 */
export async function assertTypeReplyToATypedLocationKeepsTheName(): Promise<void> {
  const { draft } = await storedTurn("Pump station", TYPED_NAMED_NO_CODE);
  assert(
    draft.location?.name === "Lotapata",
    `a type reply never renames the location, got ${JSON.stringify(draft.location?.name)}`,
  );
}

/** R4 — the same reply sets the type it names. */
export async function assertTypeReplyToATypedLocationSetsTheType(): Promise<void> {
  const { draft } = await storedTurn("Pump station", TYPED_NAMED_NO_CODE);
  assert(
    draft.location?.type === "pump_station",
    `the reply sets the type it names, got ${JSON.stringify(draft.location?.type)}`,
  );
}

/**
 * R4 — a kept location's empty code is derived from its name. A stored `""`
 * spread over the derived value would leave the phase on `location`, and the
 * next message ("MQTT") would be read as a new name.
 */
export async function assertTypeReplyFillsAnEmptyStoredCode(): Promise<void> {
  const { draft } = await storedTurn("Pump station", TYPED_NAMED_NO_CODE);
  assert(
    draft.location?.code === "LOTAPATA",
    `an empty stored code is derived, got ${JSON.stringify(draft.location?.code)}`,
  );
}

/** R4 — the same for an empty stored slug. */
export async function assertTypeReplyFillsAnEmptyStoredSlug(): Promise<void> {
  const { draft } = await storedTurn("Pump station", TYPED_NAMED_NO_CODE);
  assert(
    draft.location?.slug === "lotapata",
    `an empty stored slug is derived, got ${JSON.stringify(draft.location?.slug)}`,
  );
}

/**
 * R5 — the OpenAI branch: a model patch whose location loses its type (here an
 * inactive one, dropped) does not report a missing type the stored draft
 * holds. The turn validates the draft `mergeDraft` will store, where the
 * stored type survives.
 */
export async function assertOpenAiPatchWithoutTypeKeepsTheStoredType(
  captured: OpenAiCapture,
): Promise<void> {
  const stored = {
    location: {
      name: "Lotapata",
      slug: "lotapata",
      code: "LOTAPATA",
      type: "pump_station",
      latitude: 22.3,
      longitude: 87.3,
    },
  } as OnboardingDraft;
  const turn = await openAiTurn(captured, replyWithLocationType("space_port"), stored);
  assert(Array.isArray(turn.validationErrors), "the turn reports its validation");
  const missing = (turn.validationErrors ?? []).filter((e) => e.message === "Location type is required");
  assert(missing.length === 0, `the stored type survives the patch, got ${JSON.stringify(missing)}`);
}
