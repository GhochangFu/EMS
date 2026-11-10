import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { DIRTY_AFTER_MS } from "../apps/ingest/src/host/uplink-write.js";

/**
 * `E7.2` / ADR 0123 decision 11, plan C7 — the dirty-window threshold is tied
 * to the `_1m` refresh policy it exists to cover.
 *
 * A row younger than the `_1m` policy's `start_offset` (migration `0027`,
 * 3 h) reaches the aggregates on the policy's own schedule; an older one never
 * does unless something refreshes it. `DIRTY_AFTER_MS` must therefore be
 * strictly inside that offset — 1 h inside, so a late policy run does not
 * leave a gap — and a later migration that narrows the policy must fail here
 * rather than leave backfilled buckets silently absent. So the test reads
 * every file in `packages/db/drizzle/` (comments stripped) and fails if any
 * migration other than `0027` adds or removes the `_1m` policy or calls
 * `alter_job`.
 */

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const DRIZZLE = join(repoRoot, "packages/db/drizzle");
const HOUR = 3_600_000;

/** Statements that can set or move a continuous-aggregate refresh policy. */
const POLICY_STATEMENT = /(add_continuous_aggregate_policy|remove_continuous_aggregate_policy|alter_job)\s*\(/;

/** Every migration file, in order, with its `--` comments removed. */
function migrations(): { readonly file: string; readonly sql: string }[] {
  return readdirSync(DRIZZLE)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((file) => ({ file, sql: readFileSync(join(DRIZZLE, file), "utf8").replace(/--.*$/gm, "") }));
}

/** Files that touch the `_1m` policy: a policy statement naming `point_values_1m`, or any `alter_job`. */
function filesTouchingTheOneMinutePolicy(
  files: readonly { readonly file: string; readonly sql: string }[] = migrations(),
): string[] {
  return files
    .filter(({ sql }) =>
      sql
        .split(";")
        .some((statement) => POLICY_STATEMENT.test(statement) && (/point_values_1m\b/.test(statement) || /alter_job/.test(statement))),
    )
    .map(({ file }) => file);
}

/** The `_1m` policy's `start_offset` hours in one file. */
function startOffsetsHours(sql: string): number[] {
  const policy = /add_continuous_aggregate_policy\('telemetry\.point_values_1m',\s*start_offset => INTERVAL '(\d+) hours'/g;
  return [...sql.matchAll(policy)].map((m) => Number(m[1]));
}

describe("E7.2 — the dirty-window threshold sits inside the _1m policy (ADR 0123 decision 11)", () => {
  it("scans every migration, and only 0027 sets or moves the _1m policy", () => {
    const all = migrations();
    expect(all.length, "positive control: the scan read the migrations").toBeGreaterThan(140);
    expect(
      filesTouchingTheOneMinutePolicy(),
      "a migration after 0027 sets or moves the _1m refresh policy (or calls alter_job). DIRTY_AFTER_MS " +
        "in apps/ingest/src/host/uplink-write.ts must be re-derived from it, and this test taught to read it.",
    ).toEqual(["0027_continuous_aggregates.sql"]);
  });

  it("the detector flags a later migration that moves the _1m policy, and ignores an unrelated one", () => {
    const later = [
      { file: "0027_continuous_aggregates.sql", sql: migrations().find((m) => m.file.startsWith("0027_"))?.sql ?? "" },
      { file: "9998_comment_only.sql", sql: "SELECT 1;" },
      {
        file: "9999_narrow.sql",
        sql: "SELECT remove_continuous_aggregate_policy('telemetry.point_values_1m');\nSELECT 1;",
      },
      { file: "9999_alter.sql", sql: "SELECT alter_job(1000, schedule_interval => INTERVAL '5 minutes');" },
    ];
    expect(filesTouchingTheOneMinutePolicy(later)).toEqual([
      "0027_continuous_aggregates.sql",
      "9999_narrow.sql",
      "9999_alter.sql",
    ]);
  });

  it("finds exactly one _1m policy start_offset in 0027, of 3 hours", () => {
    const sql = migrations().find((m) => m.file === "0027_continuous_aggregates.sql")?.sql ?? "";
    expect(startOffsetsHours(sql)).toEqual([3]);
  });

  it("marks a row dirty from 2 h, one hour inside the _1m policy's reach", () => {
    const sql = migrations().find((m) => m.file === "0027_continuous_aggregates.sql")?.sql ?? "";
    const [offsetHours] = startOffsetsHours(sql);
    expect(DIRTY_AFTER_MS).toBe(2 * HOUR);
    expect(offsetHours * HOUR - DIRTY_AFTER_MS, "a 1 h margin inside the policy").toBe(HOUR);
  });
});
