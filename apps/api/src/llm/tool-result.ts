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
  /**
   * Set by a successful write or a proposal; on the onboarding agent path also
   * by a refused draft write (`F4.135`, ADR 0090 Amendment 4).
   */
  readonly actionLine?: string;
  /**
   * Set only by a schema refusal in `runToolCall` (`F4.135`): the issue paths,
   * each segment an array index or a key the tool's schema declares — never a value.
   */
  readonly refusedFields?: readonly string[];
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

/** A refused field is named by at most this many paths (`F4.135`). */
export const MAX_REFUSED_FIELDS = 10;

type ZodDef = {
  readonly typeName?: string;
  readonly innerType?: z.ZodTypeAny;
  readonly schema?: z.ZodTypeAny;
  readonly in?: z.ZodTypeAny;
  readonly type?: z.ZodTypeAny;
  readonly valueType?: z.ZodTypeAny;
};

/** The schema under the wrappers that do not change a path: optional, nullable, default, effects, pipeline. */
function unwrapped(schema: z.ZodTypeAny | undefined): z.ZodTypeAny | undefined {
  let current = schema;
  for (let i = 0; i < 16 && current; i += 1) {
    const def = current._def as ZodDef;
    const next =
      def.typeName === "ZodOptional" || def.typeName === "ZodNullable" || def.typeName === "ZodDefault"
        ? def.innerType
        : def.typeName === "ZodEffects"
          ? def.schema
          : def.typeName === "ZodPipeline"
            ? def.in
            : undefined;
    if (!next) return current;
    current = next;
  }
  return current;
}

/**
 * One issue path, walked down `schema`: a key the object schema declares and
 * an array index are shown; anything else — a record key, a key under a union
 * — is `*`, and so is every segment after it.
 */
function declaredPath(path: readonly (string | number)[], schema: z.ZodTypeAny): string {
  let node: z.ZodTypeAny | undefined = schema;
  return path
    .map((segment) => {
      const current = unwrapped(node);
      const def = current?._def as ZodDef | undefined;
      if (def?.typeName === "ZodObject" && typeof segment === "string") {
        const shape = (current as z.AnyZodObject).shape as Record<string, z.ZodTypeAny>;
        if (Object.prototype.hasOwnProperty.call(shape, segment)) {
          node = shape[segment];
          return segment;
        }
      } else if (def?.typeName === "ZodArray" && typeof segment === "number") {
        node = def.type;
        return String(segment);
      } else if (def?.typeName === "ZodRecord") {
        node = def.valueType;
        return "*";
      }
      node = undefined;
      return "*";
    })
    .join(".");
}

/**
 * `F4.135`: the distinct issue paths of a schema failure, in order. Each path
 * is walked down the tool's own schema, so only a declared field name or an
 * array index is shown; a record key — chosen by the model — is `*`, and a
 * path carries no argument value.
 */
export function refusedFieldsOf(error: z.ZodError, schema: z.ZodTypeAny): string[] {
  const paths = error.issues.map((issue) => (issue.path.length === 0 ? "(arguments)" : declaredPath(issue.path, schema)));
  return [...new Set(paths)].slice(0, MAX_REFUSED_FIELDS);
}

export function issuesOf(error: z.ZodError): string {
  return error.issues
    .slice(0, 10)
    .map((issue) => cutToBound(`${issue.path.join(".") || "(arguments)"}: ${issue.message}`, 200))
    .join("; ");
}
