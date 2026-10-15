import type {
  ChatCompletionContentPart,
  ChatCompletionFunctionTool,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";

import {
  LlmProviderError,
  type LlmContentPart,
  type LlmMessage,
  type LlmReply,
  type LlmToolDefinition,
  type LlmProvider,
} from "./llm-port";

/** Amendment 1 A1: OpenRouter is the `openai` package at this base URL. */
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/** The `openai` provider's base URL, passed explicitly so `OPENAI_BASE_URL` cannot redirect an organization's key. */
export const OPENAI_BASE_URL = "https://api.openai.com/v1";

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
export class OpenAiCompatibleProvider implements LlmProvider {
  constructor(
    readonly name: "openai" | "openrouter",
    private readonly options: { readonly apiKey: string; readonly model: string; readonly baseURL?: string },
  ) {}

  async complete(input: {
    readonly messages: readonly LlmMessage[];
    readonly tools: readonly LlmToolDefinition[];
    readonly signal: AbortSignal;
  }): Promise<LlmReply> {
    // Imported on use, so the SDK loads only in a process that has a provider
    // configured for the turn.
    const { default: OpenAI } = await import("openai");
    // Security review L7: every option the SDK would otherwise fill from the
    // environment is passed explicitly. `OPENAI_ORG_ID` and `OPENAI_PROJECT_ID`
    // would otherwise ride along as headers on an organization's own key, even
    // to OpenRouter.
    const client = new OpenAI({
      apiKey: this.options.apiKey,
      baseURL: this.options.baseURL ?? OPENAI_BASE_URL,
      organization: null,
      project: null,
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
  if (message.role === "user") {
    return {
      role: "user",
      content: typeof message.content === "string" ? message.content : message.content.map(toOpenAiPart),
    };
  }
  return { role: message.role, content: message.content };
}

/**
 * ADR 0099 Amendment 3 A5: an image goes as an `image_url` part with a data
 * URL, a PDF as the Chat Completions `file` part with `file_data` as a data
 * URL. OpenRouter documents the same `file` shape for PDFs (live check owed,
 * F3.87 plan §12).
 */
function toOpenAiPart(part: LlmContentPart): ChatCompletionContentPart {
  switch (part.type) {
    case "text":
      return { type: "text", text: part.text };
    case "image":
      return { type: "image_url", image_url: { url: dataUrl(part.mediaType, part.data) } };
    case "document":
      return { type: "file", file: { filename: part.filename, file_data: dataUrl(part.mediaType, part.data) } };
  }
}

function dataUrl(mediaType: string, data: Buffer): string {
  return `data:${mediaType};base64,${data.toString("base64")}`;
}
