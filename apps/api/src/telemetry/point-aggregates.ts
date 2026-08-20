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
 *    be made once. `levelForRange` below is where; ADR 0025 decision 1 is why it
 *    takes a *range* and not a duration.
 *
 * `F4.28` (ADR 0025) moved the remaining six rollup sites onto this module.
 */

/** The four ADR 0023 levels, coarsest last. */
export type AggregateLevel = "1m" | "5m" | "1h" | "1d";

/** Fine to coarse. The order `levelForRange` escalates along. */
const LADDER: readonly AggregateLevel[] = ["1m", "5m", "1h", "1d"];

const RELATIONS: Record<AggregateLevel, string> = {
  "1m": "telemetry.point_values_1m",
  "5m": "telemetry.point_values_5m",
  "1h": "telemetry.point_values_1h",
  "1d": "telemetry.point_values_1d",
};

/**
 * Each level's retention horizon in days, or `null` for "never dropped".
 *
 * **These must equal migration `0028`'s `add_retention_policy` intervals.** They
 * are duplicated here because the selector cannot query the catalog on every
 * read, and `tests/adr-0025-level-selector.test.ts` parses `0028` and asserts the
 * pairing so the copy cannot drift. If you change the policy, change this — a
 * horizon that is longer here than in the database is the dangerous direction:
 * the guard would admit a level whose data has already been dropped.
 */
const RETENTION_DAYS: Record<AggregateLevel, number | null> = {
  "1m": 735,
  "5m": 735,
  "1h": null, // ADR 0023 decision 7 — never dropped; the only record past 730 d.
  "1d": null, // likewise.
};

/**
 * Raw `telemetry.point_values`' own retention horizon, in days — migration
 * `0028`'s `drop_after` on raw. `tests/adr-0024-retention-bounds.test.ts`
 * asserts this equals what the migration parses to, the same way
 * `RETENTION_DAYS` above is guarded against `0028`'s aggregate policies.
 *
 * Owed by `F1.8`/`F1.9` (backlog): their write path must reject a reading
 * older than this before it lands, rather than accept one that the next
 * retention run silently deletes — "the import worked and the data vanished
 * four days later" is a worse failure than a rejection at write time.
 */
export const RAW_RETENTION_DAYS = 730;

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

/** What {@link levelForRange} decided, and whether retention forced its hand. */
export interface LevelChoice {
  /** The level to read. Always at or coarser than `requested`. */
  readonly level: AggregateLevel;
  /** What the caller's display granularity alone would have chosen. */
  readonly requested: AggregateLevel;
  /**
   * `true` when the retention guard forced a coarser level than `requested`.
   *
   * **Diagnostic only — no caller reads this today, and that is accurate rather
   * than an oversight.** All seven call sites destructure `{ level }`, because no
   * read can currently trigger an escalation: every dashboard window is at most 30
   * days and the reports path already asks for `_1h`, which has no horizon. An
   * earlier version of this comment said the flag was "surfaced rather than
   * hidden", which was aspirational — nothing surfaces it.
   *
   * It is here so that the first caller which *can* escalate has the fact
   * available instead of having to re-derive it, and so that a debugger can see
   * that a level was substituted. If a caller ever renders buckets over a range
   * that could escalate, it should read this and tell the user the granularity
   * changed — silently widening buckets on a chart is its own defect.
   */
  readonly coarsened: boolean;
}

/**
 * Picks the level to read for a range — **ADR 0025 decision 1**, and the debt ADR
 * 0024 assigned to `F4.28` when it withdrew its own decision 8.
 *
 * Two inputs, and both are necessary:
 *
 * - `granularity` — the bucket width the caller wants to *display*. Not derived
 *   from the range, because it is not a function of it: `loadTrend` shows minute
 *   buckets over windows up to 168 hours, while `energySummary` switches to hours
 *   at 48. Deriving it here would silently change what those charts plot.
 * - `start` — how far **back** the range reaches, which is what retention is
 *   about.
 *
 * ### Why a duration-keyed selector is the trap
 *
 * ADR 0024 withdrew a retention-aware selector as unnecessary, reasoning that the
 * reports path "buckets by hour and lands on `_1h`, which carries no retention
 * policy at all". That holds while level choice is hard-coded per site — the tree
 * it reviewed. It stops holding the moment a selector exists, because the obvious
 * selector is the duration-keyed ternary `energySummary` had inline. Route the
 * reports path through *that* and a 24-hour report dated three years back selects
 * `_1m`, which migration `0028` drops at 735 days, and ADR 0024 facts 13 and 14
 * say the result is **0 rows, silently, and not rebuildable by any refresh**.
 *
 * So: a level is admissible only when
 *
 *     start >= now - horizon(level)
 *
 * and **`end` plays no part**. That is spelled out because `end` is routinely in
 * the future — `reports.service.ts` sets it to `endDate T23:59:59.999Z`, up to a
 * day ahead, and ADR 0025 fact 6 measured the MQTT ingest writing 33 minutes
 * past `now()`. A guard that compared a horizon against `end`, or took the range
 * width from it, would coarsen reports dated today: correct-looking, needlessly
 * lossy, and untraceable. Retention is a statement about age against wall-clock,
 * so only `start` and `now` belong in it.
 *
 * Escalation walks {@link LADDER} upward and terminates because `_1h` and `_1d`
 * have no horizon (ADR 0023 decision 7). **No read triggers it today**: every
 * dashboard window is at most **720 hours (30 days)** — `parseEnergyWindow` caps
 * hour-suffixed windows at 168 but day-suffixed ones at 30, which is the larger
 * bound and the one that matters here — and the reports path already wants
 * hourly buckets. It exists so that the first read which *could* — a report
 * offering finer granularity, or a future ADR giving `_1h` a horizon — fails
 * visibly instead of returning an empty chart.
 *
 * @param now injectable for tests only; defaults to the current instant.
 */
export function levelForRange({
  start,
  granularity,
  now = new Date(),
}: {
  start: Date;
  granularity: AggregateLevel;
  now?: Date;
}): LevelChoice {
  const from = LADDER.indexOf(granularity);
  if (from < 0) {
    // Unreachable through the type, but types erase at runtime and this decides
    // which relation gets read. Fail loudly rather than defaulting to a level.
    throw new Error(`levelForRange: unknown granularity "${granularity}"`);
  }

  for (let i = from; i < LADDER.length; i += 1) {
    const level = LADDER[i] as AggregateLevel;
    if (retentionCovers(level, start, now)) {
      return { level, requested: granularity, coarsened: i > from };
    }
  }

  // Only reachable if every level from `granularity` up has a horizon — i.e. if
  // ADR 0023 decision 7 has been overturned without updating RETENTION_DAYS.
  throw new Error(
    `levelForRange: no level at or coarser than "${granularity}" retains ` +
      `${start.toISOString()}. Every level now has a retention horizon, which ADR 0023 ` +
      "decision 7 forbids for _1h and _1d — reading raw is the only correct answer here " +
      "and this module cannot give it.",
  );
}

/**
 * Whether `level` still holds data as old as `start`.
 *
 * A level with no horizon covers everything. Note the comparison is against
 * `now`, never against the range's `end` — see {@link levelForRange}.
 */
function retentionCovers(level: AggregateLevel, start: Date, now: Date): boolean {
  const days = RETENTION_DAYS[level];
  if (days === null) {
    return true;
  }
  const oldestRetained = now.getTime() - days * 86_400_000;
  return start.getTime() >= oldestRetained;
}

/**
 * The retention horizon in days, or `null` for never-dropped. Exported for the
 * static guard that holds it equal to migration `0028`.
 */
export function retentionDays(level: AggregateLevel): number | null {
  return RETENTION_DAYS[level];
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
