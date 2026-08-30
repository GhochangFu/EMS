import { z } from "zod";

/**
 * `E1.3` — the asset health score contract (ADR 0050 + Amendment 1).
 *
 * ---
 *
 * **`level` is deliberately absent, and `bucketSeconds` is here instead.**
 *
 * This is `F3.35`'s ruling applied unchanged: `pointAggregateStatsSchema` in
 * `./envelopes.ts` omits `level` because returning `"1m" | "5m" | "1h" | "1d"`
 * would put a second declaration of `AggregateLevel`
 * (`apps/api/src/telemetry/point-aggregate-window.ts`) in `packages/shared`,
 * which §4.8 forbids. ADR 0050 decision 6 says the same thing from the other
 * direction — the read reuses `F3.35`'s ladder and does not declare a second
 * one — so a `level` field here would break both rules at once.
 *
 * `bucketSeconds` is also strictly more useful to a renderer, which has to turn
 * a level into a human string either way.
 *
 * ---
 *
 * **Four absences, four fields, and none of them collapse into one `null`.**
 *
 * ADR 0050 makes "absent" a first-class answer in four different places, and
 * Amendment 1's Consequences asks that they stay distinguishable rather than
 * becoming one indistinguishable `null`. They are:
 *
 *  1. `score: null` — nothing in scope could be scored at all.
 *  2. `band: null` — the score is real; the template configures no bands
 *     (Amendment 1 decision 3). The asset is COUNTED, not dropped.
 *  3. `unscoredTags` / `unscoredAssetCount` — no enabled, published threshold
 *     rule matches the tag, so ADR 0050 decision 3 excludes it from the ratio
 *     rather than scoring it 1.0.
 *  4. `skippedRuleCount` — a rule matched but carried a NULL `operator` or
 *     `threshold_value`, so it could not be evaluated (Amendment 1 decision 7).
 *     Never treated as "did not fire".
 *
 * A reader who cannot tell (2) from (3) will report "no data" for an asset that
 * has a perfectly good score and no bands, which is the failure this separation
 * exists to prevent.
 *
 * ---
 *
 * **`.strict()` is restated at every level on purpose.** It does not descend.
 */

/**
 * A resolved band. Carries `label` as well as `code` because the band set is
 * data (`asset_templates.content.health`), not an enum, so a renderer has no
 * table to look the label up in.
 */
export const healthBandSchema = z
  .object({
    code: z.string(),
    label: z.string(),
    /** Inclusive lower bound, on the same `0..1` scale as `score`. */
    minScore: z.number(),
  })
  .strict();

/**
 * One tag's contribution.
 *
 * `score` is `inRangeCount / sampleCount` on `0..1` (Amendment 1 decision 2),
 * and the two counts are carried beside it rather than only the quotient: a
 * ratio of 1.0 over three samples and one over three thousand are different
 * facts, and only the counts distinguish them.
 *
 * `weight` is the RESOLVED weight, never the authored one — an omitted weight
 * resolves to `1`, and a consumer must not have to re-derive the default to
 * explain a number it is shown.
 */
export const healthTagScoreSchema = z
  .object({
    pointKey: z.string(),
    score: z.number(),
    weight: z.number(),
    inRangeCount: z.number().int().nonnegative(),
    sampleCount: z.number().int().positive(),
    /** Rules that matched this tag but could not be evaluated. See absence (4). */
    skippedRuleCount: z.number().int().nonnegative(),
  })
  .strict();

/**
 * The window a health figure covers, and the instant it is current to.
 *
 * `computedAt` is Amendment 1 decision 9. There are four counter relations and
 * therefore FOUR currency instants, and this is the one for the level actually
 * read. A `1d` figure current to 03:00 beside a `1m` figure current to 03:59 is
 * correct; without this field it reads as an arithmetic bug.
 *
 * It is nullable because a scope with no rolled-up bucket has no instant to
 * report — that is absence (1)'s companion, and inventing `now` there would
 * claim currency the roll-up has not established.
 */
const windowFields = {
  windowFrom: z.string().datetime({ offset: true }),
  windowTo: z.string().datetime({ offset: true }),
  bucketSeconds: z.number().int().positive(),
  computedAt: z.string().datetime({ offset: true }).nullable(),
} as const;

/**
 * A tag excluded from the ratio — absence (3), and absence (4) when every rule
 * on it was unevaluatable.
 *
 * **It is an object and not a bare point key on purpose.** A tag with no rule at
 * all and a tag whose every rule carries a NULL `operator` are both unscored,
 * but they are different facts: the first is ADR 0050 decision 3 working as
 * designed, and the second is a rule an operator wrote that silently does
 * nothing. Collapsing them to a string loses the only signal that the second
 * exists, which is the inflation Amendment 1 decision 7 exists to keep visible.
 */
export const healthUnscoredTagSchema = z
  .object({
    pointKey: z.string(),
    /** `0` means no rule matched this tag; above `0` means every matching rule
     * was unevaluatable. */
    skippedRuleCount: z.number().int().nonnegative(),
  })
  .strict();

/** `GET /api/v1/asset-health/assets/:assetId` — one asset's score. */
export const assetHealthResponseSchema = z
  .object({
    assetId: z.string().uuid(),
    /** `0..1`, or `null` when no tag on this asset could be scored. Absence (1). */
    score: z.number().min(0).max(1).nullable(),
    /** `null` when the template configures no bands. Absence (2). */
    band: healthBandSchema.nullable(),
    scoredTags: z.array(healthTagScoreSchema),
    /** Tags excluded for want of an evaluatable rule. Absence (3) — reported,
     * never scored 1.0, and on the current fixtures this is the majority case. */
    unscoredTags: z.array(healthUnscoredTagSchema),
    ...windowFields,
  })
  .strict();

/** One slice of the donut. */
export const healthBandCountSchema = z
  .object({
    code: z.string(),
    label: z.string(),
    count: z.number().int().nonnegative(),
  })
  .strict();

/**
 * `GET /api/v1/asset-health/summary` — the plant and enterprise donut.
 *
 * **There is no single `band` here, and that is a decision rather than an
 * omission.** A band set belongs to a template, so a scope spanning templates
 * has no one vocabulary to resolve against. Reporting the mean score's band
 * would silently pick one template's cut-points for every asset under it.
 *
 * `bandCounts` groups by `code`, which is what makes a donut over heterogeneous
 * templates well defined: two templates naming the same code agree, and two
 * naming different codes produce two slices rather than one wrong one.
 *
 * The two tail counts are absences (2) and (1) at asset granularity, and they
 * are separate for the reason the docblock above gives — `unbandedAssetCount`
 * assets HAVE a score, `unscoredAssetCount` assets do not.
 */
export const healthSummaryResponseSchema = z
  .object({
    /** Weighted mean over the scored assets, `0..1`, or `null` when none were. */
    score: z.number().min(0).max(1).nullable(),
    assetCount: z.number().int().nonnegative(),
    scoredAssetCount: z.number().int().nonnegative(),
    /** Scored, but their template configures no bands — so they appear in no
     * slice. Counted, never dropped (Amendment 1 decision 3). */
    unbandedAssetCount: z.number().int().nonnegative(),
    /** Not scorable at all: no tag with an enabled, published threshold rule. */
    unscoredAssetCount: z.number().int().nonnegative(),
    bandCounts: z.array(healthBandCountSchema),
    ...windowFields,
  })
  .strict();
