import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

/**
 * ADR 0025 (`F4.28`) — static guards on the level selector.
 *
 * Here rather than beside the code for the reason `adr-0018-source-axis.test.ts`
 * and `adr-0024-retention-bounds.test.ts` give: this has to read across an
 * `apps/api` source file and a `packages/db` migration, and neither app's Vitest
 * project can see the other. Per §4.6's carve-out, files in `tests/` hold their
 * assertions inline.
 *
 * **These guard a duplication that cannot be removed.** `point-aggregates.ts`
 * carries each level's retention horizon as a constant because a read cannot query
 * `timescaledb_information.jobs` on every call, while the horizon that actually
 * governs the data is `add_retention_policy` in migration `0028`. Two copies of one
 * number, and the drift is **asymmetrically dangerous**: a horizon longer in the
 * code than in the database makes the selector admit a level whose chunks are
 * already dropped, which ADR 0024 facts 13/14 measured as **0 rows, silently, and
 * not rebuildable by any refresh**. The behavioural suite cannot catch it — it
 * would need a database 735 days old.
 */
describe("ADR 0025 — level selector horizons", () => {
  const selector = () => read("apps/api/src/telemetry/point-aggregates.ts");
  const migration = () => read("packages/db/drizzle/0028_compression_retention.sql");

  /**
   * `drop_after` for a relation in migration 0028, in days, or `null` when the
   * relation genuinely has **no** retention policy.
   *
   * **The two cases must not be conflated, and an earlier version of this did.** It
   * matched `INTERVAL '(\d+) days'` and returned `null` on no-match, so "this
   * relation is never dropped" and "I could not parse its horizon" were the same
   * answer. A future migration writing `drop_after => INTERVAL '2 years'` — or
   * `'18 months'`, or even `'735 day'` — would then make **both** tests in this file
   * pass, including the one below whose whole job is to prove `_1h` has no horizon.
   * `RETENTION_DAYS["1h"]` would stay `null`, `levelForRange` would keep admitting
   * `_1h` for ranges whose chunks are gone, and the client-facing CSV export would
   * return 0 rows silently and unrebuildably (ADR 0024 facts 13/14). A guard that
   * fails open on the exact edit it exists to catch is worse than no guard, because
   * it is also reassuring.
   *
   * So: detect the policy first, then insist on a shape we can compare. Anything
   * else **throws**.
   */
  const migrationHorizonDays = (relation: string): number | null => {
    const policy = new RegExp(
      String.raw`add_retention_policy\('telemetry\.${relation}'\s*,([^)]*)\)`,
    ).exec(migration());
    if (!policy) {
      return null; // No policy at all — the only legitimate null.
    }
    const args = policy[1] as string;
    const days = /drop_after\s*=>\s*INTERVAL\s*'(\d+)\s+days'/.exec(args);
    if (!days) {
      throw new Error(
        `migration 0028 has a retention policy for telemetry.${relation} whose drop_after this ` +
          `guard cannot read: ${args.trim()}. It must be written as INTERVAL 'N days' so it can ` +
          "be compared against RETENTION_DAYS in point-aggregates.ts. Do not delete this check " +
          "to make an unparseable interval pass — convert the interval, or teach this function " +
          "the new unit. Silently returning null here would report the relation as never-dropped " +
          "and let levelForRange read chunks that have already been dropped.",
      );
    }
    return Number(days[1]);
  };

  /** The `RETENTION_DAYS` entry for a level, as written in the selector's source. */
  const selectorHorizonDays = (level: string): number | null => {
    const table = /const RETENTION_DAYS: Record<AggregateLevel, number \| null> = \{([\s\S]*?)\};/
      .exec(selector());
    if (!table) {
      throw new Error(
        "point-aggregates.ts has no RETENTION_DAYS table. ADR 0025 decision 1 requires the " +
          "selector to know each level's horizon; without it the guard admits dropped data.",
      );
    }
    const entry = new RegExp(String.raw`"${level}":\s*(null|\d+)`).exec(table[1] as string);
    if (!entry) {
      throw new Error(`RETENTION_DAYS has no entry for "${level}"`);
    }
    return entry[1] === "null" ? null : Number(entry[1]);
  };

  it("matches migration 0028 on every level's horizon", () => {
    for (const level of ["1m", "5m", "1h", "1d"]) {
      const inCode = selectorHorizonDays(level);
      const inDb = migrationHorizonDays(`point_values_${level}`);
      expect(
        inCode,
        `RETENTION_DAYS["${level}"] is ${inCode} but migration 0028 says ${inDb}. These are two ` +
          "copies of one number and they must agree. The dangerous direction is a horizon LONGER " +
          "in code than in the database: levelForRange would then admit a level whose chunks are " +
          "already dropped, which reads as 0 rows silently and cannot be rebuilt (ADR 0024 facts " +
          "13 and 14).",
      ).toBe(inDb);
    }
  });

  it("gives the two coarse levels no horizon at all", () => {
    // ADR 0023 decision 7. Also load-bearing for termination: levelForRange walks
    // the ladder upward and only stops because _1h and _1d never expire. Give _1h
    // a horizon and the selector starts throwing on old ranges.
    for (const level of ["1h", "1d"]) {
      expect(
        selectorHorizonDays(level),
        `_${level} must have no retention horizon. ADR 0023 decision 7 makes _1h and _1d the ` +
          "only record once raw is dropped, and levelForRange's escalation terminates only " +
          "because of it.",
      ).toBeNull();
    }
  });

  it("decides from the range start, never from its end", () => {
    const src = selector();

    // ADR 0025 decision 1. `end` is routinely in the future — reports.service.ts
    // sets it to endDate T23:59:59.999Z, and fact 6 measured the MQTT ingest 33
    // minutes past now(). A guard keyed on `end` would coarsen reports dated today.
    // The signature is the guard: it must not accept `end` at all.
    const signature = /export function levelForRange\(\{([\s\S]*?)\}: \{([\s\S]*?)\}\)/.exec(src);
    expect(
      signature,
      "levelForRange must destructure a named-parameter object so this can check its shape",
    ).not.toBeNull();
    expect(
      (signature?.[2] ?? "").replace(/\/\/.*$/gm, ""),
      "levelForRange must not take `end`. Retention is about age against wall-clock, so only " +
        "`start` and `now` belong in the decision; taking `end` invites deriving the range width " +
        "from a bound that is routinely in the future (ADR 0025 decision 1).",
    ).not.toMatch(/\bend\s*:/);

    expect(
      src,
      "the admissibility comparison must be against `now`, not the range end",
    ).toMatch(/now\.getTime\(\)\s*-\s*days\s*\*\s*86_400_000/);
  });

  it("keeps the escalation ladder ordered fine-to-coarse", () => {
    // Escalation walks this array upward, so a reordering would "escalate" from a
    // dropped level to another dropped level, or downward into a finer one.
    expect(
      selector(),
      "LADDER must run fine to coarse — levelForRange escalates by increasing index",
    ).toMatch(/const LADDER: readonly AggregateLevel\[\] = \["1m", "5m", "1h", "1d"\]/);
  });
});
