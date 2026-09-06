import { z } from "zod";

import type { PointMetadataFields } from "@bms/shared";

import {
  hasAnyPointMetadata,
  pointMetadataBodyShape,
  refinePointMetadata,
  validateMergedPointMetadata,
} from "./point-metadata.schema";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** The five, all unset — the shape both sides of the merge always have. */
const NOTHING: PointMetadataFields = {
  scaleMultiplier: null,
  scaleOffset: null,
  engMin: null,
  engMax: null,
  qualityPolicy: null,
};

/**
 * A probe schema for {@link refinePointMetadata}, built exactly the way the two
 * real write bodies build theirs — the shape spread into an object literal, one
 * `.superRefine` site. Testing the refinement through a schema rather than by
 * calling it with a hand-made `ctx` is what makes these cases the same code path
 * `createAssetPointBodySchema` and `templatePointBodySchema` run.
 */
const probe = z.object({ ...pointMetadataBodyShape }).superRefine(refinePointMetadata);

function issuePaths(value: unknown): string[] {
  const result = probe.safeParse(value);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
}

/**
 * ADR 0056 decision 2 — the pair a row `CHECK` cannot see. An asset override of
 * `eng_min` beside an *inherited* `eng_max` inverts the resolved band while
 * each row stays valid on its own, so the refusal has to name the value the
 * author never typed and cannot see on their screen.
 */
export function assertOverrideEngMinBesideInheritedEngMaxIsRefused(): void {
  const problems = validateMergedPointMetadata(
    { ...NOTHING, engMin: 150 },
    { ...NOTHING, engMax: 100 },
  );
  assert(problems.length === 1, `expected exactly one problem, got ${problems.length}`);
  const [message] = problems as [string];
  assert(message.includes("150"), `the message must name the override's own bound: ${message}`);
  assert(message.includes("100"), `the message must name the inherited bound: ${message}`);
  assert(
    message.includes("eng_max 100 (inherited from the template)"),
    `the inherited side must be marked, and it is eng_max here: ${message}`,
  );
  assert(
    !message.includes("eng_min 150 (inherited"),
    `the side the request states must NOT be marked inherited: ${message}`,
  );
}

/** The mirror: an override of `eng_max` beside an inherited `eng_min`. */
export function assertOverrideEngMaxBesideInheritedEngMinIsRefused(): void {
  const problems = validateMergedPointMetadata(
    { ...NOTHING, engMax: 50 },
    { ...NOTHING, engMin: 60 },
  );
  assert(problems.length === 1, `expected exactly one problem, got ${problems.length}`);
  const [message] = problems as [string];
  assert(
    message.includes("eng_min 60 (inherited from the template)"),
    `the inherited side must be marked, and it is eng_min here: ${message}`,
  );
  assert(message.includes("eng_max 50"), `the message must name the stated bound: ${message}`);
}

/** Nothing set on either side is the overwhelmingly common row: no problem. */
export function assertAnEmptyMergeHasNoProblems(): void {
  const problems = validateMergedPointMetadata(NOTHING, NOTHING);
  assert(problems.length === 0, `an empty merge must be clean, got: ${problems.join(" ")}`);
}

/**
 * An override that restates **both** bounds replaces the template's pair
 * outright, so a template pair that looks inverted here is not consulted — and
 * cannot exist anyway, `template_points_eng_range_check` refuses it.
 */
export function assertAnOverrideOfBothBoundsIgnoresTheTemplatePair(): void {
  const problems = validateMergedPointMetadata(
    { ...NOTHING, engMin: 0, engMax: 10 },
    { ...NOTHING, engMin: 50, engMax: 40 },
  );
  assert(problems.length === 0, `a fully restated band must be clean, got: ${problems.join(" ")}`);
}

/** The within-row rules, through the shape both write bodies spread. */
export function assertTheWriteShapeRefusesAZeroMultiplier(): void {
  assert(
    issuePaths({ scaleMultiplier: 0 }).includes("scaleMultiplier"),
    "a scale multiplier of 0 must be refused at scaleMultiplier",
  );
  assert(
    issuePaths({ scaleMultiplier: -0.5 }).length === 0,
    "a negative multiplier is legitimate (an inverted transducer) and must be accepted",
  );
  assert(
    issuePaths({ scaleMultiplier: null, scaleOffset: null }).length === 0,
    "null is 'inherit' on every one of the five and must never be refused",
  );
}

export function assertTheWriteShapeRefusesAnInvertedOrEmptyBand(): void {
  assert(
    issuePaths({ engMin: 5, engMax: 5 }).includes("engMin"),
    "an empty band (min === max) admits no reading at all and must be refused at engMin",
  );
  assert(
    issuePaths({ engMin: 100, engMax: 0 }).includes("engMin"),
    "an inverted band must be refused at engMin",
  );
  assert(
    issuePaths({ engMin: 0, engMax: 100 }).length === 0,
    "a well-ordered band must be accepted",
  );
  assert(
    issuePaths({ engMin: 100 }).length === 0,
    "one bound alone is legitimate — the other may be inherited or absent",
  );
}

export function assertTheWriteShapeRefusesNonFiniteNumbers(): void {
  assert(
    issuePaths({ scaleOffset: Number.NaN }).includes("scaleOffset"),
    "NaN must be refused by .finite() — double precision would store it",
  );
  assert(
    issuePaths({ engMax: Number.POSITIVE_INFINITY }).includes("engMax"),
    "Infinity must be refused by .finite()",
  );
  assert(
    issuePaths({ qualityPolicy: "clamp" }).includes("qualityPolicy"),
    "the quality policy vocabulary is closed to QUALITY_POLICIES",
  );
}

/**
 * `hasAnyPointMetadata` answers "does this request *set* any of the five", and
 * an explicit `null` is not setting one — it is clearing it back to inherit.
 *
 * The distinction is load-bearing twice over: the Points tab sends all five on
 * every row (a `measured → derived` flip clears them to `null`), and
 * `createDraftFrom` copies a parent row through the same insert mapper. Reading
 * `null` as "carries metadata" would 400 both.
 */
export function assertHasAnyPointMetadataReadsNullAsAbsent(): void {
  assert(hasAnyPointMetadata({}) === false, "an empty body sets nothing");
  assert(
    hasAnyPointMetadata({
      scaleMultiplier: null,
      scaleOffset: null,
      engMin: null,
      engMax: null,
      qualityPolicy: null,
    }) === false,
    "five explicit nulls clear the override; they do not set metadata",
  );
  assert(hasAnyPointMetadata({ engMax: 100 }) === true, "one bound is metadata");
  assert(
    hasAnyPointMetadata({ qualityPolicy: "accept_bad" }) === true,
    "the policy is one of the five",
  );
  assert(hasAnyPointMetadata({ scaleMultiplier: 0 }) === true, "0 is a value, not an absence");
}
