import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import pg from "pg";

/**
 * Backfills the ADR 0023 continuous aggregates (`F4.1`).
 *
 * This is a script rather than part of migration `0027` because
 * **`refresh_continuous_aggregate()` cannot run inside a transaction block** —
 * measured 2026-08-10 on TimescaleDB 2.29.1, verbatim error — and
 * `src/migrate.ts` uses Drizzle's `node-postgres` migrator, which wraps the run
 * in one. The migration therefore creates every view `WITH NO DATA`, and this
 * fills them.
 *
 * **Who this is for: an existing database with history.** The pilot carries
 * years of `telemetry.point_values` that migration `0027` cannot materialise, so
 * without this run the aggregates hold only whatever the scheduled policies
 * reach — `_1m`'s `start_offset` is 3 hours, so everything older than that stays
 * unmaterialized indefinitely. Reads still return correct numbers via the
 * real-time branch (ADR 0023 decision 4), but they pay the raw scan this feature
 * exists to avoid.
 *
 * **It is NOT what makes the tests non-vacuous.** `db:seed` inserts zero
 * telemetry rows — verified 2026-08-10; only `apps/sim` and `apps/ingest` ever
 * write `point_values` — so on a freshly seeded CI database all four aggregates
 * are legitimately empty and this run is a no-op. The equality suite therefore
 * inserts its own fixture rather than relying on seeded telemetry. An earlier
 * draft of ADR 0023 claimed the CI wiring was what prevented a vacuous pass;
 * that was wrong and decision 5 records the correction. CI still runs it, for a
 * narrower reason: an unexercised script rots, exactly as
 * `apps/ingest/Dockerfile` did while CI stayed green (`F1.1`).
 *
 * Empty is therefore not an error and is not treated as one.
 *
 * **ADR 0024 (`F4.2`) bounded this run below.** It used to refresh `NULL →
 * now()` — the whole history — which is safe only while raw is complete. With
 * retention now dropping raw chunks at 730 days, refreshing a range raw no
 * longer covers *deletes* the aggregate rows for it (measured: 34,596 → 7,068)
 * and nothing can rebuild them. So it starts at raw's oldest surviving chunk;
 * see `sourceFloor`, which is where the reasoning lives. Each level is bounded by
 * its OWN source, not by raw — only `_1m` reads raw.
 *
 * Order matters and is not alphabetical: each level reads the one below, so
 * refreshing a parent before its source materialises nothing.
 *
 * Scripts run with cwd = `packages/db` via `pnpm --filter @bms/db`.
 *
 * `loadEnv` runs inside `main()`, not here at module scope — `F1.8`/`F1.9`
 * import {@link refreshAggregatesFrom} from `apps/api` for a targeted,
 * already-bounded refresh after a write commits, and an import must not have
 * the side effect of reading `.env` files relative to `process.cwd()` at
 * whatever moment Nest happens to load this module. `main()` is the only
 * caller that is genuinely a CLI entrypoint with no other config source.
 */
function loadCliEnv(): void {
  const pkgRoot = process.cwd();
  loadEnv({ path: resolve(pkgRoot, "../../apps/api/.env") });
  loadEnv({ path: resolve(pkgRoot, ".env") });
}

/**
 * Coarsest last — a level refreshed before its source materialises nothing.
 *
 * **Each level carries its own source, and that is load-bearing rather than
 * documentation.** The ADR 0023 chain is hierarchical: only `_1m` reads raw.
 * `_5m` reads `_1m`, `_1h` reads `_5m`, `_1d` reads `_1h`. A refresh deletes
 * rows wherever its *source* has none (ADR 0024 fact 7), so the floor for each
 * level is its own source's oldest surviving chunk — not raw's.
 *
 * An earlier version of this file computed one floor from raw and applied it to
 * all four. That is correct for `_1m` and wrong for the other three, and the
 * failure it permits is the one this bound exists to prevent: if raw's retention
 * job runs while `_1m`'s lags, raw's floor moves *older* than `_1m`'s data, and
 * refreshing `_5m` from raw's floor recomputes it over a range `_1m` no longer
 * covers — deleting `_5m`, then `_1h`, then `_1d` as the cascade walks up. Those
 * last two are the permanent archive under ADR 0023 decision 7 and fact 14 says
 * no refresh rebuilds them. Caught in review, not by a test; the probe suite now
 * covers two levels precisely because one level could not have caught it.
 */
export const LEVELS = [
  { view: "telemetry.point_values_1m", source: { raw: "point_values" } },
  { view: "telemetry.point_values_5m", source: { aggregate: "point_values_1m" } },
  { view: "telemetry.point_values_1h", source: { aggregate: "point_values_5m" } },
  { view: "telemetry.point_values_1d", source: { aggregate: "point_values_1h" } },
] as const;

type LevelSource = (typeof LEVELS)[number]["source"];

/**
 * Progress goes to stderr via `console.error`, matching the only console call
 * `migrate.ts` and `seed.ts` make. §4.5 reserves `console.log` for the Pino
 * logger, and these CLI scripts have no Nest container to resolve one from.
 */
function report(line: string): void {
  console.error(line);
}

/** Postgres `object_in_use` — TimescaleDB raises it for a concurrent refresh. */
const CONCURRENT_REFRESH = "55P03";
const MAX_ATTEMPTS = 5;
const RETRY_DELAY_MS = 3_000;

/**
 * Refreshes one level, retrying a concurrent-refresh conflict.
 *
 * Found by rehearsing this script on 2026-08-10 rather than by reasoning about
 * it: the four scheduled policies run every 1/5/30/60 minutes, and a manual
 * backfill that overlaps one fails outright with
 *
 *   55P03: could not refresh continuous aggregate "point_values_1h" due to a
 *   concurrent refresh
 *   detail: A concurrent refresh on window [...] is already in progress.
 *
 * The first version had no retry, so it exited non-zero and left `_1h` and `_1d`
 * at `-infinity` while `_1m` and `_5m` were done — a half-materialised chain from
 * a command that looks like it either works or doesn't. The conflict is transient
 * by construction: policy runs are short and bounded by their own `start_offset`.
 */
export async function refreshLevel(
  client: pg.Pool | pg.Client | pg.PoolClient,
  view: string,
  from: Date | null,
  to: Date | null = null,
): Promise<void> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      // Lower-bounded at the level's own source floor, capped at `now()` — see
      // `sourceFloor` and the loop in `main`. `to` is `null` for every call
      // `main()` makes, so `COALESCE` picks the SERVER's `now()` there,
      // unchanged from before `to` existed. `refreshAggregatesFrom` is the
      // only caller that ever passes a non-null `to`.
      await client.query(
        `CALL refresh_continuous_aggregate('${view}', $1::timestamptz, COALESCE($2::timestamptz, now()))`,
        [from, to],
      );
      return;
    } catch (err: unknown) {
      const code = (err as { code?: string } | null)?.code;
      if (code !== CONCURRENT_REFRESH || attempt === MAX_ATTEMPTS) {
        throw err;
      }
      report(
        `[F4.1] ${view}: a scheduled policy is refreshing the same window; ` +
          `retrying in ${RETRY_DELAY_MS / 1000}s (attempt ${attempt}/${MAX_ATTEMPTS})`,
      );
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }
}

/**
 * The margin subtracted from `from` before every refresh — not merely a
 * floor applied when `from` sits close to `now()`. Two failure modes were
 * measured 2026-08-20 against a live database, both against a plain
 * `CALL refresh_continuous_aggregate(view, from, now())` with no margin:
 *
 * 1. `from` within roughly one bucket of `now()` raises
 *    `ERROR: refresh window too small` outright.
 * 2. `from` set to EXACTLY the target row's own timestamp — hours old, a
 *    wide window by any reasonable measure — raises no error but silently
 *    fails to materialize that row's bucket. A `from` comfortably earlier
 *    than the target (even by as little as this level's own bucket width)
 *    reliably does. Reproduced with a real `chw_flow_lps` reading:
 *    `from = row.time` → bucket missing after a successful-looking `CALL`;
 *    `from = row.time - 2 minutes` → bucket present.
 *
 * Both are cured by the same fix: always place `from` at least one bucket
 * width before the earliest instant it needs to cover, never exactly at it.
 */
const REFRESH_MARGIN_MS: Readonly<Record<(typeof LEVELS)[number]["view"], number>> = {
  "telemetry.point_values_1m": 2 * 60_000,
  "telemetry.point_values_5m": 2 * 5 * 60_000,
  "telemetry.point_values_1h": 2 * 60 * 60_000,
  "telemetry.point_values_1d": 2 * 24 * 60 * 60_000,
};

/**
 * Refreshes all four ADR 0023 levels over `[from, to]`, finest-first.
 *
 * For a single, already-bounded window — one write batch, not `main()`'s
 * unbounded historical backfill — so unlike `main()` this does not derive a
 * per-level floor from {@link sourceFloor}. A caller here already knows `from`
 * sits inside raw's own retention (`F1.8`/`F1.9` reject any row older than
 * `RAW_RETENTION_DAYS` before it can reach this), so the floor safety that
 * exists to stop an unbounded run destroying archived aggregate history does
 * not apply to a range that was never unbounded.
 *
 * **`to` defaults to `now()` but is capped at it, never exceeds it** — a
 * batch's own `to` (typically its latest written row) is normally far
 * earlier than `now()`, so the cap is what actually governs. Capping matters
 * because `refreshLevel`'s own docstring already records what an
 * unclamped-into-the-future watermark does: it parks the watermark ahead of
 * the present, and the real-time branch — ADR 0023 decision 4 — covers
 * nothing for the whole gap behind it.
 *
 * **A single row's `from === to` no longer forces a years-wide recompute.**
 * Before this, `to` was hardcoded to `now()` regardless of the batch's own
 * span — a one-row batch backdated near `RAW_RETENTION_DAYS` (730 days)
 * refreshed a 730-day, four-level window synchronously in the request. `to`
 * now follows the batch instead, so the refreshed span is the batch's own
 * width, not "the batch's start to whenever this request happened to run."
 *
 * **Both `from` and `to` carry {@link REFRESH_MARGIN_MS} of margin, pushed
 * in opposite directions** — `from` earlier, `to` later — never landing
 * exactly on the caller's own bound. A window merely *wide enough* was not
 * sufficient: `from = target - margin, to = target` (target sitting exactly
 * on the trailing edge) reproduced the identical silent-no-materialize
 * failure the leading-edge case did. Pushing `to` forward by the same
 * margin (capped at `Date.now()`, so it cannot end up in the future — see
 * `refreshLevel`'s own comment on why that must never happen) reliably
 * clears it; reproduced and verified 2026-08-20 against a live database
 * before landing this shape.
 *
 * **Why symmetric margin fixes it: TimescaleDB inscribes the refresh window
 * in whole buckets** — `window_start` rounds UP to the next bucket boundary,
 * `window_end` rounds DOWN to the previous one. A `to` sitting exactly at
 * the target's own bucket rounds `window_end` DOWN past it, excluding the
 * very bucket the caller needed — the same mechanism as failure mode 2
 * above, just at the opposite edge. This is why the margin must be applied
 * at BOTH ends, not just widened at one: "wide enough" and "landing inside a
 * bucket rather than exactly on its boundary" are different properties, and
 * only the second one is what TimescaleDB actually requires. Simplifying
 * `to.getTime() + margin` back down to `to.getTime()` silently un-
 * materialises every backfilled bucket again — this is the one property in
 * this file an integration assertion, not a type, stands between and a
 * green build.
 */
export async function refreshAggregatesFrom(
  client: pg.Pool | pg.Client | pg.PoolClient,
  from: Date,
  to: Date = new Date(),
): Promise<void> {
  await withRollupRole(client, async (target) => {
    for (const { view } of LEVELS) {
      const margin = REFRESH_MARGIN_MS[view];
      const widenedFrom = new Date(from.getTime() - margin);
      const widenedTo = new Date(Math.min(to.getTime() + margin, Date.now()));
      await refreshLevel(target, view, widenedFrom, widenedTo);
    }
  });
}

/**
 * `E7.1a` / ADR 0045 — runs `work` with `bms_rollup` as the current role.
 *
 * `refresh_continuous_aggregate` requires **ownership** of the aggregate, and
 * since ADR 0045 the API's pools are `bms_tenant`/`bms_fleet`, which own
 * nothing. Before this, every call from `TelemetryWriteService` and
 * `CalcWriteService` failed with `must be owner of continuous aggregate` and was
 * swallowed as a warning — silently, and since `F4.16` moved the API off the
 * owner connection. Its integration test passed only because the test pool was
 * the `bms_app` superuser.
 *
 * That is a data-correctness defect rather than a latency one, which is why it
 * is fixed rather than filed: the refresh policies carry bounded
 * `start_offset`s (3 h / 12 h / 3 days / 30 days), and real-time aggregation
 * covers only data not yet materialised — so a reading written outside its
 * level's window is **permanently absent** from that rollup, with nothing but a
 * `WARN` to say so.
 *
 * `bms_rollup` owns the four continuous aggregates and nothing else.
 * `bms_owner`, `bms_tenant` and `bms_fleet` are members of it, so each can
 * assume it for exactly this.
 *
 * **`SET ROLE`, not `SET LOCAL ROLE`, and that is forced.**
 * `refresh_continuous_aggregate` cannot run inside a transaction block, so
 * there is no transaction for a `LOCAL` setting to be scoped to. The role is
 * therefore reset in a `finally` on the same connection — and the connection is
 * checked out explicitly for the same reason, so a pooled connection can never
 * be handed back to another caller still carrying the role.
 */
async function withRollupRole(
  client: pg.Pool | pg.Client | pg.PoolClient,
  work: (target: pg.PoolClient | pg.Client) => Promise<void>,
): Promise<void> {
  const isPool = typeof (client as pg.Pool).connect === "function" && "idleCount" in client;
  const target = isPool ? await (client as pg.Pool).connect() : (client as pg.Client);
  try {
    await target.query("SET ROLE bms_rollup");
    await work(target);
  } finally {
    // Best effort, and deliberately not rethrowing: a failed RESET must not mask
    // the real error from `work`. The connection is released either way, and a
    // released connection carrying a role is exactly what the explicit checkout
    // above exists to prevent — so on a failed reset, destroy it rather than
    // return it to the pool.
    let reset = true;
    try {
      await target.query("RESET ROLE");
    } catch {
      reset = false;
    }
    if (isPool) {
      (target as pg.PoolClient).release(reset ? undefined : new Error("RESET ROLE failed"));
    }
  }
}

/**
 * The oldest instant a level's SOURCE can still account for — the `range_start`
 * of its source's oldest surviving chunk. `null` when that source has no chunks
 * at all, which on raw means a fresh database.
 *
 * **This is the bound that stops this script destroying the archive** (ADR 0024
 * decision 6). Before `F4.2` the script refreshed `NULL -> now()`: open at the
 * start, the entire history. That was correct only while raw was complete.
 *
 * Measured 2026-08-10 on TimescaleDB 2.29.1 (ADR 0024 facts 6 and 7). Dropping
 * raw chunks — which `add_retention_policy` now does at 730 days — leaves the
 * aggregate rows perfectly intact: 34,596 before, 34,596 after, bit-identical.
 * But **a refresh over a range its source no longer covers deletes them**:
 * 34,596 -> 7,068, because a refresh recomputes from the source and the source is
 * now empty there. Per fact 14 that deletion cannot be undone by any refresh.
 *
 * So an unbounded run, any time after the first retention drop, would erase
 * exactly the `_1h`/`_1d` history that ADR 0023 decision 7 keeps forever — from
 * the command documented as the way to *repair* the aggregates.
 *
 * **Per level, not once from raw.** See the comment on `LEVELS`: only `_1m` reads
 * raw. Taking raw's floor for `_5m`/`_1h`/`_1d` was the review finding that
 * prompted this shape.
 *
 * The bound is derived rather than configured, and deliberately so: a constant
 * here (`now() - 730 days`) would be a second copy of the retention interval,
 * free to drift from the policy that actually governs it. A relation's own chunk
 * list cannot drift from the relation.
 *
 * Note this is the chunk boundary, not `min(time)`/`min(bucket)` — a chunk is the
 * unit retention drops, so its `range_start` is the earliest instant the source
 * could still hold data for. Using the data minimum would sit later inside a live
 * chunk and could delete rows for buckets the source may yet receive late
 * arrivals into.
 */
async function sourceFloor(client: pg.Client, source: LevelSource): Promise<Date | null> {
  // A continuous aggregate's chunks are catalogued under its MATERIALIZATION
  // hypertable (`_timescaledb_internal._materialized_hypertable_N`), while its
  // policies are catalogued under the view name. Both facts were verified against
  // 2.29.1 — see ADR 0024 Amendment 1 fact 18 for the policy half, which the
  // aggregate-retention suite had backwards at first.
  const { rows } =
    "raw" in source
      ? await client.query<{ range_start: Date | null }>(
          `SELECT min(range_start) AS range_start
             FROM timescaledb_information.chunks
            WHERE hypertable_schema = 'telemetry' AND hypertable_name = $1`,
          [source.raw],
        )
      : await client.query<{ range_start: Date | null }>(
          `SELECT min(c.range_start) AS range_start
             FROM timescaledb_information.continuous_aggregates ca
             JOIN timescaledb_information.chunks c
               ON c.hypertable_schema = ca.materialization_hypertable_schema
              AND c.hypertable_name   = ca.materialization_hypertable_name
            WHERE ca.view_schema = 'telemetry' AND ca.view_name = $1`,
          [source.aggregate],
        );
  return rows[0]?.range_start ?? null;
}

/** Human-readable source name, for the progress lines and error messages. */
function sourceName(source: LevelSource): string {
  return "raw" in source ? `telemetry.${source.raw}` : `telemetry.${source.aggregate}`;
}

async function main(): Promise<void> {
  loadCliEnv();
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to refresh aggregates");
  }

  // A single client, not a pool: the refresh must not be wrapped in a
  // transaction, and a pool could hand successive statements to different
  // sessions mid-chain.
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();

  // A refresh cannot be wrapped in a transaction, so `statement_timeout` is the
  // only bound available on it. Generous — a first backfill over years of pilot
  // history is legitimately slow — but not unbounded, so a wedged refresh fails
  // instead of holding a session open indefinitely. `lock_timeout` is separate and
  // short: waiting on a lock is never the slow part of a refresh, so a long wait
  // means contention worth failing on.
  await client.query("SET statement_timeout = '30min'");
  await client.query("SET lock_timeout = '30s'");

  try {
    // Fail loudly on an unmigrated database rather than reporting "nothing to
    // refresh". `min(range_start)` returns NULL both when the hypertable is empty
    // and when it does not exist, and the second must not exit 0 — that would let
    // CI go green against a database where `db:migrate` never ran, which is the
    // shape of failure this repo has already had with unjournaled migrations.
    const { rows: present } = await client.query<{ ok: boolean }>(
      `SELECT to_regclass('telemetry.point_values') IS NOT NULL AS ok`,
    );
    if (present[0]?.ok !== true) {
      throw new Error(
        "telemetry.point_values does not exist. Run `pnpm db:migrate` first — refusing to " +
          "report success against an unmigrated database.",
      );
    }

    // Each level is bounded by ITS OWN source's floor and recomputed in order, so
    // a level refreshed here is already whole before the next one reads it.
    for (const { view, source } of LEVELS) {
      const started = Date.now();
      const from = await sourceFloor(client, source);

      if (from === null) {
        // No chunks under the source. On raw that is a fresh database — every
        // aggregate is legitimately empty and there is nothing to reproduce. On an
        // aggregate source it means the level below holds nothing, which after the
        // ordered refresh above is the same situation one level up.
        //
        // Returning rather than refreshing is the point: "the source has no data"
        // is precisely the state in which a refresh DELETES the level's rows
        // (ADR 0024 fact 7), so an empty source must never be refreshed over.
        report(
          `[F4.2] ${sourceName(source)} has no chunks; stopping before ${view} ` +
            "(refreshing a level whose source is empty would delete its rows)",
        );
        return;
      }

      // A source can legitimately hold data OLDER than raw does — its own
      // retention is longer (ADR 0024 decision 4) — so this floor may predate
      // raw's, and that is safe: the source covers it, which is the only thing
      // that matters.
      if (from.getTime() > Date.now()) {
        // Only future-dated chunks. `point_values` carries some, because
        // `apps/ingest/src/host/normaliser.ts` takes the device's `sample.at` with
        // no future-horizon clamp (ADR 0023, deferred to `F1.7`), and retention
        // never collects them — it only drops chunks OLDER than its cutoff. A
        // range starting after `now()` is invalid, so stop with the reason rather
        // than letting the CALL fail obscurely.
        report(
          `[F4.2] ${sourceName(source)}'s oldest chunk starts at ${from.toISOString()}, ` +
            "which is in the future; refusing to refresh over an inverted window",
        );
        return;
      }

      // Bounded BELOW at the source's oldest chunk and **capped at `now()`** —
      // not `NULL, NULL`.
      //
      // A continuous aggregate's watermark only ever moves forward, and a full
      // refresh follows the data rather than the clock. Measured 2026-08-10 on
      // the pilot: 714 `point_values` rows carry `time > now()`, persistently ~34
      // minutes ahead, for the reason above. `NULL, NULL` therefore parked all
      // four watermarks *ahead of the present*, and for that whole window the
      // real-time branch — the entire point of ADR 0023 decision 4 — covered
      // nothing, leaving stored, understated buckets with no error anywhere.
      //
      // Capping at `now()` leaves the watermark at the present, where the live
      // branch picks up everything after it, including the future-dated rows.
      await refreshLevel(client, view, from);
      const { rows } = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM ${view}`,
      );
      const elapsed = ((Date.now() - started) / 1000).toFixed(2);
      report(
        `[F4.2] ${view}: ${rows[0]?.n ?? "?"} rows in ${elapsed}s ` +
          `(from ${from.toISOString()}, the oldest chunk of ${sourceName(source)})`,
      );
    }
  } finally {
    await client.end();
  }
}

/**
 * Runs `main()` only when this file is the CLI entrypoint (`pnpm
 * db:refresh-aggregates`), not merely imported — `apps/api` imports
 * {@link refreshAggregatesFrom} from this module, and an import must never
 * have the side effect of running the unbounded historical backfill against
 * whatever `DATABASE_URL` the importing process happens to have.
 *
 * `require.main === module`, not `import.meta.url`: this package builds to
 * CommonJS (`tsconfig.build.json`), and `import.meta` does not compile under
 * `module: "CommonJS"`. `tsx` also runs this file as CommonJS by default —
 * `package.json` carries no `"type": "module"` — so the same guard is correct
 * for both the CLI run and the compiled `dist/` import.
 */
if (require.main === module) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
