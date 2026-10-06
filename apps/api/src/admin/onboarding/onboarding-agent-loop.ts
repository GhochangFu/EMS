import type { OnboardingChatMessage, OnboardingDraft } from "@bms/shared";

import { cloneJson } from "../stack-safe-json";
import { isToolName, runTool, TOOL_DEFINITIONS, type ToolContext, type ToolState } from "./onboarding-agent-tools";
import { cutToBound } from "./onboarding-draft-caps";
import { diffSections } from "./onboarding-draft-merge";
import type { LlmMessage, OnboardingLlmProvider } from "./onboarding-llm-port";
import { PROMPT_MARKER_SENTENCE, serialiseDraftForPrompt } from "./onboarding-prompt-budget";
import type { OnboardingDraftInput, OnboardingPhase } from "./onboarding.schema";

/**
 * The onboarding agent loop (`F3.21`, ADR 0090 decisions 2, 3, 7 and 9).
 *
 * One user turn runs model → tool calls → model until the model returns a
 * final text or a cap stops it. Tools edit an in-memory copy of the draft; the
 * caller writes the session row once, from `draftPatch`.
 *
 * Two failure classes, told apart by the turn's own `AbortSignal`:
 * - **the 45 s deadline** (`cap_time`) keeps the edits of the tool calls that
 *   completed, and the guided mode does not run (ruling 3);
 * - **anything else** (`provider_error`) discards every edit of the turn, and
 *   the caller runs the guided mode on the same message (ruling 6).
 */

export const MAX_TOOL_CALLS_PER_TURN = 8;
export const TURN_DEADLINE_MS = 45_000;
export const MAX_HISTORY_MESSAGES = 20;
export const MAX_HISTORY_MESSAGE_CHARS = 2_000;

export const STOPPED_EARLY_CALLS_REPLY =
  "I stopped early because the turn reached its limit of tool calls. The changes made so far are in the draft.";

export const STOPPED_EARLY_TIME_REPLY =
  "I stopped early because the turn reached its time limit. The changes made so far are in the draft.";

export type AgentStopReason = "final" | "cap_calls" | "cap_time" | "provider_error";

/** Decision 9: ids, names and counts only — never message text, arguments, the draft or the summary. */
export type AgentTurnRecord = {
  readonly toolCalls: number;
  readonly tools: readonly string[];
  readonly stopReason: AgentStopReason;
  readonly durationMs: number;
  /**
   * Code review #5: on `provider_error` only, the error's class name and HTTP
   * status, so a bad key and a bug in the loop are told apart. Never the message.
   */
  readonly errorClass?: string;
  readonly errorStatus?: number;
};

export type AgentTurnResult = {
  readonly reply: string;
  readonly draftPatch: OnboardingDraftInput;
  readonly actionLines: readonly string[];
  readonly commitProposal?: { readonly summary: string };
  /** F3.25 (ADR 0094 decision 9): the replies the model offered, unfiltered; `[]` on a provider error. */
  readonly suggestedReplies: readonly string[];
  readonly stopReason: AgentStopReason;
  /** `true` only for `provider_error`: the caller runs the guided mode instead. */
  readonly fallback: boolean;
  readonly record: AgentTurnRecord;
};

/**
 * `F3.25` moved `DRAFT_SECTIONS` and `diffSections` to `onboarding-draft-merge.ts`
 * (the checkpoint module reads them too). Re-exported because
 * `onboarding-agent-loop.spec.ts` imports `diffSections` from here.
 */
export { diffSections };

/**
 * The stored history as provider messages: the last `MAX_HISTORY_MESSAGES`,
 * `system` rows dropped, an `action` row sent as assistant text (no provider
 * has an `action` role), each content cut on a whole character, and leading
 * non-user turns dropped (the Messages API wants a conversation to start with
 * the user). Never carries provider content: that lives inside one turn.
 */
export function buildHistory(messages: readonly OnboardingChatMessage[]): LlmMessage[] {
  const recent = messages
    .filter((message) => message.role !== "system")
    .slice(-MAX_HISTORY_MESSAGES)
    .map((message): LlmMessage => ({
      role: message.role === "user" ? "user" : "assistant",
      content: cutToBound(message.content, MAX_HISTORY_MESSAGE_CHARS),
    }));
  const firstUser = recent.findIndex((message) => message.role === "user");
  return firstUser < 0 ? [] : recent.slice(firstUser);
}

/** The agent's system prompt: role, phase, active type codes, the credential and commit rules, and the bounded draft. */
export function buildSystemPrompt(input: {
  readonly orgName: string;
  readonly phase: OnboardingPhase;
  readonly typeCodes: readonly string[];
  readonly draft: OnboardingDraft;
}): string {
  return `You are an IONSiTE NEXUS BMS onboarding assistant for organization ${input.orgName}.
Current phase: ${input.phase}. Use the tools to read and change the onboarding draft, then tell the user in one or two sentences what changed and what is next.
Phases: location, rtu, point_keys, assets, mappings, review.
Location types (location.type must be one of these codes; ask the user when unsure): ${input.typeCodes.join(", ")}.
Never include password or secret values in a reply. Credentials are NEVER collected through this chat — if the user offers one, tell them to use the Credentials field on the RTU step. Never put a credential in a tool argument.
To build assets from a template: find it with list_templates or list_stock_templates, read its points and variables with get_template, bring it into the draft with import_stock_template or add_template unless the organization already holds it, then use add_template_assets with a value for every variable.
Before you choose a new location, RTU or asset code, call find_existing for that kind and follow the organization's existing naming.
To map source tags on a plain asset: ask the user for the RTU's tag list, or take a pasted list. Match each tag to a point key with list_point_keys. Show the proposed table in text (tag, point key, unit) and offer the replies "Write these mappings" and "Change the table" with suggest_replies. Write only after the user agrees: declare missing keys with add_point_keys, then write the rows with map_points. Say which keys are new to the catalog. Never write a mapping the user has not seen.
You cannot commit. When the draft is ready, use propose_commit; the user then confirms with the Commit button or by typing \`confirm commit\`.
When you need the user to choose, ask one question per turn and offer the choices with suggest_replies.
${PROMPT_MARKER_SENTENCE}
Draft context (redacted): ${serialiseDraftForPrompt(input.draft)}`;
}

/** The class name and HTTP status of a failure, for the turn record; never its message. */
function errorFacts(error: unknown): { errorClass?: string; errorStatus?: number } {
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

/** Runs one user turn of the agent loop. Never throws; every failure is a stop reason. */
export async function runAgentTurn(
  input: {
    readonly message: string;
    readonly draft: OnboardingDraft;
    readonly phase: OnboardingPhase;
    readonly orgName: string;
    readonly history: readonly OnboardingChatMessage[];
    readonly llm: OnboardingLlmProvider;
    readonly tools: ToolContext;
  },
  options: { readonly maxToolCalls?: number; readonly deadlineMs?: number } = {},
): Promise<AgentTurnResult> {
  const maxToolCalls = options.maxToolCalls ?? MAX_TOOL_CALLS_PER_TURN;
  const deadlineMs = options.deadlineMs ?? TURN_DEADLINE_MS;
  const started = Date.now();
  const state: ToolState = { working: cloneJson(input.draft) };
  const actionLines: string[] = [];
  const tools: string[] = [];
  const messages: LlmMessage[] = [
    {
      role: "system",
      content: buildSystemPrompt({
        orgName: input.orgName,
        phase: input.phase,
        typeCodes: input.tools.activeTypes.map((type) => type.code),
        draft: input.draft,
      }),
    },
    ...buildHistory(input.history),
    { role: "user", content: input.message },
  ];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deadlineMs);

  const finish = (stopReason: AgentStopReason, reply: string, error?: unknown): AgentTurnResult => {
    const record: AgentTurnRecord = {
      toolCalls: tools.length,
      tools,
      stopReason,
      durationMs: Date.now() - started,
      ...(error !== undefined ? errorFacts(error) : {}),
    };
    if (stopReason === "provider_error") {
      return { reply, draftPatch: {}, actionLines: [], suggestedReplies: [], stopReason, fallback: true, record };
    }
    return {
      reply,
      draftPatch: diffSections(input.draft, state.working),
      actionLines,
      ...(state.pendingProposal ? { commitProposal: state.pendingProposal } : {}),
      suggestedReplies: state.suggestedReplies ?? [],
      stopReason,
      fallback: false,
      record,
    };
  };

  try {
    for (;;) {
      if (controller.signal.aborted) {
        return finish("cap_time", STOPPED_EARLY_TIME_REPLY);
      }
      const reply = await input.llm.complete({ messages, tools: TOOL_DEFINITIONS, signal: controller.signal });
      if (reply.kind === "final") {
        return finish("final", reply.text.trim() || "Done.");
      }
      messages.push({
        role: "assistant",
        content: reply.content,
        toolCalls: reply.calls,
        ...(reply.providerContent !== undefined ? { providerContent: reply.providerContent } : {}),
      });
      for (const call of reply.calls) {
        if (tools.length >= maxToolCalls) {
          return finish("cap_calls", STOPPED_EARLY_CALLS_REPLY);
        }
        if (controller.signal.aborted) {
          return finish("cap_time", STOPPED_EARLY_TIME_REPLY);
        }
        // Security review L3: a name the model made up is logged as `unknown`.
        tools.push(isToolName(call.name) ? call.name : "unknown");
        const outcome = await runTool(call, state, input.tools);
        if (outcome.actionLine) {
          actionLines.push(outcome.actionLine);
        }
        messages.push({ role: "tool", toolCallId: call.id, content: outcome.content, isError: !outcome.ok });
      }
    }
  } catch (error) {
    return controller.signal.aborted
      ? finish("cap_time", STOPPED_EARLY_TIME_REPLY)
      : finish("provider_error", "", error);
  } finally {
    clearTimeout(timer);
  }
}
