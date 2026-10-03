import type {
  ChatCompletionFunctionTool,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";

import {
  LlmProviderError,
  type LlmMessage,
  type LlmReply,
  type LlmToolDefinition,
  type OnboardingLlmProvider,
} from "./onboarding-llm-port";

/** Amendment 1 A1: OpenRouter is the `openai` package at this base URL. */
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/**
 * The OpenAI chat-completions adapter, used for `openai` and, with
 * `OPENROUTER_BASE_URL`, for `openrouter` (ADR 0090 Amendment 1 A1).
 *
 * Thin on purpose: map the port's messages and tools to the SDK, call it with
 * the turn's `AbortSignal`, and map the reply back. It reads no environment
 * variable — the key and the model arrive in the constructor from the resolver.
 * SDK rejections are rethrown as they are; the loop classifies them by whether
 * the turn's deadline fired.
 */
export class OpenAiCompatibleProvider implements OnboardingLlmProvider {
  constructor(
    readonly name: "openai" | "openrouter",
    private readonly options: { readonly apiKey: string; readonly model: string; readonly baseURL?: string },
  ) {}

  async complete(input: {
    readonly messages: readonly LlmMessage[];
    readonly tools: readonly LlmToolDefinition[];
    readonly signal: AbortSignal;
  }): Promise<LlmReply> {
    // Imported on use, as `handleOpenAiTurn` did, so the SDK loads only in a
    // process that has a provider configured.
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({
      apiKey: this.options.apiKey,
      ...(this.options.baseURL ? { baseURL: this.options.baseURL } : {}),
    });
    const completion = await client.chat.completions.create(
      {
        model: this.options.model,
        messages: input.messages.map(toOpenAiMessage),
        tools: input.tools.map(toOpenAiTool),
        tool_choice: "auto",
      },
      { signal: input.signal },
    );
    const message = completion.choices?.[0]?.message;
    if (!message) {
      throw new LlmProviderError("the provider returned no choice");
    }
    const calls = (message.tool_calls ?? []).flatMap((call) =>
      call.type === "function"
        ? [{ id: call.id, name: call.function.name, arguments: call.function.arguments }]
        : [],
    );
    if (calls.length > 0) {
      return { kind: "tool_calls", calls, content: message.content ?? null };
    }
    return { kind: "final", text: message.content ?? "" };
  }
}

function toOpenAiTool(tool: LlmToolDefinition): ChatCompletionFunctionTool {
  return {
    type: "function",
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  };
}

function toOpenAiMessage(message: LlmMessage): ChatCompletionMessageParam {
  if (message.role === "tool") {
    return { role: "tool", tool_call_id: message.toolCallId, content: message.content };
  }
  if ("toolCalls" in message) {
    return {
      role: "assistant",
      content: message.content,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: "function" as const,
        function: { name: call.name, arguments: call.arguments },
      })),
    };
  }
  return { role: message.role, content: message.content };
}
