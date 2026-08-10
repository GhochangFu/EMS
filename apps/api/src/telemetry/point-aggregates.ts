/**
 * ADR 0023 (`F4.1`) — the single place aggregate reads are expressed.
 *
 * Everything that reads a rolled-up telemetry figure goes through here rather
 * than writing its own `time_bucket`/`date_trunc` SQL. Three reasons, in order
 * of how much damage bypassing it does:
 *
 * 1. **`avg` does not compose, and the mistake is invisible.** `avgExpr` below
 *    is the only correct form. Building an hourly figure as `avg(avg_value)`
 *    over minute buckets was wrong in **151 of 169 buckets** on real pilot data
 *    (worst 0.58 kW) because samples per minute range 1–60. Summed over the
 *    window both forms agree, so a total-level test does not catch it.
 * 2. **The tail strategy may have to change.** Real-time aggregation — what
 *    keeps the newest bucket correct — has been deprecated upstream since
 *    TimescaleDB 2.13 and still works in 2.29.1 (`materialized_only = false`,
 *    set by migration `0027`). If a future version removes it, the fallback is
 *    known: read the aggregate for the settled part and `UNION ALL` raw past
 *    `now() - end_offset`. With this module that is one change, not one per
 *    call site.
 * 3. **Level selection is a judgement, not an obvious mapping**, and it should
 *    be made once.
 *
 * `F4.28` moves the six remaining rollup sites onto this module.
 */

/** The four ADR 0023 levels, coarsest last. */
export type AggregateLevel = "1m" | "5m" | "1h" | "1d";

const RELATIONS: Record<AggregateLevel, string> = {
  "1m": "telemetry.point_values_1m",
  "5m": "telemetry.point_values_5m",
  "1h": "telemetry.point_values_1h",
  "1d": "telemetry.point_values_1d",
};

/** Bucket width in seconds — used to convert an average kW into kWh. */
const BUCKET_SECONDS: Record<AggregateLevel, number> = {
  "1m": 60,
  "5m": 300,
  "1h": 3_600,
  "1d": 86_400,
};

/**
 * Fully-qualified relation for a level. Callers interpolate this into SQL, so it
 * is a lookup against a closed set rather than a string the caller supplies —
 * there is no path from user input to a relation name here.
 */
export function aggregateRelation(level: AggregateLevel): string | undefined {
  // `Object.hasOwn`, not a bare index. The same prototype-key guard as
  // `onboarding-redaction.ts`: a plain `RELATIONS[key]` returns inherited
  // `Object.prototype` members, so a polluted prototype plus any caller passing a
  // string (types erase at runtime) could steer the relation name that gets
  // interpolated into SQL. No such caller exists today; this costs nothing and
  // removes the class.
  //
  // The return type admits `undefined` because `point-aggregates.spec.ts` asserts
  // that an unknown level yields it. A signature promising `string` while the spec
  // depends on `undefined` is the drift AGENTS.md 4.1 is about.
  return Object.hasOwn(RELATIONS, level) ? RELATIONS[level] : undefined;
}

/**
 * The **only** correct way to recover a mean from these views.
 *
 * `sum_value` and `sample_count` are stored precisely so this division happens
 * at read time, where the weights are still known. Do not add an `avg_value`
 * column to make this shorter; see reason 1 in the module comment.
 *
 * **Where the difference actually shows.** When a query groups by the level's own
 * bucket — one source row per output bucket — the correct and the naive form give
 * identical answers, so a call site like that cannot detect a regression here.
 * The forms diverge only when **several source rows fold into one output
 * bucket**: reading `_1m` and grouping by hour, or any window where the chosen
 * level is finer than the display bucket. That case is covered by
 * `assertCoarseRollupFromFinerLevel`, and it is the case `F4.28` will rely on.
 *
 * @param alias table alias the columns are qualified with (`""` for none)
 */
export function avgExpr(alias = ""): string {
  // The alias is interpolated into SQL, and AGENTS.md 4.4's "parameterised
  // queries only" cannot cover an identifier — so it is validated instead. No
  // caller passes one today (every runtime call is bare), but decision 8 routes
  // six more sites through here in `F4.28` and some will need aliases.
  if (alias && !/^[a-z_][a-z0-9_]*$/i.test(alias)) {
    throw new Error(`avgExpr: refusing to interpolate an unsafe alias: ${alias}`);
  }
  const q = alias ? `${alias}.` : "";
  return `(sum(${q}sum_value) / sum(${q}sample_count))`;
}

/** Seconds covered by one bucket at this level. */
export function bucketSeconds(level: AggregateLevel): number {
  return BUCKET_SECONDS[level];
}

/**
 * Hours covered by one bucket — the factor that turns an average kW per bucket
 * into kWh. Replaces the hard-coded `1` / `1 / 60` pair that
 * `DashboardService.energySummary` carried when it read raw, where the two branches
 * had to agree with a `date_trunc` unit written elsewhere in the same query.
 */
export function bucketHours(level: AggregateLevel): number {
  return BUCKET_SECONDS[level] / 3_600;
}
