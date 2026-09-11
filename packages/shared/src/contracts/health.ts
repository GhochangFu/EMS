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
 *
 * ---
 *
 * **`coveredBuckets` and `expectedBuckets` are Amendment 2 decision 1, and they
 * are not a fifth absence.** `computedAt` is the NEWEST instant across the rows
 * read, so a window whose middle is missing reports the same currency as a
 * window that is complete, and a donut drawn from half a window looks identical
 * to one drawn from all of it. These two integers are what makes that hole
 * visible.
 *
 * `expectedBuckets` is how many buckets the requested window contains at the
 * level actually read. `coveredBuckets` is how many distinct bucket instants
 * inside that window the scope read at least one counter row for.
 *
 * **Two integers and never a ratio.** `healthTagScoreSchema` carries
 * `inRangeCount` beside `sampleCount` for the same reason: `1439 / 1440` and
 * `1 / 1` are different facts, and only the pair distinguishes them.
 *
 * **Coverage is counted per bucket across the whole scope, never per tag.** One
 * sweep pass writes every ruled tag in a bucket, so a bucket with no row
 * anywhere in scope is a pass that did not happen. A gap in one tag's own
 * telemetry is a different fact and `sampleCount` already carries it — per-tag
 * coverage here would report an idle sensor as a roll-up outage.
 *
 * **The four absences each say a VALUE is missing. Coverage says the WINDOW is
 * incompletely backed while every value in it is sound.** A reader that
 * collapses the two reports "no data" for a score that is correct over the
 * buckets it has. So `coveredBuckets: 0` is "nothing to show", and
 * `0 < coveredBuckets < expectedBuckets` is "a real score over less than the
 * window you asked for" — two states, two renderings.
 *
 * **`coveredBuckets: 0` and `computedAt: null` must agree.** A scope with no
 * rolled-up bucket has neither an instant nor any coverage, and a response
 * carrying one without the other is a defect rather than a state.
 *
 * **What coverage cannot say.** It measures the counter relations, so it cannot
 * separate a sweep outage from an enterprise-wide telemetry outage — the bucket
 * is absent in both. That is acceptable because the reader's decision is the
 * same either way: do not read this figure as a full-window figure.
 */
const windowFields = {
  windowFrom: z.string().datetime({ offset: true }),
  windowTo: z.string().datetime({ offset: true }),
  bucketSeconds: z.number().int().positive(),
  computedAt: z.string().datetime({ offset: true }).nullable(),
  /** Distinct bucket instants in the window that the scope read a row for. */
  coveredBuckets: z.number().int().nonnegative(),
  /** Buckets the requested window contains at the level actually read. */
  expectedBuckets: z.number().int().nonnegative(),
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

// ---------------------------------------------------------------------------
// `F4.24` — the process liveness probe (ADR 0063 decisions 10, 11)
// ---------------------------------------------------------------------------
//
// Everything above is the ASSET health score. Everything below is a different
// noun that shares the word: the health of the PROCESS answering the request —
// `GET /health` on the API (`:4000`) and on the worker (`WORKER_PORT`, 4100).
// The two are in one file because the route family is `health`, not because
// the shapes are related; nothing below reuses a schema from above.
//
// Before this row `GET /health` returned an inline `{ status: string }` with no
// contract and no reader. It gains a `queue` section so a queue with no
// consumer — the condition ADR 0063 Q4 exists to make visible — has somewhere
// to show, and the response is typed here so `HealthController` derives its
// return type rather than declaring it (ADR 0030).

/** One queue's depth, sampled with the health read (decision 11's gauge, as a response field). */
export const queueDepthSchema = z
  .object({
    name: z.string(),
    waiting: z.number().int().nonnegative(),
    active: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
  })
  .strict();

/** The last completed sweep, as the worker wrote it (ADR 0064 decision 8). Counts only — never a rule code. */
export const ruleSweepSummarySchema = z
  .object({
    finishedAt: z.string().datetime({ offset: true }),
    evaluated: z.number().int().nonnegative(),
    raised: z.number().int().nonnegative(),
    durationMs: z.number().int().nonnegative(),
  })
  .strict();

/**
 * The `queue` section of the liveness body.
 *
 * `configured: false` is a CHOSEN state (ADR 0002's native-dev path, no
 * `REDIS_URL`), not a degradation: the API boots, `enqueue` rejects, and the
 * body says so. `connected: false` while configured is the degradation — the
 * counts and the tick could not be read inside the timeout.
 *
 * `heartbeatStale` is the reason field (plan §15 ruling 2). Without it a
 * reader has to know the three-tick rule to explain why `status` reads
 * `degraded`, which is the "one error class, many guards" shape. It is `true`
 * when `lastHeartbeatAt` is `null` (ruling 5 — a fresh Redis the worker has
 * never ticked is a queue with no consumer) and when the tick is older than
 * `HEARTBEAT_STALE_TICKS` ticks.
 *
 * `lastRuleSweep` (`F3.11`, ADR 0064 decision 8) is read from the same Redis
 * as the tick and reported beside it. It is NOT part of the `status` verdict:
 * the ADR names the field and no staleness rule for it, so `livenessFrom`
 * never reads it.
 */
export const queueHealthSchema = z
  .object({
    configured: z.boolean(),
    connected: z.boolean(),
    queues: z.array(queueDepthSchema),
    lastHeartbeatAt: z.string().datetime({ offset: true }).nullable(),
    /** `true` when `lastHeartbeatAt` is null or older than HEARTBEAT_STALE_TICKS ticks — the reason `status` reads `degraded`. */
    heartbeatStale: z.boolean(),
    /** `null` when the worker has never completed a sweep or the key is unreadable (absent, corrupt, or not the schema). Not part of the `status` verdict. */
    lastRuleSweep: ruleSweepSummarySchema.nullable(),
  })
  .strict();

/**
 * `GET /health` on both processes. `degraded` still answers HTTP 200 (plan
 * §15 ruling 1): the route is a liveness probe, and a dead worker is not a
 * reason for an orchestrator to restart a process that serves traffic.
 */
export const livenessResponseSchema = z
  .object({
    status: z.enum(["ok", "degraded"]),
    queue: queueHealthSchema,
  })
  .strict();
