import { readFileSync } from "node:fs";
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
 * rather than leave backfilled buckets silently absent.
 */

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const HOUR = 3_600_000;

/** The `_1m` policy's `start_offset`, read from every migration that sets one. */
function oneMinutePolicyStartOffsetsHours(): number[] {
  const sql = readFileSync(join(repoRoot, "packages/db/drizzle/0027_continuous_aggregates.sql"), "utf8");
  const offsets: number[] = [];
  const policy = /add_continuous_aggregate_policy\('telemetry\.point_values_1m',\s*start_offset => INTERVAL '(\d+) hours'/g;
  for (const match of sql.matchAll(policy)) {
    offsets.push(Number(match[1]));
  }
  return offsets;
}

describe("E7.2 — the dirty-window threshold sits inside the _1m policy (ADR 0123 decision 11)", () => {
  it("finds exactly one _1m policy start_offset in 0027, of 3 hours", () => {
    expect(oneMinutePolicyStartOffsetsHours()).toEqual([3]);
  });

  it("marks a row dirty from 2 h, one hour inside the _1m policy's reach", () => {
    const [offsetHours] = oneMinutePolicyStartOffsetsHours();
    expect(DIRTY_AFTER_MS).toBe(2 * HOUR);
    expect(offsetHours * HOUR - DIRTY_AFTER_MS, "a 1 h margin inside the policy").toBe(HOUR);
  });
});
