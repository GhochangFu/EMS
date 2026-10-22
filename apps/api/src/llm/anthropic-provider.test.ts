import { describe, it, vi } from "vitest";

const capture = vi.hoisted(() => ({
  constructed: [] as Record<string, unknown>[],
  requests: [] as { body: Record<string, unknown>; options: Record<string, unknown> }[],
  reply: undefined as unknown,
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    constructor(options: Record<string, unknown>) {
      capture.constructed.push(options);
    }
    beta = {
      messages: {
        create: async (body: Record<string, unknown>, options: Record<string, unknown>): Promise<unknown> => {
          capture.requests.push({ body, options });
          return capture.reply;
        },
      },
    };
  },
}));

import {
  assertARefusalIsAProviderError,
  assertAStringUserContentIsSentAsAString,
  assertConsecutiveToolResultsAreOneUserMessage,
  assertImageAndPdfPartsAreNativeBlocks,
  assertMaxTokensIsAProviderError,
  assertNoSystemAndNoToolsSendNoMark,
  assertOnlyTheLastToolIsCacheMarked,
  assertProviderContentIsEchoedBackUnchanged,
  assertSystemBlocksKeepOrderAndOnlyTheFirstIsCacheMarked,
  assertTextOnlyIsFinal,
  assertTheCallShapeIsTheAmendmentsOne,
  assertToolUseBlocksBecomeToolCallsWithStringifiedInput,
} from "./anthropic-provider.spec";

/** Vitest entry point — see `admin.schema.test.ts` for the pattern (ADR 0014). One `it()` per claim. */
describe("Anthropic provider (F3.21, ADR 0090 Amendment 1 A1)", () => {
  it("sends the amendment's call shape", async () => {
    await assertTheCallShapeIsTheAmendmentsOne(capture);
  });

  it("maps tool_use blocks to tool calls with stringified input", async () => {
    await assertToolUseBlocksBecomeToolCallsWithStringifiedInput(capture);
  });

  it("echoes the provider content back unchanged within the turn", async () => {
    await assertProviderContentIsEchoedBackUnchanged(capture);
  });

  it("sends consecutive tool results as one user message", async () => {
    await assertConsecutiveToolResultsAreOneUserMessage(capture);
  });

  it("treats a refusal as a provider error", async () => {
    await assertARefusalIsAProviderError(capture);
  });

  it("treats max_tokens as a provider error", async () => {
    await assertMaxTokensIsAProviderError(capture);
  });

  it("maps text only to a final reply", async () => {
    await assertTextOnlyIsFinal(capture);
  });

  it("sends an image as an image block and a PDF as a document block (F3.87 A5)", async () => {
    await assertImageAndPdfPartsAreNativeBlocks(capture);
  });

  it("sends a string user content as a string", async () => {
    await assertAStringUserContentIsSentAsAString(capture);
  });

  it("cache-marks only the last tool (ADR 0099 Amendment 7 C1)", async () => {
    await assertOnlyTheLastToolIsCacheMarked(capture);
  });

  it("sends one system block per system message in order, cache-marking only the first (ADR 0099 Amendment 7 C1)", async () => {
    await assertSystemBlocksKeepOrderAndOnlyTheFirstIsCacheMarked(capture);
  });

  it("sends no system field and no cache mark when there is no system message and no tool (ADR 0099 Amendment 7 C1)", async () => {
    await assertNoSystemAndNoToolsSendNoMark(capture);
  });
});
