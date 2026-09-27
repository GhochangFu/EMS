import { describe, it, vi } from "vitest";

/**
 * The `openai` mock, for the H4 cases. `vi.mock` is hoisted above the imports
 * and only a Vitest file may declare it, so it lives here and the assertions
 * stay in the spec (ADR 0014). The shape is `onboarding-prompt-budget.test.ts`'s:
 * `captured` holds each request and the reply the mocked `create()` returns.
 */
const captured = vi.hoisted(() => ({ requests: [] as unknown[], reply: "{}" }));

vi.mock("openai", () => ({
  default: class {
    chat = {
      completions: {
        create: async (request: unknown): Promise<unknown> => {
          captured.requests.push(request);
          return { choices: [{ message: { content: captured.reply } }] };
        },
      },
    };
  },
}));

import {
  assertAwaitingTypeReplyKeepsTheStoredName,
  assertNameMessageDerivesTheCode,
  assertNameMessageRenamesATypedLocation,
  assertNameMessageSetsTheTypeItNames,
  assertNameWithLabelSetsTheTypeInOneTurn,
  assertNameWithTypeSetsTheTypeInOneTurn,
  assertNameWithoutTypeAsksForTheType,
  assertOpenAiPatchKeepsAnActiveType,
  assertOpenAiPatchLosesAnInactiveType,
  assertOpenAiTurnValidatesTheMergedDraft,
  assertOpenAiPromptListsTheActiveCodes,
  assertStoredInactiveTypeIsAskedFor,
  assertStoredInactiveTypeIsNotPatched,
  assertStoredTypeIsNotAskedFor,
  assertStoredTypeKeepsTheNameThroughTwoTurns,
  assertStoredTypeReportsNoMissingType,
  assertTypeQuestionPatchesNoType,
  assertTypeQuestionSuggestsTheActiveLabels,
  assertTypeReplyAsksTheRtuQuestion,
  assertTypeReplyFillsAnEmptyStoredCode,
  assertTypeReplyFillsAnEmptyStoredSlug,
  assertTypeReplyKeepsTheStoredIdentifiers,
  assertTypeReplyMatchesALabel,
  assertTypeReplySetsTheType,
  assertTypeWordMatchesWholeWords,
  assertUnmatchedReplyAsksAgain,
  assertRetiredTypeAnswerAsksTheRtuQuestion,
  assertRetiredTypeAnswerMovesToTheRtuPhase,
  assertRetiredTypeAnswerSetsTheType,
  assertRetiredTypeIsAskedForAtTheRtuPhase,
  assertRetiredTypeQuestionSuggestsTheActiveLabels,
  assertRetiredTypeTurnAddsNoRtu,
  assertRetiredTypeTurnIsNotReadyToCommit,
  assertRetiredTypeTurnReportsTheLocationPhase,
  assertRetiredTypeTurnReportsTheTypeError,
} from "./onboarding-chat-location-type.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("OnboardingChatService.handleTurn — the location type (F4.157), rule-based", () => {
  it("asks for the type when the name carries no type word", async () => {
    await assertNameWithoutTypeAsksForTheType();
  });

  it("suggests the active labels as replies", async () => {
    await assertTypeQuestionSuggestsTheActiveLabels();
  });

  it("stores the name and no type while it asks", async () => {
    await assertTypeQuestionPatchesNoType();
  });

  it("sets the type from the next reply and keeps the name", async () => {
    await assertTypeReplySetsTheType();
  });

  it("asks the RTU question once the type is set", async () => {
    await assertTypeReplyAsksTheRtuQuestion();
  });

  it("matches a reply on the label, not only on the code", async () => {
    await assertTypeReplyMatchesALabel();
  });

  it("asks again, without a rename, when the reply names no type", async () => {
    await assertUnmatchedReplyAsksAgain();
  });

  it("sets the type in the same turn when the name carries a type word", async () => {
    await assertNameWithTypeSetsTheTypeInOneTurn();
  });

  it("sets the type in the same turn from a label", async () => {
    await assertNameWithLabelSetsTheTypeInOneTurn();
  });

  it("matches whole words only", async () => {
    await assertTypeWordMatchesWholeWords();
  });

  it("keeps the stored slug and code when the reply sets the type", async () => {
    await assertTypeReplyKeepsTheStoredIdentifiers();
  });
});

describe("OnboardingChatService.handleTurn — a stored location type (F4.157 review), through mergeDraft", () => {
  it("does not ask for a type the stored draft holds", async () => {
    await assertStoredTypeIsNotAskedFor();
  });

  it("keeps the name typed in turn 1 through a type-word turn 2", async () => {
    await assertStoredTypeKeepsTheNameThroughTwoTurns();
  });

  it("does not report a stored type as missing", async () => {
    await assertStoredTypeReportsNoMissingType();
  });

  it("renames a named, typed location to the message, as before F4.157", async () => {
    await assertNameMessageRenamesATypedLocation();
  });

  it("sets the type the renaming message names", async () => {
    await assertNameMessageSetsTheTypeItNames();
  });

  it("derives the renamed location's code from the message", async () => {
    await assertNameMessageDerivesTheCode();
  });

  it("keeps the stored name while it waits for a type", async () => {
    await assertAwaitingTypeReplyKeepsTheStoredName();
  });

  it("derives a kept location's empty code from its name", async () => {
    await assertTypeReplyFillsAnEmptyStoredCode();
  });

  it("derives a kept location's empty slug from its name", async () => {
    await assertTypeReplyFillsAnEmptyStoredSlug();
  });

  it("asks again for a stored type that is not active", async () => {
    await assertStoredInactiveTypeIsAskedFor();
  });

  it("does not copy a stored inactive type into the patch", async () => {
    await assertStoredInactiveTypeIsNotPatched();
  });
});

describe("OnboardingChatService.handleTurn — the location type (F4.157), OpenAI", () => {
  it("validates the merged draft, so a patch that completes it moves the phase on", async () => {
    await assertOpenAiTurnValidatesTheMergedDraft(captured);
  });

  it("drops a location.type that is not an active code from the model's patch", async () => {
    await assertOpenAiPatchLosesAnInactiveType(captured);
  });

  it("keeps an active location.type in the model's patch", async () => {
    await assertOpenAiPatchKeepsAnActiveType(captured);
  });

  it("names the active codes in the system prompt", async () => {
    await assertOpenAiPromptListsTheActiveCodes(captured);
  });
});

describe("OnboardingChatService.handleTurn — a stored type retired after it was stored (F4.162)", () => {
  it("asks for the type again at the rtu phase", async () => {
    await assertRetiredTypeIsAskedForAtTheRtuPhase();
  });

  it("suggests the active labels as replies", async () => {
    await assertRetiredTypeQuestionSuggestsTheActiveLabels();
  });

  it("reports the location phase", async () => {
    await assertRetiredTypeTurnReportsTheLocationPhase();
  });

  it("adds no RTU", async () => {
    await assertRetiredTypeTurnAddsNoRtu();
  });

  it("sets the type from the next reply", async () => {
    await assertRetiredTypeAnswerSetsTheType();
  });

  it("asks the RTU question once the type is set", async () => {
    await assertRetiredTypeAnswerAsksTheRtuQuestion();
  });

  it("moves to the rtu phase once the type is set", async () => {
    await assertRetiredTypeAnswerMovesToTheRtuPhase();
  });

  it("reports the error at location.type", async () => {
    await assertRetiredTypeTurnReportsTheTypeError();
  });

  it("keeps a complete draft whose type is not active from being ready to commit", async () => {
    await assertRetiredTypeTurnIsNotReadyToCommit();
  });
});
