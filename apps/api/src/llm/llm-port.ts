import type { LlmProviderName } from "@bms/shared";

/**
 * The onboarding agent's provider port (`F3.21`, ADR 0090 decision 1 and
 * Amendment 1 A1).
 *
 * Messages and tool definitions go in; tool calls or a final text come out. The
 * port knows nothing about the draft, and nothing here reads the environment:
 * `LlmResolver` decides, once per turn, whether a provider exists and
 * builds it with its key and model (A4). An adapter that reads `process.env`
 * would let a platform key reach an organization that set its own provider,
 * which A4 forbids.
 */

export type { LlmProviderName };

/** A tool as the model sees it. `parameters` is a JSON Schema object. */
export type LlmToolDefinition = {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
};

/** One call the model asked for. `arguments` is raw JSON text; the registry parses it. */
export type LlmToolCall = {
  readonly id: string;
  readonly name: string;
  readonly arguments: string;
};

export type LlmMessage =
  | { readonly role: "system" | "user" | "assistant"; readonly content: string }
  | {
      readonly role: "assistant";
      readonly content: string | null;
      readonly toolCalls: readonly LlmToolCall[];
      /**
       * Amendment 1 A1: the provider's own reply content, opaque to the loop.
       * The adapter that produced it sends it back unchanged in the next round
       * of the **same** turn — the Anthropic Messages API needs the full
       * assistant content back, thinking blocks included. History across turns
       * never carries it.
       */
      readonly providerContent?: unknown;
    }
  | { readonly role: "tool"; readonly toolCallId: string; readonly content: string; readonly isError: boolean };

export type LlmReply =
  | {
      readonly kind: "tool_calls";
      readonly calls: readonly LlmToolCall[];
      readonly content: string | null;
      readonly providerContent?: unknown;
    }
  | { readonly kind: "final"; readonly text: string };

export interface LlmProvider {
  readonly name: LlmProviderName;
  complete(input: {
    readonly messages: readonly LlmMessage[];
    readonly tools: readonly LlmToolDefinition[];
    readonly signal: AbortSignal;
  }): Promise<LlmReply>;
}

/**
 * A reply the loop cannot use: no choice, an Anthropic `refusal` that survived
 * the server-side fallback, or a reply cut at `max_tokens`. Ruling 6 treats it
 * like any provider failure — the turn is discarded and the guided mode
 * answers.
 */
export class LlmProviderError extends Error {
  constructor(
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = "LlmProviderError";
  }
}
