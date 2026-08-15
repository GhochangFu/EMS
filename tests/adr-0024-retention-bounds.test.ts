import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

/** Every `.ts` under the given roots, excluding build output and dependencies. */
function sourceFiles(roots: string[]): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "build") {
        continue;
      }
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
        found.push(full);
      }
    }
  };
  for (const root of roots) {
    walk(join(repoRoot, root));
  }
  return found;
}

/**
 * Comments removed, so prose *about* SQL is never mistaken for SQL. Block comments
 * go wholesale (this is what clears a fenced example inside a JSDoc); line comments
 * only when the line starts with `//`, which leaves `https://` inside a string
 * alone.
 */
function executableText(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/**
 * ADR 0024 (`F4.2`) — static guards on compression and retention.
 *
 * Here rather than beside the code for the reason `adr-0018-source-axis.test.ts`
 * gives: `packages/db` is not a Vitest project, so a `.spec`/`.test` pair there
 * would satisfy the orphan invariant while nothing ran it. Per §4.6's carve-out,
 * files in `tests/` hold their assertions inline.
 *
 * **These exist because CI cannot catch the regression any other way.** The
 * behavioural proof is `apps/api/src/telemetry/aggregate-retention.integration.*`,
 * which needs a database and its own fixture. The one change these guard —
 * the lower bound in `packages/db/src/refresh-aggregates.ts` — is exercised by
 * `pnpm db:refresh-aggregates` in CI, and that step is a **no-op** there:
 * `db:seed` inserts zero `telemetry.point_values` rows, so the script has nothing
 * to refresh and exits green whether or not the bound survives. It is also outside
 * the coverage `include` (`apps/*` only), so the ratchet cannot see it either.
 *
 * A source-text assertion is a weak instrument. It is the only one available for
 * this file, and the thing it protects is destructive and irreversible.
 */
describe("ADR 0024 — compression and retention bounds", () => {
  it("registers migration 0028 in the drizzle journal", () => {
    // A .sql file drizzle never applies is this repo's most-repeated failure:
    // 0018/0021/0022 all shipped unjournaled and left bms.point_keys missing.
    const journal = read("packages/db/drizzle/meta/_journal.json");
    expect(journal).toContain("0028_compression_retention");
    expect(JSON.parse(journal).entries.at(-1)).toMatchObject({
      idx: 28,
      tag: "0028_compression_retention",
    });
  });

  it("keeps the aggregate backfill lower-bounded", () => {
    const script = read("packages/db/src/refresh-aggregates.ts");

    // The exact call this replaced. Restoring it would delete the _1h/_1d history
    // ADR 0023 decision 7 keeps forever, the first time retention has run —
    // measured 34,596 aggregate rows to 7,068 (ADR 0024 fact 7), and per fact 14
    // no refresh can rebuild them.
    expect(
      script,
      "refresh-aggregates.ts must not refresh from NULL: an unbounded refresh over a range " +
        "raw no longer covers DELETES the aggregate rows for it, irreversibly (ADR 0024 facts 7 " +
        "and 14). Pass the oldest surviving raw chunk instead.",
    ).not.toMatch(/refresh_continuous_aggregate\('\$\{view\}',\s*NULL\s*,/);

    expect(
      script,
      "the refresh must take a lower bound parameter",
    ).toMatch(/refresh_continuous_aggregate\('\$\{view\}',\s*\$1::timestamptz\s*,\s*now\(\)\)/);

    // The bound must be DERIVED from the source's chunk list, not a second copy of
    // the retention interval that can drift from the policy governing it.
    expect(
      script,
      "the bound must come from timescaledb_information.chunks, not a hardcoded interval",
    ).toMatch(/min\(range_start\)/);

    // PER LEVEL, not once from raw. Only `_1m` reads raw; `_5m` reads `_1m`, `_1h`
    // reads `_5m`, `_1d` reads `_1h`. The first version of this script took raw's
    // floor for all four, which is correct for `_1m` and destroys the `_1h`/`_1d`
    // archive above it whenever raw's retention runs ahead of `_1m`'s. Behaviour is
    // covered by assertPerLevelFloorProtectsTheCascade; this guards the shape.
    expect(
      script,
      "each level must declare its own source — only _1m reads raw",
    ).toMatch(/aggregate:\s*"point_values_1m"/);
    expect(script).toMatch(/aggregate:\s*"point_values_5m"/);
    expect(script).toMatch(/aggregate:\s*"point_values_1h"/);

    // The aggregate branch must resolve chunks through the MATERIALIZATION
    // hypertable — a continuous aggregate's chunks are catalogued there, while its
    // policies are catalogued under the view name (Amendment 1 fact 18). Querying
    // chunks by view name silently returns nothing, which this bound would read as
    // "the source is empty".
    expect(
      script,
      "aggregate sources must join continuous_aggregates to reach their materialization hypertable",
    ).toMatch(/materialization_hypertable_name/);
  });

  it("retains each fine aggregate strictly longer than raw", () => {
    const migration = read("packages/db/drizzle/0028_compression_retention.sql");

    const dropAfter = (relation: string): number => {
      const pattern = new RegExp(
        String.raw`add_retention_policy\('telemetry\.${relation}',\s*` +
          String.raw`drop_after\s*=>\s*INTERVAL '(\d+) days'`,
      );
      const match = pattern.exec(migration);
      if (!match) {
        throw new Error(`0028 has no retention policy for telemetry.${relation}`);
      }
      return Number(match[1]);
    };

    const raw = dropAfter("point_values");
    for (const level of ["point_values_1m", "point_values_5m"]) {
      expect(
        dropAfter(level),
        `${level} must be retained strictly longer than raw (${raw} days). Equal is not enough — ` +
          "the two policies run on independent schedules, so either may fire first, and the " +
          "state where raw holds a period its aggregate does not is unreadable AND unrepairable " +
          "(ADR 0024 facts 13 and 14).",
      ).toBeGreaterThan(raw);
    }
  });

  it("never drops the two coarse levels", () => {
    const migration = read("packages/db/drizzle/0028_compression_retention.sql");

    for (const level of ["point_values_1h", "point_values_1d"]) {
      expect(
        migration,
        `${level} must have no retention policy. ADR 0023 decision 7 makes _1h and _1d the only ` +
          "record once raw is dropped; dropping them needs an ADR that overturns it.",
      ).not.toMatch(new RegExp(String.raw`add_retention_policy\('telemetry\.${level}'`));
    }
  });

  it("leaves the initial compression to the policy, not the migration", () => {
    const migration = read("packages/db/drizzle/0028_compression_retention.sql");

    // ADR 0024 decision 1: whether compress_chunk works inside a transaction is
    // UNMEASURED. Fact 2 covers the ALTER and the two policy functions only, and
    // drizzle wraps this file in a transaction.
    expect(
      migration.replace(/^\s*--.*$/gm, ""),
      "0028 must not call compress_chunk: it runs inside drizzle's transaction and " +
        "compress_chunk's transaction safety is unmeasured. Let the policy's first run do it.",
    ).not.toMatch(/compress_chunk\s*\(/);
  });

  it("bounds the lock wait without leaking the setting", () => {
    const migration = read("packages/db/drizzle/0028_compression_retention.sql");

    // ADR 0024 fact 16: `ALTER TABLE ... SET (timescaledb.compress ...)` takes an
    // ACCESS EXCLUSIVE lock on telemetry.point_values. The work is 10.7 ms, but
    // acquisition queues behind in-flight readers and blocks arrivals behind it.
    expect(
      migration,
      "0028 must bound its lock wait — an unbounded ACCESS EXCLUSIVE wait stalls live ingest",
    ).toMatch(/SET LOCAL lock_timeout/);

    // SET LOCAL, not SET, so nothing escapes the transaction.
    expect(migration, "use SET LOCAL, not SET").not.toMatch(/^\s*SET lock_timeout/m);

    // And it must be RESET before the file ends. Drizzle wraps the WHOLE RUN in one
    // transaction — `session.transaction()` opens outside the migration loop — so
    // `SET LOCAL` reaches every migration applied after this one in the same run.
    // Without the reset, the next migration anyone adds silently inherits a 5 s
    // lock_timeout on fresh-database runs but not on incremental applies to the
    // pilot. An earlier version of this file asserted SET LOCAL for the opposite
    // (and wrong) reason: that it could not reach later files.
    expect(
      migration,
      "0028 must reset lock_timeout before it ends — drizzle's transaction spans the whole run, " +
        "so the bound would otherwise leak into every later migration in that run",
    ).toMatch(/SET LOCAL lock_timeout = DEFAULT/);
  });

  /**
   * `F4.40` — every `DELETE` against a telemetry hypertable must be prunable
   * against compressed batches.
   *
   * `0028` segments `telemetry.point_values` by `asset_id` and `point_key`, so a
   * **constant** filter on either is evaluated against compressed batches without
   * opening them. Anything the planner cannot fold to a constant — a subquery, a
   * CTE, a join — forces TimescaleDB to decompress **every** batch to decide
   * whether a row matches, and past
   * `max_tuples_decompressed_per_dml_transaction` (100000) that is a hard error:
   * `tuple decompression limit exceeded by operation`.
   *
   * Measured on a dev database with 4 of 15 chunks compressed: the `F4.28` cleanup
   * decompressed **186706 tuples while matching zero assets**. The count has
   * nothing to do with how much the statement intends to delete, which is why no
   * amount of scoping the fixture could have avoided it.
   *
   * **Why this is a static invariant and not a test.** The failure needs a database
   * with a compressed chunk, and `ADR 0024` compresses at 7 days — so CI, which
   * creates its database per run, is structurally incapable of ever seeing it. It
   * is exactly the §4.6 asymmetry: green in CI, red on every developer's machine
   * after the first week and on every pilot instance.
   *
   * **The rule is stated by shape, not by string.** `F4.39` recorded that pinning
   * the exact defect catches only the exact defect: `IN (SELECT ...)` rewritten as
   * a CTE, a `USING` join, or a fresh spec file with its own subquery are all the
   * same defect wearing different clothes. So the assertion is the invariant
   * itself — a delete here is a single-table statement filtered on a segmentby
   * column — and every one of those rewrites fails it.
   */
  it("keeps every telemetry DELETE prunable against compressed batches", () => {
    const sites: { where: string; statement: string }[] = [];

    for (const file of sourceFiles(["apps", "packages"])) {
      const text = executableText(readFileSync(file, "utf8"));
      const rel = relative(repoRoot, file).replace(/\\/g, "/");
      for (const match of text.matchAll(/DELETE\s+FROM\s+telemetry\.\w+/gi)) {
        // To the end of the enclosing template literal — pool.query takes its SQL
        // as one backticked string throughout this repo.
        const from = match.index;
        const end = text.indexOf("`", from);
        const statement = (end === -1 ? text.slice(from) : text.slice(from, end))
          .replace(/\s+/g, " ")
          .trim();
        sites.push({ where: rel, statement });
      }
    }

    // A broken walk must fail loudly rather than pass having scanned nothing —
    // the vacuous green this repo keeps rediscovering. Three sites today:
    // F4.1's two and F4.28's one.
    expect(
      sites.length,
      "this scan found no DELETE against a telemetry hypertable at all. Every one of them was " +
        "removed, or the file walk is broken — either way this check is asserting nothing.",
    ).toBeGreaterThanOrEqual(3);

    for (const { where, statement } of sites) {
      expect(
        statement,
        `${where}: this DELETE reaches telemetry.point_values through a subquery or join. ` +
          "asset_id and point_key are SEGMENTBY columns (migration 0028), and only a CONSTANT " +
          "filter on them prunes compressed batches — anything else makes TimescaleDB decompress " +
          "every batch to evaluate the predicate and fail with `tuple decompression limit " +
          "exceeded by operation` on any database older than ADR 0024's 7-day compression " +
          "threshold. CI cannot see this, because its database is created per run. Resolve the " +
          `ids in a separate query first and filter on them directly. Statement: ${statement}`,
      ).not.toMatch(/\b(SELECT|JOIN|USING)\b/i);

      expect(
        statement,
        `${where}: this DELETE does not filter telemetry.point_values on a segmentby column. ` +
          "Without `asset_id =` or `point_key =` it scans and decompresses every batch in every " +
          `chunk. Statement: ${statement}`,
      ).toMatch(/\b(asset_id|point_key)\s*=/);

      // The remediation above — "resolve the ids in a separate query first" — hands
      // the author a JavaScript variable holding an id and a SQL string that wants
      // it, which is exactly the moment someone reaches for `${id}`. §4.4 already
      // says parameterised queries only; this says it where the temptation is
      // manufactured, so the fix for one rule cannot quietly break another.
      expect(
        statement,
        `${where}: this DELETE interpolates a value into its SQL. AGENTS.md §4.4 is ` +
          "parameterised queries only — and resolving ids in a separate query, which the rule " +
          "above asks for, is precisely where that gets forgotten. Bind it instead. " +
          `Statement: ${statement}`,
      ).not.toMatch(/\$\{/);
    }
  });
});
