import type { OnboardingDraft } from "@bms/shared";
import type { z } from "zod";

import { exceedsDepth } from "../stack-safe-json";
import { cutToBound, draftCountProblem } from "./onboarding-draft-caps";
import { mergeDraftPatch } from "./onboarding-draft-merge";
import { DRAFT_TOO_DEEP_MESSAGE, MAX_ONBOARDING_DRAFT_DEPTH, type OnboardingDraftInput } from "./onboarding.schema";

/**
 * The onboarding agent's tool outcomes (`F3.21`, `F3.22` ADR 0091 decision 3).
 *
 * Moved verbatim out of `onboarding-agent-tools.ts` so the template tools can
 * build outcomes without importing the registry that imports them.
 */

/** Decision 3: one tool result in the prompt is cut to this many characters. */
export const TOOL_RESULT_MAX_CHARS = 8_000;

/** The fixed tail of a cut tool result. */
export const TOOL_RESULT_CUT_TAIL = `…[cut to ${TOOL_RESULT_MAX_CHARS} characters]`;

/** Plan ruling 1: one list result names at most this many items. */
export const TOOL_LIST_MAX_ITEMS = 100;

/** The turn's working state; `runTool` replaces `working` only after a write passes every check. */
export type ToolState = {
  working: OnboardingDraft;
  pendingProposal?: { summary: string };
};

export type ToolOutcome = {
  readonly ok: boolean;
  /** The tool result as the model receives it: JSON, cut to `TOOL_RESULT_MAX_CHARS`. */
  readonly content: string;
  /** Set only by a successful write or a proposal. */
  readonly actionLine?: string;
};

/** A result as the model receives it: JSON, cut on a whole character with a fixed tail. */
export function toolResultContent(result: unknown): string {
  const text = JSON.stringify(result) ?? "null";
  return text.length <= TOOL_RESULT_MAX_CHARS ? text : `${cutToBound(text, TOOL_RESULT_MAX_CHARS)}${TOOL_RESULT_CUT_TAIL}`;
}

export function fail(error: string): ToolOutcome {
  return { ok: false, content: toolResultContent({ ok: false, error }) };
}

export function succeed(result: Record<string, unknown>, actionLine?: string): ToolOutcome {
  return { ok: true, content: toolResultContent({ ok: true, ...result }), ...(actionLine ? { actionLine } : {}) };
}

export function issuesOf(error: z.ZodError): string {
  return error.issues
    .slice(0, 10)
    .map((issue) => cutToBound(`${issue.path.join(".") || "(arguments)"}: ${issue.message}`, 200))
    .join("; ");
}

/**
 * Applies `patch` to the working draft only when the merged draft passes the
 * caps. A successful write drops any pending proposal: a proposal never outlives
 * an edit, even inside one turn.
 */
export function write(state: ToolState, patch: OnboardingDraftInput, actionLine: string, result: Record<string, unknown> = {}): ToolOutcome {
  const next = mergeDraftPatch(state.working, patch);
  const problem = draftCountProblem(next);
  if (problem !== null) {
    return fail(problem);
  }
  // Security review L6: the element schemas carry no depth bound, so the merged
  // draft is held to the one a `PATCH` body meets (F4.115).
  if (exceedsDepth(next, MAX_ONBOARDING_DRAFT_DEPTH)) {
    return fail(DRAFT_TOO_DEEP_MESSAGE);
  }
  state.working = next;
  state.pendingProposal = undefined;
  return succeed(result, actionLine);
}

export function removeAt<T>(items: readonly T[] | undefined, index: number): { rest: T[]; removed: T } | null {
  const list = items ?? [];
  if (index >= list.length) {
    return null;
  }
  return { rest: list.filter((_, i) => i !== index), removed: list[index] as T };
}
