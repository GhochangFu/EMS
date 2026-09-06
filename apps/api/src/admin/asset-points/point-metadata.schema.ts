import { POINT_METADATA_FIELDS, qualityPolicySchema } from "@bms/shared";
import type { PointMetadataFields, QualityPolicy } from "@bms/shared";
import { z } from "zod";

/**
 * `F2.7` / ADR 0056 decisions 2 and 3 — the **write** side of the five point
 * metadata fields, shared by every body that authors them: the template point
 * (`asset-templates.schema.ts`), the single asset point
 * (`asset-points.schema.ts`), and later the bulk editor and the mapping sheet.
 *
 * Three rules, in two places, and the split is the ADR's:
 *
 * - `scale_multiplier <> 0`, `eng_min < eng_max` and the closed policy
 *   vocabulary are **within-row** invariants. They are migration `0063`'s
 *   CHECKs *and* {@link refinePointMetadata} here, so a caller gets a 400 that
 *   names the field instead of a 500 carrying a constraint name.
 * - The **merged pair** — an asset override of one bound beside the template's
 *   inherited other — is invisible to any row CHECK, because the two values
 *   live on two rows. That is {@link validateMergedPointMetadata}, and its
 *   message names the inherited value: "eng_min must be below eng_max" is not
 *   actionable to an author who never typed an eng_max and cannot see the one
 *   they collide with. Same argument, same shape, as
 *   `validateMergedCalcOverride` in `asset-point-calc-override.schema.ts`.
 *
 * Pure, and separate from the services, so every combination is enumerable in a
 * unit test with no database (`point-metadata.schema.spec.ts`).
 *
 * The read side is `packages/shared/src/contracts/point-metadata.ts`, which
 * deliberately carries **no** bounds: a read schema that rejects a row the
 * database holds lies about the estate.
 */

/**
 * The five as a write-side **shape**, spread into a body's `z.object({...})`
 * literal — never `.merge()` or `.extend()`, matching how the read-side DTOs
 * take `pointMetadataShape`.
 *
 * `.nullish()` on every field, and the two spellings mean different things to
 * the services: `undefined` (absent) leaves the stored value alone, `null`
 * clears it back to "inherit the template". `.finite()` because the columns are
 * `double precision` and would happily store `Infinity`, which no scaling
 * arithmetic recovers from.
 */
export const pointMetadataBodyShape = {
  /** engineering value = raw × multiplier + offset; `null` inherits, then reads as `1`. */
  scaleMultiplier: z.number().finite().nullish(),
  /** `null` inherits, then reads as `0`. */
  scaleOffset: z.number().finite().nullish(),
  /** Lower bound of the plausible engineering value, inclusive. */
  engMin: z.number().finite().nullish(),
  /** Upper bound, inclusive. */
  engMax: z.number().finite().nullish(),
  /** `discard_bad` (today's rule) or `accept_bad`; `null` inherits. */
  qualityPolicy: qualityPolicySchema.nullish(),
};

/**
 * The five as a body carries them — every field optional, and `null` distinct
 * from absent. Structural rather than `z.infer` of one schema, so the one
 * refinement below can serve every body that spreads the shape, whatever else
 * that body holds.
 */
export type PointMetadataBody = {
  readonly scaleMultiplier?: number | null;
  readonly scaleOffset?: number | null;
  readonly engMin?: number | null;
  readonly engMax?: number | null;
  readonly qualityPolicy?: QualityPolicy | null;
};

/**
 * The within-row rules, as a reusable `superRefine` body.
 *
 * Passed **by reference** to `.superRefine(refinePointMetadata)` so each schema
 * keeps exactly one refinement site with exactly one `.describe()` after it
 * (ADR 0029 Amendment 1); a second `.superRefine` on the same object would put
 * the description on the inner node, where `zod-to-json-schema` never looks.
 *
 * Only the two numeric rules are here. The vocabulary is `qualityPolicySchema`'s
 * own job, and the merged pair is not a property of this object at all.
 */
export function refinePointMetadata(point: PointMetadataBody, ctx: z.RefinementCtx): void {
  if (point.scaleMultiplier === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["scaleMultiplier"],
      message:
        "A scaleMultiplier of 0 would store 0 for every reading this point ever takes. " +
        "Leave it unset to inherit the template default (which reads as 1), or set a " +
        "non-zero factor.",
    });
  }

  // `!= null` on both, deliberately: one bound alone is a legitimate half-band,
  // and the *inherited* other half is checked against the template row by
  // `validateMergedPointMetadata`, which is the only place that can see it.
  if (point.engMin != null && point.engMax != null && point.engMin >= point.engMax) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["engMin"],
      message:
        `The engineering range is empty: engMin ${point.engMin} is not below engMax ` +
        `${point.engMax}. The band is the span of plausible engineering values, and a ` +
        "reading outside it is discarded by the ingest host.",
    });
  }
}

/**
 * Does this request **set** any of the five?
 *
 * An explicit `null` reads as **absent**, and that is the load-bearing half.
 * `null` means "clear this override / inherit the template", which every
 * round-trip surface sends: the Points tab posts all five on every row and a
 * `measured → derived` flip clears them to `null`, and `createDraftFrom` copies
 * a parent version's row through the same insert mapper. Counting `null` as
 * metadata would make both of those 400 against the "a derived point carries no
 * instrument metadata" rule they are not breaking.
 */
export function hasAnyPointMetadata(point: PointMetadataBody): boolean {
  return POINT_METADATA_FIELDS.some((field) => point[field] != null);
}

/**
 * Validates the **merged** result of an asset override and its template
 * default, not the override in isolation (ADR 0056 decision 2's last
 * paragraph).
 *
 * The pair a row `CHECK` cannot see: `asset_points.eng_min = 150` is a valid
 * row, `template_points.eng_max = 100` is a valid row, and the value the ingest
 * host resolves — `coalesce(asset, template)` per column — is a band that admits
 * no reading at all. Stored, that is a point which silently stops recording.
 *
 * The message names **both** bounds and marks the inherited one, because the
 * author of the override never typed it and cannot see it on the screen they
 * are looking at. Same reason, same wording shape, as
 * `validateMergedCalcOverride`'s "(inherited from the template)".
 *
 * @param override the asset's own five, after this request is applied; `null`
 *   per field means "inherit"
 * @param template the pinned version's five for the same point key — all `null`
 *   for an asset with no template, which merges to the override itself
 * @returns the problems; empty means the merged pair is usable
 */
export function validateMergedPointMetadata(
  override: PointMetadataFields,
  template: PointMetadataFields,
): string[] {
  const merged: PointMetadataFields = {
    scaleMultiplier: override.scaleMultiplier ?? template.scaleMultiplier,
    scaleOffset: override.scaleOffset ?? template.scaleOffset,
    engMin: override.engMin ?? template.engMin,
    engMax: override.engMax ?? template.engMax,
    qualityPolicy: override.qualityPolicy ?? template.qualityPolicy,
  };
  const inherited = (field: keyof PointMetadataFields): string =>
    override[field] === null ? " (inherited from the template)" : "";

  const problems: string[] = [];

  if (merged.engMin !== null && merged.engMax !== null && merged.engMin >= merged.engMax) {
    problems.push(
      `The resolved engineering range is empty: eng_min ${merged.engMin}` +
        `${inherited("engMin")}, eng_max ${merged.engMax}${inherited("engMax")}. ` +
        "The lower bound must be below the upper one — state both together, or clear " +
        "the one this request sets.",
    );
  }

  return problems;
}
