// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  aCommittedSessionFromAChatTurnNavigatesToTheRtus,
  aFailedTemplateDownloadShowsTheReason,
  aFailedUploadReachesTheChatBanner,
  aFailedValidateShowsSomethingAtAll,
  anActionMessageRendersAsASmallLineNotABubble,
  aRefusedChatTurnShowsTheServersSentence,
  aRefusedCommitShowsTheReason,
  aRefusedCredentialSaveShowsTheReason,
  aRefusedStartShowsASentenceNotAZodFlatten,
  restoreScrolling,
  aNewSessionWritesItsIdIntoTheUrl,
  aSessionIdInTheUrlResumesTheConversation,
  theCredentialsFormPostsToTheResumedSession,
  aCommittedSessionIsNotResumed,
  aSessionOfAnotherOrganizationIsNotResumed,
  aResumedDraftShowsItsValidationIssues,
  aNonUuidSessionIdIsNotFetched,
  aResume400StartsANewSession,
  aResume403StartsANewSession,
  aResume404StartsANewSession,
  aRefusedResumeIsShownNotReplaced,
  aPairedBoldRendersAsStrong,
  anUnpairedMarkerStaysLiteral,
  anHtmlBearingMessageRendersNoMarkup,
  suggestedRepliesRenderAsButtons,
  aSuggestedReplySendsItsText,
  aCommitReplyIsSentAsText,
  theViewDraftReplyOpensThePreview,
  repliesHideWhileATurnIsPending,
  onlyTheLatestTurnsRepliesShow,
  aConfirmCommitReplyIsNeverOffered,
  markupInsideABoldPairRendersAsText,
  aUserRowStaysPlain,
  anUploadSetsItsReplies,
  aRefusedCredentialTurnReplacesTheReplies,
  aChatTurnsConfirmCommitReplyIsNotOffered,
  anUploadsConfirmCommitReplyIsNotOffered,
} from "./onboarding-chat-page.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 *
 * The `@vitest-environment jsdom` docblock is on THIS file because Vitest reads
 * it from the file it collects (ADR 0042 decision 2).
 *
 * One `it()` per claim, so a mutation reddens exactly the case it belongs to.
 * A single case covering several surfaces hides the ones a mutation never
 * reaches — the failure `F4.105` recorded.
 */
describe("F4.106 onboarding chat page error surfaces", () => {
  // `test-setup.ts` sets testing-library's `asyncUtilTimeout` to 5000 ms, which
  // is exactly Vitest's default `testTimeout` — so a case whose banner never
  // appears loses the race and reports "Test timed out", naming no assertion at
  // all. This row's whole discipline is reading WHICH assertion a mutation
  // reddens, so the budget has to sit above the wait it contains.
  vi.setConfig({ testTimeout: 15_000 });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    // A prototype assignment is not a spy, so the line above does not undo it.
    restoreScrolling();
  });

  it("shows a sentence, not a Zod flatten, when the session cannot start", async () => {
    await aRefusedStartShowsASentenceNotAZodFlatten();
  });

  it("shows the server's sentence when a chat turn is refused", async () => {
    await aRefusedChatTurnShowsTheServersSentence();
  });

  it("shows the reason when a commit is refused", async () => {
    await aRefusedCommitShowsTheReason();
  });

  it("shows the reason when a credential save is refused", async () => {
    await aRefusedCredentialSaveShowsTheReason();
  });

  it("shows something at all when a validation request fails", async () => {
    await aFailedValidateShowsSomethingAtAll();
  });

  it("shows a failed Excel upload in the chat banner", async () => {
    await aFailedUploadReachesTheChatBanner();
  });

  it("shows the reason when the template download is refused", async () => {
    await aFailedTemplateDownloadShowsTheReason();
  });
});

describe("F3.21 onboarding chat page agent loop", () => {
  vi.setConfig({ testTimeout: 15_000 });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    restoreScrolling();
  });

  it("renders an action message as a small line, not a bubble", async () => {
    await anActionMessageRendersAsASmallLineNotABubble();
  });

  it("navigates to the RTU list when a chat turn commits the session", async () => {
    await aCommittedSessionFromAChatTurnNavigatesToTheRtus();
  });
});

describe("F4.194 onboarding chat page keeps its session in the URL", () => {
  vi.setConfig({ testTimeout: 15_000 });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    restoreScrolling();
  });

  it("writes a new session's id into the URL", async () => {
    await aNewSessionWritesItsIdIntoTheUrl();
  });

  it("resumes the session and conversation the URL names, creating none", async () => {
    await aSessionIdInTheUrlResumesTheConversation();
  });

  it("posts credentials to the resumed session", async () => {
    await theCredentialsFormPostsToTheResumedSession();
  });

  it("reads a resumed draft's validation again and shows its issues", async () => {
    await aResumedDraftShowsItsValidationIssues();
  });

  it("does not resume a committed session", async () => {
    await aCommittedSessionIsNotResumed();
  });

  it("does not resume a session of another organization", async () => {
    await aSessionOfAnotherOrganizationIsNotResumed();
  });

  it("never sends an id that is not a uuid to the API", async () => {
    await aNonUuidSessionIdIsNotFetched();
  });

  it("starts a new session on a 400 resume read", async () => {
    await aResume400StartsANewSession();
  });

  it("starts a new session on a 403 resume read", async () => {
    await aResume403StartsANewSession();
  });

  it("starts a new session on a 404 resume read", async () => {
    await aResume404StartsANewSession();
  });

  it("shows any other refused resume and creates no session behind it", async () => {
    await aRefusedResumeIsShownNotReplaced();
  });
});

describe("F4.198 onboarding chat page renders the assistant's bold", () => {
  vi.setConfig({ testTimeout: 15_000 });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    restoreScrolling();
  });

  it("renders a paired marker as strong", async () => {
    await aPairedBoldRendersAsStrong();
  });

  it("leaves a lone marker as literal text", async () => {
    await anUnpairedMarkerStaysLiteral();
  });

  it("renders a message carrying HTML as text, not markup", async () => {
    await anHtmlBearingMessageRendersNoMarkup();
  });
});

describe("F4.199 onboarding chat page suggested replies", () => {
  vi.setConfig({ testTimeout: 15_000 });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    restoreScrolling();
  });

  it("renders each suggested reply as a button", async () => {
    await suggestedRepliesRenderAsButtons();
  });

  it("sends a suggested reply's text as the chat turn", async () => {
    await aSuggestedReplySendsItsText();
  });

  it("sends the Commit reply as text", async () => {
    await aCommitReplyIsSentAsText();
  });

  it("opens the preview for the View draft reply and sends nothing", async () => {
    await theViewDraftReplyOpensThePreview();
  });

  it("hides the replies while a turn is pending", async () => {
    await repliesHideWhileATurnIsPending();
  });

  it("shows only the latest turn's replies", async () => {
    await onlyTheLatestTurnsRepliesShow();
  });

  it("never offers a confirm commit reply", async () => {
    await aConfirmCommitReplyIsNeverOffered();
  });

  it("renders markup inside a bold pair as text", async () => {
    await markupInsideABoldPairRendersAsText();
  });

  it("keeps a user row plain", async () => {
    await aUserRowStaysPlain();
  });

  it("sets the replies from an Excel upload", async () => {
    await anUploadSetsItsReplies();
  });

  it("replaces the replies on a refused credential turn", async () => {
    await aRefusedCredentialTurnReplacesTheReplies();
  });

  it("does not offer a chat turn's confirm commit reply", async () => {
    await aChatTurnsConfirmCommitReplyIsNotOffered();
  });

  it("does not offer an upload's confirm commit reply", async () => {
    await anUploadsConfirmCommitReplyIsNotOffered();
  });
});
