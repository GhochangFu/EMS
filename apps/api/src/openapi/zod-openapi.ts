import type { ZodTypeAny } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

/**
 * `F4.20` / ADR 0029 — converting a Zod schema to the OpenAPI schema object.
 *
 * The whole point of ADR 0029 decision 1 is that the schemas which *validate*
 * the request are the only description of it, so this reads them rather than
 * asking anyone to restate them. What this file adds on top of
 * `zod-to-json-schema` is **Amendment 1**: making the places where that
 * conversion is lossy visible instead of silent.
 *
 * ## Why a marker is needed at all
 *
 * `zod-to-json-schema` emits **nothing** for `.refine` / `.superRefine` — no
 * marker, no warning, no error. Measured across this repo's 19 schema files:
 * 63 schemas convert with zero failures, and **11 refinement sites vanish**.
 * The consequence was demonstrated rather than assumed (Amendment 1 fact C):
 * `telemetryReadingSchema.time` is `z.string().refine(parsable timestamp)`, and
 * the payload `{"time":"not-a-timestamp"}` is **rejected by Zod** and
 * **accepted by the generated schema**, which describes that field as exactly
 * `{"type":"string"}`.
 *
 * So without this file the document would be strictly *more permissive* than
 * the API at those 11 sites, and a caller who trusted it would receive a `400`
 * the document says is impossible.
 *
 * ## Why the prose is authored rather than extracted
 *
 * The obvious fix — copy the refinement's own message into `description` — is
 * **impossible**, and that is measured, not assumed (Amendment 1 fact E).
 * `.refine(fn, { message })` produces a `ZodEffects` whose `_def.effect` is
 * `{ type: "refinement", refinement: fn }`; the message is captured inside the
 * closure, `_def.message` is `null`, and there is no `errorMap`. Recovering the
 * text means *running* the refinement against a value that fails it, which
 * requires already knowing a failing value.
 *
 * So the marker is automatic and the explanation is authored with
 * `.describe()`. {@link convertZodSchema} reports every refinement that has no
 * explanation; ADR 0029 decision 10 is what makes reporting them fatal.
 *
 * **`.describe()` must come after the refinement.** `z.string().describe("x")
 * .refine(…)` yields no description at all, because `.refine` wraps the
 * described schema in a *new* `ZodEffects` — the description ends up on the
 * inner node, which no longer describes the field. Only
 * `z.string().refine(…).describe("x")` survives. Nothing warns about this, so
 * it is measured in Amendment 1 fact F and guarded statically.
 */

/**
 * Vendor extension marking a schema whose validation is **not fully expressed**
 * by the surrounding JSON Schema. `x-` prefixed, so conforming tooling ignores
 * it rather than rejecting the document.
 */
export const REFINED_MARKER = "x-zod-refined";

/** A refinement that reached the document with nothing said about it. */
export interface UnexplainedRefinement {
  /** Schema this was found in, as registered. */
  readonly schema: string;
  /** JSON-pointer-ish path to the node, e.g. `properties/time`. */
  readonly path: string;
}

export interface ConversionResult {
  readonly schema: Record<string, unknown>;
  /**
   * Every refinement node carrying no `.describe()`. Empty is the only
   * acceptable state; the caller decides how loudly to say so.
   */
  readonly unexplained: UnexplainedRefinement[];
}

type RefinementDef = {
  typeName?: string;
  effect?: { type?: string };
  description?: string;
};

/** Converts one Zod schema, marking every node whose validation it cannot express. */
export function convertZodSchema(schema: ZodTypeAny, name: string): ConversionResult {
  const unexplained: UnexplainedRefinement[] = [];

  const converted = zodToJsonSchema(schema, {
    target: "openApi3",
    // Request bodies and query strings are described by what a caller SENDS.
    // `.transform` and `.pipe` change the type between input and output, and
    // documenting the output would tell a caller to send the parsed form.
    pipeStrategy: "input",
    effectStrategy: "input",
    $refStrategy: "none",
    postProcess: (jsonSchema, def, refs) => {
      const refined = def as RefinementDef;
      if (refined.typeName !== "ZodEffects" || refined.effect?.type !== "refinement") {
        return jsonSchema;
      }
      if (!refined.description) {
        unexplained.push({ schema: name, path: refs.currentPath.join("/") || "(root)" });
      }
      return { ...(jsonSchema ?? {}), [REFINED_MARKER]: true };
    },
  });

  return { schema: converted as Record<string, unknown>, unexplained };
}

/**
 * The sentence the document carries about itself (ADR 0029 decision 9c).
 *
 * A reader who does not know that this document is a **lower bound** will read
 * an absent constraint as an absent rule. Saying it once, at the top, is the
 * difference between a document that is incomplete and one that is misleading.
 */
export const LOWER_BOUND_NOTICE =
  "This document is a LOWER BOUND on validation. Fields marked `" +
  REFINED_MARKER +
  "` carry constraints that JSON Schema cannot express — their `description` " +
  "states the rule in prose. A payload valid against this document may still be " +
  "refused with 400.";
