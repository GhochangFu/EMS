import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

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

    // The bound must be DERIVED from raw's chunk list, not a second copy of the
    // retention interval that can drift from the policy governing it.
    expect(
      script,
      "the bound must come from timescaledb_information.chunks, not a hardcoded interval",
    ).toMatch(/min\(range_start\)/);
    expect(script).toMatch(/hypertable_name\s*=\s*'point_values'/);
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

    // SET LOCAL, not SET: drizzle's migrator reuses one session for every file.
    expect(
      migration,
      "use SET LOCAL so the timeout reverts with the transaction instead of leaking into the " +
        "migrator session and silently bounding later migrations",
    ).not.toMatch(/^\s*SET lock_timeout/m);
  });
});
