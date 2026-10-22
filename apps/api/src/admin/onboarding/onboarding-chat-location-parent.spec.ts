/**
 * `F4.243` (ADR 0098 Amendment 2, B5, B6) — the guided chat asks which
 * existing location the new one is under, once it has a name and a type, and
 * only when the organization has an active location to choose from.
 *
 * Every case runs a real rule-based turn through `OnboardingChatService` with
 * the real validator; the inventory fake answers the parent candidates.
 */
import type { LocationTypeDto, OnboardingDraft, OnboardingPhase } from "@bms/shared";

import { BANNED_IN_GUIDED_TEXT } from "./onboarding-chat-guided.spec";
import { OnboardingChatService, type ChatTurnResult } from "./onboarding-chat.service";
import type { ParentCandidate } from "./onboarding-location-parent";
import { EMPTY_TEMPLATE_CONTEXT } from "./onboarding-template-refs";
import { OnboardingValidateService } from "./onboarding-validate.service";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const TYPES: readonly LocationTypeDto[] = [
  { code: "smoc_campus", label: "SMOC campus" },
  { code: "pump_station", label: "Pump station" },
];

const CAMPUS: ParentCandidate = { code: "CAMPUS-1", name: "Thane Campus", active: true, depth: 1 };

const GUIDED_RESOLVER = { resolveForOrganization: async () => ({ kind: "guided", reason: "platform_off" }) };

function serviceWith(candidates: readonly ParentCandidate[]): OnboardingChatService {
  const intercepted = (): never => {
    throw new Error("the protocol-question intercept answered a parent case");
  };
  return new OnboardingChatService(
    new OnboardingValidateService(),
    {} as never,
    { getContextForOrganization: intercepted, formatForAssistant: intercepted } as never,
    { listPointKeys: async () => [] } as never,
    { listLocationTypes: async () => [...TYPES] } as never,
    GUIDED_RESOLVER as never,
    { context: async () => EMPTY_TEMPLATE_CONTEXT, pointKeyQuota: async () => "exempt" } as never,
    { listExisting: async () => ({ rows: [], total: 0 }), listParentCandidates: async () => [...candidates] } as never,
  );
}

async function turn(
  message: string,
  draft: OnboardingDraft,
  candidates: readonly ParentCandidate[] = [CAMPUS],
  phase: OnboardingPhase = "location",
): Promise<ChatTurnResult> {
  const savedKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    return await serviceWith(candidates).handleTurn(message, draft, phase, "Ion Exchange", "org-1", {
      sessionId: "s-1",
      history: [],
      pointKeyQuota: { createdByOrganization: 0 },
    });
  } finally {
    if (savedKey !== undefined) {
      process.env.OPENAI_API_KEY = savedKey;
    }
  }
}

/** A named, typed location whose parent is still open. */
function awaitingParent(): OnboardingDraft {
  return {
    location: {
      name: "Thane Pump",
      slug: "thane-pump",
      code: "THANE_PUMP",
      type: "pump_station",
      latitude: 19.2,
      longitude: 72.9,
    },
  };
}

/** A named location waiting for its type. */
function awaitingType(): OnboardingDraft {
  return { location: { name: "Thane Pump", slug: "thane-pump", code: "THANE_PUMP", latitude: 19.2, longitude: 72.9 } };
}

/** G1 — a candidate's code stores that code as the parent. */
export async function assertACodeReplyStoresTheParent(): Promise<void> {
  const result = await turn("CAMPUS-1", awaitingParent());
  const stored = result.draftPatch.location?.parentCode;
  assert(stored === "CAMPUS-1", `the parent is stored, got ${JSON.stringify(stored)}`);
}

/** G1b — and the reply never renames the location. Mutation 6 (the block after the name branch) reddens it. */
export async function assertACodeReplyKeepsTheLocationName(): Promise<void> {
  const result = await turn("CAMPUS-1", awaitingParent());
  const name = result.draftPatch.location?.name;
  assert(name === "Thane Pump", `the location keeps its name, got ${JSON.stringify(name)}`);
}

/** G1c — the placed location moves on to the RTU step. */
export async function assertAPlacedLocationMovesToTheRtuStep(): Promise<void> {
  const result = await turn("thane campus", awaitingParent());
  assert(result.currentPhase === "rtu", `the phase moves to rtu, got ${result.currentPhase}`);
}

/** G2 — **No parent** stores `null`: a top-level location by choice. */
export async function assertNoParentStoresNull(): Promise<void> {
  const result = await turn("No parent", awaitingParent());
  const stored = result.draftPatch.location?.parentCode;
  assert(stored === null, `No parent stores null, got ${JSON.stringify(stored)}`);
}

/** G3 — an unmatched reply asks again and writes nothing. */
export async function assertAnUnmatchedReplyAsksAgain(): Promise<void> {
  const result = await turn("somewhere else", awaitingParent());
  assert(
    result.assistantMessage.startsWith("I did not change the draft. Which existing location is **Thane Pump** under?"),
    `the question is asked again, got "${result.assistantMessage}"`,
  );
}

/** G3b — and records no write: an empty patch and no action line. */
export async function assertAnUnmatchedReplyWritesNothing(): Promise<void> {
  const result = await turn("somewhere else", awaitingParent());
  assert(
    JSON.stringify(result.draftPatch) === "{}" && result.actionLines.length === 0,
    `nothing is written, got ${JSON.stringify(result.draftPatch)} / ${JSON.stringify(result.actionLines)}`,
  );
}

/** G4 — an organization with no active location is not asked: the type turn goes on to the RTU step. */
export async function assertAnOrgWithNoLocationIsNotAsked(): Promise<void> {
  const result = await turn("Pump station", awaitingType(), []);
  assert(result.currentPhase === "rtu", `no parent question for an empty org, got ${result.currentPhase}`);
}

/** G5 — with a candidate, the type turn ends with the parent question. */
export async function assertTheTypeTurnEndsWithTheParentQuestion(): Promise<void> {
  const result = await turn("Pump station", awaitingType());
  assert(
    result.assistantMessage.startsWith("Which existing location is **Thane Pump** under?"),
    `the type turn asks for the parent, got "${result.assistantMessage}"`,
  );
}

/** G5b — and offers the active codes, **No parent** and **View draft**. */
export async function assertTheParentQuestionOffersTheChips(): Promise<void> {
  const result = await turn("Pump station", awaitingType());
  const replies = JSON.stringify(result.suggestedReplies);
  assert(replies === JSON.stringify(["CAMPUS-1", "No parent", "View draft"]), `the chips, got ${replies}`);
}

/** G6 — the parent write records its action line, naming the parent. */
export async function assertTheParentWriteRecordsItsActionLine(): Promise<void> {
  const result = await turn("CAMPUS-1", awaitingParent());
  const lines = JSON.stringify(result.actionLines);
  assert(
    lines === JSON.stringify(["Set location Thane Pump (pump_station) under CAMPUS-1"]),
    `one action line naming the parent, got ${lines}`,
  );
}

/** G7 (ADR 0090 Amendment 2 B2) — the parent step's texts name no input the code does not parse. */
export async function assertTheParentTextsCarryNoBannedWord(): Promise<void> {
  const texts = [
    (await turn("Pump station", awaitingType())).assistantMessage,
    (await turn("somewhere else", awaitingParent())).assistantMessage,
    (await turn("CAMPUS-1", awaitingParent())).assistantMessage,
    (await turn("No parent", awaitingParent())).assistantMessage,
  ];
  const hits = texts.flatMap((text) => BANNED_IN_GUIDED_TEXT.filter((banned) => text.includes(banned)));
  assert(hits.length === 0, `a parent-step reply carries ${JSON.stringify(hits)}: ${JSON.stringify(texts)}`);
}

/* -------------------------------------------------------------------------- *
 * Review #1 and #2 — a stored parent the commit would refuse is repaired on   *
 * the guided path, and the follow-up is the step the written draft is at.     *
 * -------------------------------------------------------------------------- */

const OLD: ParentCandidate = { code: "OLD-SITE", name: "Old Site", active: false, depth: 1 };

/** A draft past every step, at review, whose location names `parentCode` (absent when not passed). */
function reviewableDraft(parentCode?: string | null): OnboardingDraft {
  const location = awaitingParent().location!;
  return {
    location: { ...location, ...(parentCode === undefined ? {} : { parentCode }) },
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
    assets: [{ code: "THANE-ASSET-1", name: "Asset 1", siteName: "Thane Pump", rtuIndex: 0, domain: "electrical" }],
    assetPoints: [{ assetIndex: 0, pointKey: "kw", sourceDataKey: "s01" }],
  } as OnboardingDraft;
}

/** G8 — a stored inactive parent at review comes back to `location`. */
export async function assertAStoredInactiveParentComesBackToLocation(): Promise<void> {
  const result = await turn("somewhere else", reviewableDraft("OLD-SITE"), [CAMPUS, OLD], "review");
  assert(result.currentPhase === "location", `the phase comes back to location, got ${result.currentPhase}`);
}

/** G8b — and the question puts the inactive sentence first, without the stored code. */
export async function assertTheReAskCarriesTheInactiveSentence(): Promise<void> {
  const result = await turn("somewhere else", reviewableDraft("OLD-SITE"), [CAMPUS, OLD], "review");
  const want = "I did not change the draft. The parent location is inactive. Which existing location is **Thane Pump** under?";
  assert(
    result.assistantMessage.startsWith(want) && !result.assistantMessage.includes("OLD-SITE"),
    `the re-ask leads with the guard sentence, got "${result.assistantMessage}"`,
  );
}

/** G9 — **No parent** repairs it: the stored code becomes `null`. */
export async function assertNoParentRepairsAStoredInactiveParent(): Promise<void> {
  const result = await turn("No parent", reviewableDraft("OLD-SITE"), [CAMPUS, OLD], "review");
  const stored = result.draftPatch.location?.parentCode;
  assert(stored === null, `No parent repairs the parent, got ${JSON.stringify(stored)}`);
}

/** G9b — a valid code repairs it too. */
export async function assertAValidCodeRepairsAStoredInactiveParent(): Promise<void> {
  const result = await turn("CAMPUS-1", reviewableDraft("OLD-SITE"), [CAMPUS, OLD], "review");
  const stored = result.draftPatch.location?.parentCode;
  assert(stored === "CAMPUS-1", `a valid code repairs the parent, got ${JSON.stringify(stored)}`);
}

/** G10 (review #2) — past the RTU step, the follow-up is the review prompt, not the RTU 1 question. */
export async function assertTheFollowUpIsTheStepTheDraftIsAt(): Promise<void> {
  const result = await turn("CAMPUS-1", reviewableDraft(), [CAMPUS], "location");
  const want = "Got it — **Thane Pump** is under **CAMPUS-1**. Open the preview and click **Commit**, or say **create it**.";
  assert(result.assistantMessage === want, `the follow-up is the review step, got "${result.assistantMessage}"`);
}

/** G10b — and its phase and chips are that step's. */
export async function assertTheFollowUpPhaseIsTheStepTheDraftIsAt(): Promise<void> {
  const result = await turn("CAMPUS-1", reviewableDraft(), [CAMPUS], "location");
  const got = JSON.stringify([result.currentPhase, result.suggestedReplies]);
  assert(got === JSON.stringify(["review", ["create it", "View draft"]]), `the review step's phase and chips, got ${got}`);
}

/**
 * G11 (review #1, `stepPrompt`) — a turn that writes nothing and answers the
 * step prompt asks the parent question too, with the guard sentence first.
 */
export async function assertTheStepPromptAsksAStoredBadParentAgain(): Promise<void> {
  const result = await turn("yes please", reviewableDraft("OLD-SITE"), [CAMPUS, OLD], "review");
  const want = "I did not change the draft. The parent location is inactive. Which existing location is **Thane Pump** under?";
  assert(result.assistantMessage.startsWith(want), `the step prompt asks for the parent, got "${result.assistantMessage}"`);
}
