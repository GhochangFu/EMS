import { describe, it, vi } from "vitest";

const capture = vi.hoisted(() => ({
  constructed: [] as Record<string, unknown>[],
  requests: [] as { body: Record<string, unknown>; options: Record<string, unknown> }[],
  reply: undefined as unknown,
}));

vi.mock("openai", () => ({
  default: class {
    constructor(options: Record<string, unknown>) {
      capture.constructed.push(options);
    }
    chat = {
      completions: {
        create: async (body: Record<string, unknown>, options: Record<string, unknown>): Promise<unknown> => {
          capture.requests.push({ body, options });
          return capture.reply;
        },
      },
    };
  },
}));

import {
  assertAMissingChoiceIsAProviderError,
  assertFunctionToolCallsBecomeToolCalls,
  assertNoToolCallsIsFinalText,
  assertOpenAiPinsItsBaseUrlAndNoOrgHeaders,
  assertOpenRouterUsesTheOpenRouterBaseUrlAndTheGivenKey,
  assertTheAdapterReadsNoEnv,
  assertTheSignalReachesTheSdk,
  assertToolMessagesCarryTheCallId,
  assertToolsAreForwardedAsFunctionTools,
} from "./onboarding-openai-provider.spec";

/** Vitest entry point — see `admin.schema.test.ts` for the pattern (ADR 0014). One `it()` per claim. */
describe("OpenAI-compatible provider (F3.21, ADR 0090 Amendment 1 A1)", () => {
  it("forwards tools as function tools with auto choice", async () => {
    await assertToolsAreForwardedAsFunctionTools(capture);
  });

  it("sends a tool result with its call id", async () => {
    await assertToolMessagesCarryTheCallId(capture);
  });

  it("passes the turn's signal to the SDK", async () => {
    await assertTheSignalReachesTheSdk(capture);
  });

  it("maps function tool calls in order and ignores other kinds", async () => {
    await assertFunctionToolCallsBecomeToolCalls(capture);
  });

  it("maps a reply without tool calls to final text", async () => {
    await assertNoToolCallsIsFinalText(capture);
  });

  it("raises a provider error for a missing choice", async () => {
    await assertAMissingChoiceIsAProviderError(capture);
  });

  it("builds OpenRouter at its base URL with the given key and model", async () => {
    await assertOpenRouterUsesTheOpenRouterBaseUrlAndTheGivenKey(capture);
  });

  it("pins the OpenAI base URL and sends no organization or project header", async () => {
    await assertOpenAiPinsItsBaseUrlAndNoOrgHeaders(capture);
  });

  it("reads no environment variable", async () => {
    await assertTheAdapterReadsNoEnv(capture);
  });
});
