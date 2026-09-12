import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  openIntegrationPool,
  requireIntegrationDb,
} from "../apps/api/src/testing/integration-db-gate.js";

/**
 * `F4.60` / ADR 0016 §3 — what migration `0071_rtu_code_unique.sql` guarantees
 * against a real Postgres. Model:
 * `tests/f2.23-catalog-code-charset.integration.test.ts`.
 *
 * **This file exists because the repo had no such gate for an index.** Its two
 * precedents — `tests/f3.46-notification-deliveries-dedupe-index.test.ts` and
 * `tests/e7.1i-audit-log-index.test.ts` — assert the migration's *text* and
 * stop there. Text cannot distinguish an index that was written from one that
 * was applied, and it cannot tell a `UNIQUE` index from a plain one at all.
 *
 * ## Why a negative control alone would not gate this
 *
 * "A duplicate `rtu_code` is refused" passes against `WHERE true`, against
 * `WHERE rtu_code IS NOT NULL` (the backlog row's own spelling), and against a
 * `coalesce(rtu_code,'')` expression index. It is true under every predicate
 * this item considered, including the two that are wrong. So the refusal is
 * paired with two positive controls, and **the `''` one is the load-bearing
 * assertion of this file**: it is the only case that reddens if the predicate
 * loses `AND rtu_code <> ''`.
 *
 * The `NULL` control is weaker on purpose and says so: Postgres treats NULLs
 * as distinct in a unique index by default, so it survives a `WHERE true`
 * mutation. It catches a different class — an expression index over
 * `coalesce(rtu_code, '')`, or `NULLS NOT DISTINCT` — and it is here because
 * `packages/db/src/hierarchy-seed.ts` inserts 44 RTUs with a NULL `rtu_code`
 * and a mutation that collapsed them would take the seed down.
 *
 * Runs as `bms_fleet`, the gate's default. Measured on the live compose
 * database on 2026-09-12: `bms_fleet` holds SELECT, INSERT, UPDATE, DELETE on
 * `bms.rtus` and has `rolbypassrls = t`, so the inserts below need no
 * superuser fallback and the leak count is not blinded by `FORCE ROW LEVEL
 * SECURITY` — the same `count(*)` run as `bms_owner` returns 0 with 56 rows
 * present, which is why this file never reads as the owner.
 *
 * **Assertions inline, no `.spec` sibling** — the top-level `tests/`
 * carve-out (§4.6). Every row this suite writes is rolled back, never
 * committed, and every one carries an `f4.60-` prefix so a leak names its
 * author.
 */

const connectionString = requireIntegrationDb({
  item: "F4.60",
  label: "rtus.rtu_code partial unique index tests",
  because:
    "whether the index is UNIQUE, what predicate Postgres stored for it, that a duplicate rtu_code " +
    "raises 23505 naming rtus_rtu_code_idx, and that two '' rows and two NULL rows are still " +
    "accepted are all facts Postgres holds. A green run without a database asserts none of them, " +
    "and the static sibling tests/f4.60-rtu-code-unique.test.ts cannot tell a written migration " +
    "from an applied one.",
});

type IntegrationPool = Awaited<ReturnType<typeof openIntegrationPool>>;

type SqlError = Error & { code?: string; constraint?: string };

/** The row prefix every probe uses, so a leaked row names this suite. */
const PREFIX = "f4.60-";

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

describe.skipIf(!connectionString)("F4.60 rtus.rtu_code unique index (migration 0071)", () => {
  let pool: IntegrationPool | undefined;
  let locationId = "";
  let organizationId = "";

  beforeAll(async () => {
    pool = await openIntegrationPool(connectionString as string, "F4.60");
    const { rows } = await pool.query<{ id: string; organization_id: string }>(
      `SELECT id, organization_id FROM bms.locations WHERE active = true
        AND organization_id IS NOT NULL ORDER BY code LIMIT 1`,
    );
    if (!rows[0]) {
      throw new Error(
        "F4.60 needs one active seeded location to hang probe RTUs on. Run pnpm db:seed.",
      );
    }
    locationId = rows[0].id;
    organizationId = rows[0].organization_id;
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  }, 60_000);

  it("stored the index as UNIQUE with the predicate that excludes the empty string", async () => {
    if (!pool) throw new Error("pool not initialised");
    const { rows } = await pool.query<{
      indisunique: boolean;
      predicate: string | null;
    }>(
      `SELECT ix.indisunique, pg_get_expr(ix.indpred, ix.indrelid) AS predicate
         FROM pg_index ix
         JOIN pg_class i ON i.oid = ix.indexrelid
         JOIN pg_class c ON c.oid = ix.indrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'bms' AND c.relname = 'rtus' AND i.relname = 'rtus_rtu_code_idx'`,
    );
    expect(
      rows.length,
      "rtus_rtu_code_idx must exist — run pnpm db:migrate to apply 0071",
    ).toBe(1);
    expect(rows[0]!.indisunique, "rtus_rtu_code_idx must be UNIQUE, not a plain index").toBe(true);
    // Postgres's own rendering, pasted from the live database on 2026-09-12
    // rather than guessed: it adds the ::text casts and the parentheses.
    expect(rows[0]!.predicate).toBe(
      "((rtu_code IS NOT NULL) AND ((rtu_code)::text <> ''::text))",
    );
  });

  it("refuses a second RTU carrying the same non-empty rtu_code", async () => {
    if (!pool) throw new Error("pool not initialised");
    const client = await pool.connect();
    const code = `${PREFIX}dup-${Math.random().toString(16).slice(2, 10)}`;
    try {
      await client.query("BEGIN");
      const first = await client.query(
        `INSERT INTO bms.rtus (organization_id, location_id, code, display_name, rtu_code)
         VALUES ($1, $2, $3, 'F4.60 probe A', $4)`,
        [organizationId, locationId, `${code}-a`, code],
      );
      expect(first.rowCount, "the first insert must succeed").toBe(1);

      const second = await refusal(() =>
        client.query(
          `INSERT INTO bms.rtus (organization_id, location_id, code, display_name, rtu_code)
           VALUES ($1, $2, $3, 'F4.60 probe B', $4)`,
          [organizationId, locationId, `${code}-b`, code],
        ),
      );
      expect(second.code, "a duplicate rtu_code must raise SQLSTATE 23505").toBe("23505");
      expect(
        second.constraint,
        "the refusal must name rtus_rtu_code_idx. The name is what " +
          "apps/api/src/admin/rtus/rtus-conflict.ts and COMMIT_UNIQUE_CONFLICTS both key on, " +
          "so a renamed index silently returns both paths to answering 500.",
      ).toBe("rtus_rtu_code_idx");
    } finally {
      try {
        await client.query("ROLLBACK");
      } finally {
        client.release();
      }
    }
  });

  it("still accepts two RTUs whose rtu_code is the empty string", async () => {
    if (!pool) throw new Error("pool not initialised");
    const client = await pool.connect();
    const code = `${PREFIX}empty-${Math.random().toString(16).slice(2, 10)}`;
    try {
      await client.query("BEGIN");
      const first = await client.query(
        `INSERT INTO bms.rtus (organization_id, location_id, code, display_name, rtu_code)
         VALUES ($1, $2, $3, 'F4.60 empty A', '')`,
        [organizationId, locationId, `${code}-a`],
      );
      const second = await client.query(
        `INSERT INTO bms.rtus (organization_id, location_id, code, display_name, rtu_code)
         VALUES ($1, $2, $3, 'F4.60 empty B', '')`,
        [organizationId, locationId, `${code}-b`],
      );
      expect(first.rowCount).toBe(1);
      expect(
        second.rowCount,
        "two '' rows must both be accepted. '' means NO code — " +
          "apps/ingest/src/host/bindings.ts:414 skips it as missing-rtu-code — and it is the " +
          "only way a PATCH can clear the column, because the body is optional-but-not-nullable. " +
          "This is the assertion that reddens if the predicate loses AND rtu_code <> ''.",
      ).toBe(1);
    } finally {
      try {
        await client.query("ROLLBACK");
      } finally {
        client.release();
      }
    }
  });

  it("still accepts two RTUs whose rtu_code is NULL", async () => {
    if (!pool) throw new Error("pool not initialised");
    const client = await pool.connect();
    const code = `${PREFIX}null-${Math.random().toString(16).slice(2, 10)}`;
    try {
      await client.query("BEGIN");
      const first = await client.query(
        `INSERT INTO bms.rtus (organization_id, location_id, code, display_name, rtu_code)
         VALUES ($1, $2, $3, 'F4.60 null A', NULL)`,
        [organizationId, locationId, `${code}-a`],
      );
      const second = await client.query(
        `INSERT INTO bms.rtus (organization_id, location_id, code, display_name, rtu_code)
         VALUES ($1, $2, $3, 'F4.60 null B', NULL)`,
        [organizationId, locationId, `${code}-b`],
      );
      expect(first.rowCount).toBe(1);
      // Weaker than the '' control, deliberately: Postgres treats NULLs as
      // distinct by default, so this survives a `WHERE true` mutation. It
      // catches an expression index over coalesce(rtu_code,'') or NULLS NOT
      // DISTINCT — the mutation that would take down hierarchy-seed.ts's 44
      // NULL-coded RTUs.
      expect(second.rowCount, "two NULL rows must both be accepted").toBe(1);
    } finally {
      try {
        await client.query("ROLLBACK");
      } finally {
        client.release();
      }
    }
  });

  it("leaked nothing: no probe row survived, counted as bms_fleet", async () => {
    if (!pool) throw new Error("pool not initialised");
    const { rows } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM bms.rtus WHERE code LIKE $1`,
      [`${PREFIX}%`],
    );
    expect(
      rows[0]?.n,
      "a case that opened a transaction and merely returned would have COMMITTED these rows " +
        "into every later suite's view (tests/f3.60-withrollback-cases-roll-back.test.ts).",
    ).toBe(0);
  });
});
