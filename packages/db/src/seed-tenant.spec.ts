import { expect } from "vitest";

import {
  type SeedQueryable,
  assertSingleConnectionPool,
  withOrganization,
} from "./seed-tenant";

/** Vitest entry point lives in the sibling `.test.ts` (ADR 0014). */

interface RecordedCall {
  readonly text: string;
  readonly values?: unknown[];
}

function recordingPool(
  max: number | undefined,
  onQuery?: (text: string) => void,
): { pool: SeedQueryable; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const pool: SeedQueryable = {
    options: { max },
    query(text: string, values?: unknown[]): Promise<unknown> {
      calls.push({ text, values });
      onQuery?.(text);
      return Promise.resolve({ rows: [] });
    },
  };
  return { pool, calls };
}

/**
 * The `is_local = true` argument is what makes this `SET LOCAL` rather than
 * `SET`. A session-level setting outlives the transaction that set it, so the
 * next organization's inserts would land under the previous organization's
 * identity — silent cross-tenant corruption in the seed, with no error and no
 * failing assertion anywhere.
 */
export async function assertTheTenantSettingIsScopedToTheTransaction(): Promise<void> {
  const { pool, calls } = recordingPool(1);
  await withOrganization(pool, "org-uuid", () => Promise.resolve(null));

  const setCall = calls.find((c) => c.text.includes("app.current_organization"));
  expect(setCall?.text).toContain("set_config");
  expect(setCall?.text).toContain("true");
  expect(setCall?.values).toEqual(["org-uuid"]);
  // A bare `SET` would not take a bind parameter and would not be local.
  expect(setCall?.text).not.toMatch(/^\s*SET\s/i);
}

export async function assertTheWorkRunsBetweenBeginAndCommit(): Promise<void> {
  const { pool, calls } = recordingPool(1);
  await withOrganization(pool, "org-uuid", async () => {
    await pool.query("insert into bms.locations ...");
  });
  expect(calls.map((c) => c.text.split(" ")[0].toUpperCase())).toEqual([
    "BEGIN",
    "SELECT",
    "INSERT",
    "COMMIT",
  ]);
}

/**
 * A half-written organization is worse than none: the seed is re-run routinely,
 * and a partial insert set changes what the next run's idempotency checks see.
 */
export async function assertItRollsBackAndRethrowsOnFailure(): Promise<void> {
  const { pool, calls } = recordingPool(1);
  await expect(
    withOrganization(pool, "org-uuid", () => Promise.reject(new Error("boom"))),
  ).rejects.toThrow("boom");
  expect(calls.map((c) => c.text)).toContain("ROLLBACK");
  expect(calls.map((c) => c.text)).not.toContain("COMMIT");
}

/**
 * The seed's sibling modules query the pool directly rather than checking out a
 * client. With more than one connection available their statements would run
 * outside this transaction — no tenant GUC, no error, and under `FORCE ROW
 * LEVEL SECURITY` they would match and write nothing.
 */
export async function assertItRefusesAMultiConnectionPool(): Promise<void> {
  const { pool } = recordingPool(10);
  await expect(withOrganization(pool, "org-uuid", () => Promise.resolve(1))).rejects.toThrow(
    "max: 1",
  );
  expect(() => assertSingleConnectionPool(recordingPool(undefined).pool)).toThrow("max: 1");
}
