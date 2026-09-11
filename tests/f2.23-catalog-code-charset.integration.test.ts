import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  openIntegrationPool,
  requireIntegrationDb,
} from "../apps/api/src/testing/integration-db-gate.js";

/**
 * `F2.23` / ADR 0065 decisions 2 and 3 — what migration `0070_catalog_code_
 * charset.sql` guarantees against a real Postgres. Model:
 * `tests/f3.10-alarm-lifecycle-schema.integration.test.ts`.
 *
 * Three things are worth a database and cannot be checked without one:
 *
 * 1. `pg_get_constraintdef` for both constraint names — the static `.sql`
 *    says what was asked, not what Postgres stored.
 * 2. The refusal: an illegal `code` on either table is rejected with
 *    SQLSTATE `23514` and the exact constraint name.
 * 3. The positive control: a legal code succeeds on both tables inside the
 *    same transaction, and the whole probe is rolled back so nothing leaks —
 *    a `withRollback` case that only returns COMMITS proves nothing
 *    (`tests/f3.60-withrollback-cases-roll-back.test.ts`'s lesson), so this
 *    file issues its own `ROLLBACK` and counts the tables afterwards.
 *
 * Runs as `bms_fleet` (the gate's default, BYPASSRLS) unless `UPDATE
 * bms.assets` turns out to be refused for that role, in which case switch to
 * `connection: "superuser"` — measured live below.
 *
 * **Assertions inline, no `.spec` sibling** — the top-level `tests/`
 * carve-out (§4.6). Every row this suite writes is rolled back, never
 * committed.
 */

const connectionString = requireIntegrationDb({
  item: "F2.23",
  label: "catalog code charset constraint tests",
  because:
    "pg_get_constraintdef's stored text, the SQLSTATE 23514 refusal and its constraint name are all " +
    "things Postgres holds, so a green run without a database asserts nothing about any of them.",
});

type IntegrationPool = Awaited<ReturnType<typeof openIntegrationPool>>;

type SqlError = Error & { code?: string; constraint?: string };

async function refusal(
  query: () => Promise<unknown>,
): Promise<{ code: string; constraint: string }> {
  try {
    await query();
  } catch (err) {
    const e = err as SqlError;
    return { code: e.code ?? "", constraint: e.constraint ?? "" };
  }
  throw new Error("expected the statement to be refused, but it succeeded");
}

describe.skipIf(!connectionString)("F2.23 catalog code charset (migration 0070)", () => {
  let pool: IntegrationPool | undefined;

  beforeAll(async () => {
    pool = await openIntegrationPool(connectionString as string, "F2.23");
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  }, 60_000);

  it("pg_get_constraintdef reports the class for both constraints", async () => {
    if (!pool) throw new Error("pool not initialised");
    const { rows } = await pool.query<{ conname: string; definition: string }>(
      `SELECT conname, pg_get_constraintdef(oid) AS definition
         FROM pg_constraint
        WHERE conname IN ('assets_code_charset_check', 'point_keys_code_charset_check')
        ORDER BY conname`,
    );
    expect(
      rows.length,
      "both constraints must exist — run pnpm db:migrate to apply 0070",
    ).toBe(2);
    for (const row of rows) {
      expect(row.definition).toContain("~ '^[A-Za-z0-9_-]+$'");
    }
  });

  it("refuses an illegal point_keys.code and an illegal assets.code with 23514, and accepts a legal one, all rolled back", async () => {
    if (!pool) throw new Error("pool not initialised");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // --- negative control: point_keys ---
      await client.query("SAVEPOINT before_bad_point_key");
      const badPointKey = await refusal(() =>
        client.query(`INSERT INTO bms.point_keys (code, name) VALUES ('f2-23.bad', 'x')`),
      );
      expect(badPointKey.code).toBe("23514");
      expect(badPointKey.constraint).toBe("point_keys_code_charset_check");
      await client.query("ROLLBACK TO SAVEPOINT before_bad_point_key");

      // --- negative control: assets ---
      await client.query("SAVEPOINT before_bad_asset");
      const badAsset = await refusal(() =>
        client.query(
          `UPDATE bms.assets SET code = 'f2-23.bad' WHERE id = (SELECT id FROM bms.assets LIMIT 1)`,
        ),
      );
      expect(badAsset.code).toBe("23514");
      expect(badAsset.constraint).toBe("assets_code_charset_check");
      await client.query("ROLLBACK TO SAVEPOINT before_bad_asset");

      // --- positive controls, inside the same transaction ---
      const suffix = Math.random().toString(16).slice(2, 10).padEnd(8, "0");
      const okCode = `f2-23-ok-${suffix}`;
      await client.query("SAVEPOINT before_ok_point_key");
      await client.query(`INSERT INTO bms.point_keys (code, name) VALUES ($1, 'x')`, [okCode]);
      await client.query("ROLLBACK TO SAVEPOINT before_ok_point_key");

      await client.query("SAVEPOINT before_ok_asset");
      await client.query(
        `UPDATE bms.assets SET code = $1 WHERE id = (SELECT id FROM bms.assets LIMIT 1)`,
        [okCode],
      );
      await client.query("ROLLBACK TO SAVEPOINT before_ok_asset");
    } finally {
      // Explicit ROLLBACK, written by hand — a case that only returns
      // COMMITS proves nothing leaked.
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("leaked nothing: the probe's rows are not present afterwards", async () => {
    if (!pool) throw new Error("pool not initialised");
    const leaked = await pool.query(
      `SELECT count(*)::int AS n FROM bms.point_keys WHERE code LIKE 'f2-23-ok-%'`,
    );
    expect(leaked.rows[0]?.n).toBe(0);
    const leakedAsset = await pool.query(
      `SELECT count(*)::int AS n FROM bms.assets WHERE code LIKE 'f2-23-ok-%'`,
    );
    expect(leakedAsset.rows[0]?.n).toBe(0);
  });
});
