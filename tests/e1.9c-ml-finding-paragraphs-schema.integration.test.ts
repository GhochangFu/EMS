import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  openIntegrationPool,
  requireIntegrationDb,
  resolveIntegrationRoleUrl,
} from "../apps/api/src/testing/integration-db-gate.js";

/**
 * `E1.9c` / ADR 0135 Amendment 8 decision 7 (plan T3.1; owner ruling Q3 (a)) —
 * what migration `0162` (`bms.ml_finding_paragraphs`) guarantees against a real
 * database. `tests/e1.9c-ml-finding-paragraphs-schema.test.ts` asserts the text;
 * this asserts what Postgres enforces.
 *
 * The `tests/f4.359-maintenance-windows-schema.integration.test.ts` lifecycle:
 * one held client on the superuser pool, every case inside `BEGIN … ROLLBACK`, a
 * role reached by `SET LOCAL ROLE` plus the tenant setting, and a
 * `SAVEPOINT`-protected probe per refusal. Nothing commits.
 */
const connectionString = process.env.DATABASE_URL;

requireIntegrationDb({
  item: "E1.9c",
  label: "ml finding paragraphs schema tests",
  because:
    "row security, the revoked UPDATE, bms_fleet's read-only grant and each CHECK are things " +
    "Postgres enforces, so a green run without a database asserts nothing about any of them.",
});

const has = connectionString !== undefined && connectionString !== "";

type Rows = { rows: Array<Record<string, unknown>>; rowCount?: number | null };
type Run = (sql: string, params?: unknown[]) => Promise<Rows>;
type IntegrationPool = Awaited<ReturnType<typeof openIntegrationPool>>;
type IntegrationClient = {
  query: (sql: string, params?: unknown[]) => Promise<Rows>;
  release: () => void;
};

/** A made-up 64-hex hash; `n` keeps two rows' keys apart. */
const hashOf = (n: number): string => n.toString(16).padStart(64, "0");

const INSERT = `INSERT INTO bms.ml_finding_paragraphs (organization_id, kind, facts_hash, status, paragraph, reason, attempts)
  VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING RETURNING id`;

describe.skipIf(!has)("E1.9c — bms.ml_finding_paragraphs against a live database", () => {
  let pool: IntegrationPool;
  let client: IntegrationClient;
  let orgA = "";
  let orgB = "";

  const first = async (sql: string, params: unknown[], what: string): Promise<string> => {
    const r = await client.query(sql, params);
    const id = r.rows[0]?.id as string | undefined;
    if (!id) throw new Error(`E1.9c: needs a seeded ${what} — run pnpm db:seed.`);
    return id;
  };

  beforeAll(async () => {
    pool = await openIntegrationPool(
      resolveIntegrationRoleUrl(connectionString as string, "superuser", process.env),
      "E1.9c",
    );
    client = (await pool.connect()) as unknown as IntegrationClient;
    orgA = await first(`SELECT id FROM bms.organizations WHERE code = $1`, ["ESKOM"], "ESKOM organization");
    orgB = await first(`SELECT id FROM bms.organizations WHERE code = $1`, ["PHEWB"], "PHEWB organization");
  });

  afterAll(async () => {
    client?.release();
    await pool?.end();
  });

  const inTx = async (role: string | null, org: string | null, body: (run: Run) => Promise<void>): Promise<void> => {
    await client.query("BEGIN");
    try {
      if (role !== null) await client.query(`SET LOCAL ROLE ${role}`);
      if (org !== null) await client.query(`SET LOCAL app.current_organization = '${org}'`);
      await body((sql, params) => client.query(sql, params));
    } finally {
      await client.query("ROLLBACK");
    }
  };

  const probe = async (run: Run, sql: string, params: unknown[] = []): Promise<{ code: string | undefined; message: string; rows: number }> => {
    await run("SAVEPOINT probe");
    let code: string | undefined;
    let message = "";
    let rows = 0;
    try {
      rows = (await run(sql, params)).rows.length;
    } catch (err) {
      code = (err as NodeJS.ErrnoException | undefined)?.code;
      message = err instanceof Error ? err.message : String(err);
    }
    await run("ROLLBACK TO SAVEPOINT probe");
    return { code, message, rows };
  };

  /** Plants one row per organization as the superuser (row security does not bind it), inside the case's transaction. */
  const plant = async (run: Run): Promise<void> => {
    await run(INSERT, [orgA, "forecasts", hashOf(1), "ok", "[A1] is the coldest.", null, 1]);
    await run(INSERT, [orgB, "forecasts", hashOf(2), "failed", null, "timeout", 1]);
  };

  /** The superuser plants, then the case switches role and setting for the rest of the transaction. */
  const asRole = async (run: Run, role: string, org: string | null): Promise<void> => {
    await run(`SET LOCAL ROLE ${role}`);
    if (org !== null) await run(`SET LOCAL app.current_organization = '${org}'`);
  };

  it("(1) bms_tenant under A's setting reads A's rows and none of B's; with no setting it reads none", async () => {
    await inTx(null, null, async (run) => {
      await plant(run);
      await asRole(run, "bms_tenant", orgA);
      const rows = (await run(`SELECT organization_id FROM bms.ml_finding_paragraphs WHERE facts_hash IN ($1, $2)`, [hashOf(1), hashOf(2)])).rows;
      expect(rows.map((r) => r.organization_id)).toEqual([orgA]);
    });
    await inTx(null, null, async (run) => {
      await plant(run);
      await asRole(run, "bms_tenant", null);
      const rows = (await run(`SELECT 1 FROM bms.ml_finding_paragraphs WHERE facts_hash IN ($1, $2)`, [hashOf(1), hashOf(2)])).rows;
      expect(rows).toHaveLength(0);
    });
  });

  it("(2) bms_tenant: an insert lands once (ON CONFLICT DO NOTHING), DELETE works, UPDATE is refused", async () => {
    await inTx("bms_tenant", orgA, async (run) => {
      expect((await run(INSERT, [orgA, "anomalies", hashOf(3), "rejected", null, "tone", 1])).rows).toHaveLength(1);
      expect((await run(INSERT, [orgA, "anomalies", hashOf(3), "rejected", null, "tone", 1])).rows).toHaveLength(0);
      const update = await probe(run, `UPDATE bms.ml_finding_paragraphs SET attempts = 2 WHERE facts_hash = $1`, [hashOf(3)]);
      expect(update.code, update.message).toBe("42501");
      const del = await run(`DELETE FROM bms.ml_finding_paragraphs WHERE facts_hash = $1 RETURNING id`, [hashOf(3)]);
      expect(del.rows).toHaveLength(1);
    });
  });

  it("(3) an insert for B under A's setting fails WITH CHECK", async () => {
    await inTx("bms_tenant", orgA, async (run) => {
      const r = await probe(run, INSERT, [orgB, "forecasts", hashOf(4), "failed", null, "timeout", 1]);
      expect(r.code, r.message).toBe("42501");
      expect(r.message).toContain("row-level security");
    });
  });

  it("(4) bms_fleet reads both organizations' rows and cannot insert, update or delete", async () => {
    await inTx(null, null, async (run) => {
      await plant(run);
      await asRole(run, "bms_fleet", null);
      const rows = (await run(`SELECT organization_id FROM bms.ml_finding_paragraphs WHERE facts_hash IN ($1, $2) ORDER BY facts_hash`, [hashOf(1), hashOf(2)])).rows;
      expect(rows.map((r) => r.organization_id)).toEqual([orgA, orgB]);
      for (const sql of [
        INSERT,
        `UPDATE bms.ml_finding_paragraphs SET attempts = 2 WHERE facts_hash = $1`,
        `DELETE FROM bms.ml_finding_paragraphs WHERE facts_hash = $1`,
      ]) {
        const params = sql === INSERT ? [orgA, "forecasts", hashOf(5), "failed", null, "timeout", 1] : [hashOf(1)];
        const r = await probe(run, sql, params);
        expect(r.code, `${sql.slice(0, 30)}: ${r.message}`).toBe("42501");
      }
    });
  });

  it("(5) bms_auth cannot select", async () => {
    await inTx("bms_auth", orgA, async (run) => {
      const r = await probe(run, `SELECT 1 FROM bms.ml_finding_paragraphs LIMIT 1`);
      expect(r.code, r.message).toBe("42501");
    });
  });

  it("(6) bms_owner with no setting cannot insert (FORCE)", async () => {
    await inTx("bms_owner", null, async (run) => {
      const r = await probe(run, INSERT, [orgA, "forecasts", hashOf(6), "failed", null, "timeout", 1]);
      expect(r.code, r.message).toBe("42501");
    });
  });

  it("(7) each CHECK refuses its bad row; the good twin lands", async () => {
    await inTx(null, null, async (run) => {
      const long = "x".repeat(601);
      for (const [label, params, constraint] of [
        ["kind", [orgA, "forecast", hashOf(7), "failed", null, "timeout", 1], "ml_finding_paragraphs_kind_check"],
        ["status", [orgA, "forecasts", hashOf(7), "error", null, "timeout", 1], "ml_finding_paragraphs_status_check"],
        ["upper-case hash", [orgA, "forecasts", "A".repeat(64), "failed", null, "timeout", 1], "ml_finding_paragraphs_facts_hash_check"],
        ["short hash", [orgA, "forecasts", "a".repeat(63), "failed", null, "timeout", 1], "ml_finding_paragraphs_facts_hash_check"],
        ["failed with text", [orgA, "forecasts", hashOf(7), "failed", "text", "timeout", 1], "ml_finding_paragraphs_paragraph_check"],
        ["ok with no text", [orgA, "forecasts", hashOf(7), "ok", null, null, 1], "ml_finding_paragraphs_paragraph_check"],
        ["601 characters", [orgA, "forecasts", hashOf(7), "ok", long, null, 1], "ml_finding_paragraphs_paragraph_check"],
        ["ok with a reason", [orgA, "forecasts", hashOf(7), "ok", "text", "tone", 1], "ml_finding_paragraphs_reason_check"],
        ["failed with no reason", [orgA, "forecasts", hashOf(7), "failed", null, null, 1], "ml_finding_paragraphs_reason_check"],
        ["attempts 0", [orgA, "forecasts", hashOf(7), "failed", null, "timeout", 0], "ml_finding_paragraphs_attempts_check"],
      ] as Array<[string, unknown[], string]>) {
        const r = await probe(run, INSERT, params);
        expect(r.code, `${label}: ${r.message}`).toBe("23514");
        expect(r.message, label).toContain(constraint);
      }
      expect((await run(INSERT, [orgA, "forecasts", hashOf(7), "ok", "x".repeat(600), null, 1])).rows).toHaveLength(1);
      expect((await run(INSERT, [orgA, "anomalies", hashOf(7), "failed", null, "timeout", 3])).rows).toHaveLength(1);
    });
  });

  it("(8) attempts defaults to 1, and the schema ml marker still reads version 3", async () => {
    await inTx(null, null, async (run) => {
      await run(
        `INSERT INTO bms.ml_finding_paragraphs (organization_id, kind, facts_hash, status, reason) VALUES ($1, 'forecasts', $2, 'failed', 'timeout')`,
        [orgA, hashOf(8)],
      );
      const row = (await run(`SELECT attempts FROM bms.ml_finding_paragraphs WHERE facts_hash = $1`, [hashOf(8)])).rows[0];
      expect(row?.attempts).toBe(1);
      const marker = (await run(`SELECT obj_description('ml'::regnamespace, 'pg_namespace') AS c`)).rows[0];
      expect(marker?.c).toBe("bms-ml-schema-version=3");
    });
  });
});
