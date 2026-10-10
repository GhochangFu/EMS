import type { z } from "zod";

import { cutToBound } from "../common/text-bounds";

/**
 * Tool outcomes as any agent loop returns them to the model (`F3.85`, ADR 0099;
 * first written for onboarding, `F3.21`/`F3.22` ADR 0091 decision 3).
 *
 * Moved verbatim out of `admin/onboarding/onboarding-tool-outcome.ts`, which
 * re-exports every name here; the onboarding-only helpers (`ToolState`,
 * `write`, `removeAt`, the reply bounds) stay there.
 */

/** Decision 3: one tool result in the prompt is cut to this many characters. */
export const TOOL_RESULT_MAX_CHARS = 8_000;

/** The fixed tail of a cut tool result. */
export const TOOL_RESULT_CUT_TAIL = `…[cut to ${TOOL_RESULT_MAX_CHARS} characters]`;

/** Plan ruling 1: one list result names at most this many items. */
export const TOOL_LIST_MAX_ITEMS = 100;

export type ToolOutcome = {
  readonly ok: boolean;
  /** The tool result as the model receives it: JSON, cut to `TOOL_RESULT_MAX_CHARS`. */
  readonly content: string;
  /** Set only by a successful write or a proposal. */
  readonly actionLine?: string;
  /**
   * Set only by `fail`: the refusal's sentence, the same text `content` carries.
   * F3.27 (ADR 0090 Amendment 2 B4): the guided mode answers it to the user, so
   * no caller parses `content` back.
   */
  readonly error?: string;
};

/** A result as the model receives it: JSON, cut on a whole character with a fixed tail. */
export function toolResultContent(result: unknown): string {
  const text = JSON.stringify(result) ?? "null";
  return text.length <= TOOL_RESULT_MAX_CHARS ? text : `${cutToBound(text, TOOL_RESULT_MAX_CHARS)}${TOOL_RESULT_CUT_TAIL}`;
}

export function fail(error: string): ToolOutcome {
  return { ok: false, content: toolResultContent({ ok: false, error }), error };
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
