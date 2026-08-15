import { expect } from "vitest";
import { z } from "zod";

import { convertZodSchema, LOWER_BOUND_NOTICE, REFINED_MARKER } from "./zod-openapi";

/**
 * `F4.20` / ADR 0029 Amendment 1 — assertions for the lossy-conversion marker.
 *
 * Assertions only (§4.6); `zod-openapi.test.ts` owns the runner.
 *
 * **The case that matters is the third one.** The first two prove the marker
 * appears and the reporting works, which is what an author would write. The
 * third proves the marker is *load-bearing* — that the underlying converter
 * really does drop the constraint, so the document really is more permissive
 * than the validator without it. Without that case, a future change that made
 * `zod-to-json-schema` express refinements natively would leave these tests
 * green while the marker became a lie.
 */
export function testMarksRefinedFields(): void {
  const schema = z.object({
    time: z
      .string()
      .refine((v) => !Number.isNaN(Date.parse(v)))
      .describe("must be a parsable timestamp"),
    plain: z.string(),
  });

  const { schema: json, unexplained } = convertZodSchema(schema, "probe");
  const properties = json.properties as Record<string, Record<string, unknown>>;

  expect(unexplained, "a described refinement is explained, so nothing is reported").toEqual([]);
  expect(properties.time?.[REFINED_MARKER], "the refined field is marked").toBe(true);
  expect(properties.time?.description).toBe("must be a parsable timestamp");
  expect(
    properties.plain?.[REFINED_MARKER],
    "an unrefined field must NOT be marked — a marker on everything says nothing",
  ).toBeUndefined();
}

export function testReportsUnexplainedRefinements(): void {
  const schema = z.object({
    bare: z.string().refine(() => true),
  });

  const { schema: json, unexplained } = convertZodSchema(schema, "probe");
  const properties = json.properties as Record<string, Record<string, unknown>>;

  // Marked, because the marker is derived from the schema and cannot be
  // forgotten — but reported, because nothing explains it.
  expect(properties.bare?.[REFINED_MARKER]).toBe(true);
  expect(unexplained).toHaveLength(1);
  expect(unexplained[0]?.schema).toBe("probe");
  expect(
    unexplained[0]?.path,
    "the report names the field, or an author cannot act on it",
  ).toContain("bare");
}

/**
 * **The marker is only worth having while this is true.** Proves the gap the
 * marker exists to declare: the generated schema accepts a payload the Zod
 * schema rejects.
 *
 * Deliberately does not use a JSON Schema validator — asserting that the
 * generated node carries *no* constraint beyond `type` is the same fact and
 * needs no extra dependency (ADR 0029 approves two packages, not three).
 */
export function testTheGapIsRealNotHypothetical(): void {
  const refined = z
    .string()
    .refine((v) => !Number.isNaN(Date.parse(v)), { message: "must be a parsable timestamp" })
    .describe("must be a parsable timestamp");

  expect(
    refined.safeParse("not-a-timestamp").success,
    "the validator rejects it — this is the premise",
  ).toBe(false);

  const { schema: json } = convertZodSchema(z.object({ time: refined }), "probe");
  const time = (json.properties as Record<string, Record<string, unknown>>).time as Record<
    string,
    unknown
  >;

  // Everything the generated schema says about `time`, minus what we added.
  const constraints = Object.keys(time).filter(
    (k) => k !== "description" && k !== REFINED_MARKER && k !== "type",
  );
  expect(
    constraints,
    "the converter expresses NOTHING of the refinement — if this ever becomes " +
      "non-empty, zod-to-json-schema has learned to encode refinements and " +
      "ADR 0029 Amendment 1 should be revisited rather than this test relaxed",
  ).toEqual([]);
  expect(time.type).toBe("string");
}

/** Input, not output — a caller is told what to SEND (decision 9, `pipeStrategy`). */
export function testDocumentsTheInputSideOfATransform(): void {
  const schema = z.object({
    n: z.string().transform((v) => Number(v)),
  });
  const { schema: json } = convertZodSchema(schema, "probe");
  const n = (json.properties as Record<string, Record<string, unknown>>).n as Record<
    string,
    unknown
  >;
  expect(
    n.type,
    "a transform's INPUT is what the caller sends; documenting the output would " +
      "tell them to send the already-parsed form",
  ).toBe("string");
}

export function testLowerBoundNoticeNamesTheMarker(): void {
  // The notice is the only place a reader learns what the marker means, so it
  // has to actually contain it. A notice that drifts from the marker name is
  // worse than none.
  expect(LOWER_BOUND_NOTICE).toContain(REFINED_MARKER);
  expect(LOWER_BOUND_NOTICE).toMatch(/lower bound/i);
}
