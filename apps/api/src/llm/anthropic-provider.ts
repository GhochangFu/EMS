import type {
  BetaContentBlock,
  BetaContentBlockParam,
  BetaMessageParam,
  BetaTool,
  BetaToolResultBlockParam,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";

import {
  LlmProviderError,
  type LlmMessage,
  type LlmReply,
  type LlmToolCall,
  type LlmToolDefinition,
  type LlmProvider,
} from "./llm-port";

/**
 * The beta that gates the scalar `fallbacks: "default"` form. The array form
 * takes `server-side-fallback-2026-06-01` instead, and pairing either header
 * with the other form is a 400 — so the two are pinned together by a spec.
 */
export const ANTHROPIC_FALLBACK_BETA = "server-side-fallback-2026-07-01";

/** Amendment 1 A1: one non-streaming reply never exceeds this. */
export const ANTHROPIC_MAX_TOKENS = 16_000;

/** Passed explicitly so `ANTHROPIC_BASE_URL` cannot redirect an organization's key. */
export const ANTHROPIC_BASE_URL = "https://api.anthropic.com";

/**
 * The Anthropic Messages API adapter (ADR 0090 Amendment 1 A1).
 *
 * - `tool_choice` is `auto`: Claude Sonnet 5.5 refuses a forced tool choice.
 * - `output_config.effort` is `medium`, so up to nine calls fit in the 45 s
 *   turn; thinking stays at the model default (adaptive).
 * - `fallbacks: "default"` re-runs a declined request on Anthropic's
 *   recommended fallback model server-side. A reply whose final `stop_reason`
 *   is still `refusal` — or that was cut at `max_tokens` — is a provider error,
 *   so ruling 6 discards the turn and the guided mode answers.
 * - An assistant turn with tool calls goes back as the **full content** the API
 *   returned, thinking blocks included (`providerContent`); rebuilding it from
 *   the tool calls would drop them.
 *
 * It reads no environment variable: the key and the model come from the
 * resolver.
 */
export class AnthropicProvider implements LlmProvider {
  readonly name = "anthropic" as const;

  constructor(private readonly options: { readonly apiKey: string; readonly model: string }) {}

  async complete(input: {
    readonly messages: readonly LlmMessage[];
    readonly tools: readonly LlmToolDefinition[];
    readonly signal: AbortSignal;
  }): Promise<LlmReply> {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    // Security review L7: `authToken: null` stops a platform
    // `ANTHROPIC_AUTH_TOKEN` riding along as a Bearer token beside the
    // organization's key. `ANTHROPIC_CUSTOM_HEADERS` has no option to refuse
    // it; compose does not set it.
    const client = new Anthropic({ apiKey: this.options.apiKey, authToken: null, baseURL: ANTHROPIC_BASE_URL });
    const system = input.messages
      .filter((message): message is { role: "system"; content: string } => message.role === "system")
      .map((message) => message.content)
      .join("\n\n");
    const response = await client.beta.messages.create(
      {
        betas: [ANTHROPIC_FALLBACK_BETA],
        model: this.options.model,
        max_tokens: ANTHROPIC_MAX_TOKENS,
        ...(system ? { system } : {}),
        messages: toAnthropicMessages(input.messages),
        tools: input.tools.map(toAnthropicTool),
        tool_choice: { type: "auto" },
        output_config: { effort: "medium" },
        fallbacks: "default",
      },
      { signal: input.signal },
    );
    if (response.stop_reason === "refusal") {
      throw new LlmProviderError("the model declined the request");
    }
    if (response.stop_reason === "max_tokens") {
      throw new LlmProviderError("the reply was cut at max_tokens");
    }
    const text = joinText(response.content);
    const calls: LlmToolCall[] = response.content.flatMap((block) =>
      block.type === "tool_use"
        ? [{ id: block.id, name: block.name, arguments: JSON.stringify(block.input ?? {}) }]
        : [],
    );
    if (calls.length > 0) {
      return { kind: "tool_calls", calls, content: text || null, providerContent: response.content };
    }
    return { kind: "final", text };
  }
}

function joinText(content: readonly BetaContentBlock[]): string {
  return content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("\n")
    .trim();
}

function toAnthropicTool(tool: LlmToolDefinition): BetaTool {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters as BetaTool["input_schema"],
  };
}

/**
 * The port's messages as Messages API turns. `system` goes to the `system`
 * parameter; a run of `tool` messages becomes **one** `user` message of
 * `tool_result` blocks, as the API requires.
 */
export function toAnthropicMessages(messages: readonly LlmMessage[]): BetaMessageParam[] {
  const out: BetaMessageParam[] = [];
  let results: BetaToolResultBlockParam[] = [];
  const flush = (): void => {
    if (results.length > 0) {
      out.push({ role: "user", content: results });
      results = [];
    }
  };
  for (const message of messages) {
    if (message.role === "system") {
      continue;
    }
    if (message.role === "tool") {
      results.push({
        type: "tool_result",
        tool_use_id: message.toolCallId,
        content: message.content,
        ...(message.isError ? { is_error: true } : {}),
      });
      continue;
    }
    flush();
    if ("toolCalls" in message) {
      const content = Array.isArray(message.providerContent)
        ? (message.providerContent as BetaContentBlockParam[])
        : rebuiltToolUse(message.content, message.toolCalls);
      out.push({ role: "assistant", content });
      continue;
    }
    out.push({ role: message.role, content: message.content });
  }
  flush();
  return out;
}

/** Only reached for a tool-call message that did not come from this adapter. */
function rebuiltToolUse(text: string | null, calls: readonly LlmToolCall[]): BetaContentBlockParam[] {
  const blocks: BetaContentBlockParam[] = text ? [{ type: "text", text }] : [];
  for (const call of calls) {
    let input: unknown = {};
    try {
      input = JSON.parse(call.arguments);
    } catch {
      input = {};
    }
    blocks.push({ type: "tool_use", id: call.id, name: call.name, input });
  }
  return blocks;
}
