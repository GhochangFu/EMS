import type { OnboardingDraft } from "@bms/shared";

import {
  fail,
  issuesOf,
  succeed,
  toolResultContent,
  TOOL_LIST_MAX_ITEMS,
  TOOL_RESULT_CUT_TAIL,
  TOOL_RESULT_MAX_CHARS,
  type ToolOutcome,
} from "../../llm/tool-result";
import { exceedsDepth } from "../stack-safe-json";
import { draftCountProblem } from "./onboarding-draft-caps";
import { mergeDraftPatch } from "./onboarding-draft-merge";
import { DRAFT_TOO_DEEP_MESSAGE, MAX_ONBOARDING_DRAFT_DEPTH, type OnboardingDraftInput } from "./onboarding.schema";

/**
 * The onboarding agent's tool outcomes (`F3.21`, `F3.22` ADR 0091 decision 3).
 *
 * Moved verbatim out of `onboarding-agent-tools.ts` so the template tools can
 * build outcomes without importing the registry that imports them.
 *
 * `F3.85` (ADR 0099) moved the generic half — the result bounds, `ToolOutcome`,
 * `toolResultContent`, `fail`, `succeed` and `issuesOf` — to
 * `llm/tool-result.ts`; they are re-exported here so every onboarding importer
 * stays unchanged.
 */
export { fail, issuesOf, succeed, toolResultContent, TOOL_LIST_MAX_ITEMS, TOOL_RESULT_CUT_TAIL, TOOL_RESULT_MAX_CHARS };
export type { ToolOutcome };

/**
 * F3.25 (ADR 0094 decision 9): the bounds of a `suggest_replies` call. Declared
 * here, beside the other tool bounds, so the registry reads them without
 * importing `onboarding-suggested-replies.ts` (which imports the guided mode,
 * which imports the registry). That module re-exports them.
 */
export const MAX_MODEL_REPLIES = 4;
/** The longest reply a chip may carry. A longer one is dropped, never cut: a cut chip would send a cut message. */
export const MAX_SUGGESTED_REPLY_CHARS = 40;

/** The turn's working state; `runTool` replaces `working` only after a write passes every check. */
export type ToolState = {
  working: OnboardingDraft;
  pendingProposal?: { summary: string };
  /** F3.25 (ADR 0094 decision 9): the replies the last `suggest_replies` call offered; code filters them. */
  suggestedReplies?: string[];
};

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
