import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

/**
 * `F3.35` Stage A (ADR 0048 decision 3) — static guards on the aggregate
 * endpoint's window ladder.
 *
 * Here rather than beside the code for the reason `adr-0025-level-selector.test.ts`
 * gives: these read across `apps/api`, `packages/shared` **and** a `packages/db`
 * migration, and no app's Vitest project can see the others. Per §4.6's carve-out,
 * files in `tests/` hold their assertions inline.
 *
 * **What these guard is why `LevelChoice.coarsened` is not surfaced.** The
 * endpoint chooses its granularity from the window arithmetically, before any row
 * is read, and the ladder is bounded so that the retention guard can never
 * escalate. `point-aggregate-window.spec.ts` proves that against the TypeScript
 * constant; these two prove it against **the migration that actually governs the
 * data** and against **the contract bound the request is validated by**. Both
 * duplications are real and neither can be removed:
 *
 * - `RETENTION_DAYS` in `point-aggregates.ts` is a copy of migration `0028`'s
 *   `drop_after`, because a read cannot query `timescaledb_information.jobs` on
 *   every call. `adr-0025-level-selector.test.ts` already holds those two equal;
 *   this file holds the *ladder's reach* inside them.
 * - `MAX_WIDGET_WINDOW_MINUTES` in `packages/shared` is what the request is
 *   validated against; the ladder in `apps/api` is what answers it. If the
 *   contract admits a window the ladder does not, `granularityFor` throws — a 500
 *   in front of an operator on a dashboard that was saved successfully.
 */
describe("F3.35 Stage A — the aggregate window ladder", () => {
  const ladderSource = () => read("apps/api/src/telemetry/point-aggregate-window.ts");
  const contractSource = () => read("packages/shared/src/contracts/dashboard-builder.ts");
  const migration = () => read("packages/db/drizzle/0028_compression_retention.sql");

  /** The ladder rungs, parsed from the source that answers requests. */
  const rungs = (): { maxWindowMinutes: number; granularity: string }[] => {
    const matches = [
      ...ladderSource().matchAll(
        /\{\s*maxWindowMinutes:\s*([\d_]+),\s*granularity:\s*"(1m|5m|1h|1d)"/g,
      ),
    ];
    if (matches.length === 0) {
      throw new Error(
        "could not parse a single ladder rung from point-aggregate-window.ts. The LADDER's shape " +
          "changed; update this parser rather than deleting the guard — a guard that fails open " +
          "on the edit it exists to catch is worse than none, because it is also reassuring.",
      );
    }
    return matches.map((m) => ({
      maxWindowMinutes: Number((m[1] as string).replace(/_/g, "")),
      granularity: m[2] as string,
    }));
  };

  /**
   * `drop_after` for a relation in `0028`, in days, or `null` when the relation
   * genuinely carries **no** retention policy.
   *
   * The two cases are kept apart deliberately, the same way
   * `adr-0025-level-selector.test.ts` keeps them apart: a policy written in an
   * unparseable unit throws rather than reading as "never dropped".
   */
  const horizonDays = (relation: string): number | null => {
    const policy = new RegExp(
      String.raw`add_retention_policy\('telemetry\.${relation}'\s*,([^)]*)\)`,
    ).exec(migration());
    if (!policy) {
      return null;
    }
    const days = /drop_after\s*=>\s*INTERVAL\s*'(\d+)\s+days'/.exec(policy[1] as string);
    if (!days) {
      throw new Error(
        `${relation} has a retention policy this test cannot parse. Do not relax the pattern — ` +
          "read the interval and decide whether the ladder below still fits inside it.",
      );
    }
    return Number(days[1]);
  };

  it("keeps the coarsest rung equal to the window bound the contract validates against", () => {
    const declared = /MAX_WIDGET_WINDOW_MINUTES\s*=\s*([\d_]+)/.exec(contractSource());
    expect(
      declared,
      "MAX_WIDGET_WINDOW_MINUTES is no longer declared in dashboard-builder.ts",
    ).not.toBeNull();
    const contractMax = Number((declared?.[1] as string).replace(/_/g, ""));

    const ladder = rungs();
    const coarsest = ladder[ladder.length - 1]?.maxWindowMinutes;
    expect(
      coarsest,
      `the contract accepts a ${contractMax}-minute window but the ladder answers only ` +
        `${coarsest}. A dashboard saved with the longer window would save successfully and then ` +
        "throw on every read.",
    ).toBe(contractMax);
  });

  it("keeps every rung's deepest reach inside the horizon the migration actually sets", () => {
    for (const rung of rungs()) {
      // A compare doubles the reach: the request reads one window back, and then
      // one more of the same length behind it.
      const reachDays = (2 * rung.maxWindowMinutes) / (60 * 24);
      const horizon = horizonDays(`point_values_${rung.granularity}`);
      if (horizon === null) {
        continue; // Never dropped — ADR 0023 decision 7 for _1h and _1d.
      }
      expect(
        reachDays,
        `a ${rung.maxWindowMinutes}-minute window with a compare reaches ${reachDays} days back ` +
          `into telemetry.point_values_${rung.granularity}, whose chunks are dropped after ` +
          `${horizon} days. The retention guard would escalate to a coarser level and the chart ` +
          "would silently widen its buckets — which is the defect LevelChoice.coarsened exists " +
          "to report and which this endpoint deliberately does not surface, because it was " +
          "supposed to be unreachable.",
      ).toBeLessThanOrEqual(horizon);
    }
  });

  it("keeps the two coarse levels free of any retention policy", () => {
    // The ladder's top two rungs rest on this. `adr-0025` asserts the same fact
    // about the TypeScript constant; here it is asserted about the migration, so
    // adding a policy in `0028` fails even if nobody updates `RETENTION_DAYS`.
    expect(horizonDays("point_values_1h")).toBeNull();
    expect(horizonDays("point_values_1d")).toBeNull();
  });
});
