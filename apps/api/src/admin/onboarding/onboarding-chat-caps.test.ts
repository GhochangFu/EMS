import { describe, it } from "vitest";

import {
  assertAChatTurnGrowsTheDraftByOne,
  assertAnOverCapChatTurnIsRefusedAndWritesNothing,
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

  it("refuses a turn that would carry the draft past a cap, and writes nothing", async () => {
    await assertAnOverCapChatTurnIsRefusedAndWritesNothing();
  });

  it("still answers a credential-looking turn with the credentials nudge", async () => {
    await assertTheCredentialNudgeStillAnswersFirst();
  });
});
