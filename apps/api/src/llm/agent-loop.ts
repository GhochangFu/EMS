import { cutToBound } from "../common/text-bounds";
import type { LlmMessage, LlmProvider, LlmToolCall, LlmToolDefinition } from "./llm-port";
import type { ToolOutcome } from "./tool-result";

/**
 * The generic agent loop (`F3.85`, ADR 0099), extracted from the onboarding
 * agent (`F3.21`, ADR 0090 decisions 2, 3, 7 and 9).
 *
 * One user turn runs model → tool calls → model until the model returns a
 * final text or a cap stops it. The loop knows nothing about what a tool does:
 * the caller's `runTool` owns the state, and this file owns only the caps, the
 * deadline and the turn record.
 *
 * Four stop reasons, and the two failure classes are told apart by the turn's
 * own `AbortSignal`:
 * - `final` — the model answered in text;
 * - `cap_calls` — the next call would exceed `maxToolCalls`; it is not made;
 * - `cap_time` — the deadline fired, at the top of a round, before a call, or
 *   while the provider was answering (its rejection then lands in the `catch`
 *   with the signal aborted); the completed calls' action lines are kept;
 * - `provider_error` — anything else that threw; the caller discards the turn.
 *
 * `F4.295`: a caller may pass `correctFinal`. When it returns a message for a
 * final text, the loop sends the model that text and the message and goes on,
 * **once a turn**, inside the same deadline and call cap; the record then
 * carries `corrected: true`. The first text is the reply only when the rounds
 * after the correction stop on a cap or a provider error: the turn then ends
 * `final` with that text, as it would have without the correction, and the
 * record names the stop in `correctionFailed`.
 *
 * **Never throws**: every failure is a stop reason.
 */

export const MAX_TOOL_CALLS_PER_TURN = 8;
export const TURN_DEADLINE_MS = 45_000;

export type AgentStopReason = "final" | "cap_calls" | "cap_time" | "provider_error";

/** Decision 9: ids, names and counts only — never message text, arguments, the draft or the summary. */
export type AgentTurnRecord = {
  readonly toolCalls: number;
  readonly tools: readonly string[];
  readonly stopReason: AgentStopReason;
  readonly durationMs: number;
  /** `F4.295`: present, and true, only on a turn whose first final text was sent back once by `correctFinal`. */
  readonly corrected?: true;
  /** `F4.295`: the stop that ended the rounds after a correction; the first text was then the reply. */
  readonly correctionFailed?: Exclude<AgentStopReason, "final">;
  /**
   * Code review #5: on `provider_error` only, the error's class name and HTTP
   * status, so a bad key and a bug in the loop are told apart. Never the message.
   */
  readonly errorClass?: string;
  readonly errorStatus?: number;
};

export type AgentLoopResult = {
  /** The model's final text, trimmed (`"Done."` when empty), on `final`; `""` on every other stop reason. */
  readonly reply: string;
  readonly stopReason: AgentStopReason;
  readonly record: AgentTurnRecord;
  /** The action lines of the calls that completed, in order. A caller discards them on `provider_error`. */
  readonly actionLines: readonly string[];
};

/** The class name and HTTP status of a failure, for the turn record; never its message. */
export function errorFacts(error: unknown): { errorClass?: string; errorStatus?: number } {
  if (typeof error !== "object" || error === null) {
    return { errorClass: typeof error };
  }
  const name = (error as { constructor?: { name?: unknown } }).constructor?.name;
  const status = (error as { status?: unknown }).status;
  return {
    ...(typeof name === "string" ? { errorClass: cutToBound(name, 64) } : {}),
    ...(typeof status === "number" ? { errorStatus: status } : {}),
  };
}

/** Runs one user turn. `messages` is the prompt (system, history, the user's message); the loop appends to it. */
export async function runAgentLoop(
  input: {
    readonly messages: LlmMessage[];
    readonly tools: {
      readonly definitions: readonly LlmToolDefinition[];
      readonly isToolName: (name: string) => boolean;
    };
    /** Must never throw; a throw is treated as a provider error. */
    readonly runTool: (call: LlmToolCall) => Promise<ToolOutcome>;
    readonly llm: LlmProvider;
    /** `F4.295`: a message to send back with a final text, or `null` to accept it. Called at most once a turn; must never throw. */
    readonly correctFinal?: (reply: string) => string | null;
  },
  options: { readonly maxToolCalls?: number; readonly deadlineMs?: number } = {},
): Promise<AgentLoopResult> {
  const maxToolCalls = options.maxToolCalls ?? MAX_TOOL_CALLS_PER_TURN;
  const deadlineMs = options.deadlineMs ?? TURN_DEADLINE_MS;
  const started = Date.now();
  const { messages } = input;
  const actionLines: string[] = [];
  const tools: string[] = [];
  let corrected = false;
  let firstText: string | null = null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deadlineMs);

  const finish = (stop: AgentStopReason, text: string, error?: unknown): AgentLoopResult => {
    // F4.295: a failed round after the correction falls back to the first text.
    const fallback = stop !== "final" && firstText !== null;
    const stopReason = fallback ? "final" : stop;
    const reply = fallback ? (firstText as string) : text;
    const record: AgentTurnRecord = {
      toolCalls: tools.length,
      tools,
      stopReason,
      durationMs: Date.now() - started,
      ...(corrected ? { corrected: true as const } : {}),
      ...(fallback ? { correctionFailed: stop as Exclude<AgentStopReason, "final"> } : {}),
      ...(error !== undefined ? errorFacts(error) : {}),
    };
    return { reply, stopReason, record, actionLines };
  };

  try {
    for (;;) {
      if (controller.signal.aborted) {
        return finish("cap_time", "");
      }
      const reply = await input.llm.complete({ messages, tools: input.tools.definitions, signal: controller.signal });
      if (reply.kind === "final") {
        const text = reply.text.trim() || "Done.";
        const correction = corrected ? null : (input.correctFinal?.(text) ?? null);
        if (correction === null) {
          return finish("final", text);
        }
        corrected = true;
        firstText = text;
        messages.push({ role: "assistant", content: text }, { role: "user", content: correction });
        continue;
      }
      messages.push({
        role: "assistant",
        content: reply.content,
        toolCalls: reply.calls,
        ...(reply.providerContent !== undefined ? { providerContent: reply.providerContent } : {}),
      });
      for (const call of reply.calls) {
        if (tools.length >= maxToolCalls) {
          return finish("cap_calls", "");
        }
        if (controller.signal.aborted) {
          return finish("cap_time", "");
        }
        // Security review L3: a name the model made up is logged as `unknown`.
        tools.push(input.tools.isToolName(call.name) ? call.name : "unknown");
        const outcome = await input.runTool(call);
        if (outcome.actionLine) {
          actionLines.push(outcome.actionLine);
        }
        messages.push({ role: "tool", toolCallId: call.id, content: outcome.content, isError: !outcome.ok });
      }
    }
  } catch (error) {
    return controller.signal.aborted ? finish("cap_time", "") : finish("provider_error", "", error);
  } finally {
    clearTimeout(timer);
  }
}
