import { describe, it } from "vitest";

import {
  assertAChatTurnGrowsTheDraftByOne,
  assertAnAtCapChatTurnIsRefusedInTheReply,
  assertAnAtCapPointKeyTurnIsRefusedInTheReply,
  assertAnOverCapSessionStillRefusesTheTurn,
  assertTheCredentialNudgeStillAnswersFirst,
} from "./onboarding-chat-caps.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 *
 * `OnboardingService.chat` had no database-free cover at all, which is how the
 * chat patch builder — the default branch when no OpenAI key is set — shipped as
 * the one draft producer with no count bound.
 */
describe("onboarding chat count caps (F4.103)", () => {
  it("grows the stored draft by one RTU per turn, which is why it needs a bound", async () => {
    await assertAChatTurnGrowsTheDraftByOne();
  });

  it("refuses an at-cap RTU turn in the reply and leaves the draft unchanged (F3.27)", async () => {
    await assertAnAtCapChatTurnIsRefusedInTheReply();
  });

  it("refuses an at-cap point-key turn on its own cap, not the RTU one (F3.27)", async () => {
    await assertAnAtCapPointKeyTurnIsRefusedInTheReply();
  });

  it("still answers 400 and writes nothing for a session already over a cap", async () => {
    await assertAnOverCapSessionStillRefusesTheTurn();
  });

  it("still answers a credential-looking turn with the credentials nudge", async () => {
    await assertTheCredentialNudgeStillAnswersFirst();
  });
});
