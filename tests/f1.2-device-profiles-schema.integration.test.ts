import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  openIntegrationPool,
  requireIntegrationDb,
  resolveIntegrationRoleUrl,
} from "../apps/api/src/testing/integration-db-gate.js";

/**
 * `F1.2` / ADR 0141 decisions 10, 12, 13 (plan T2.1) — what migration `0164`
 * (`bms.device_profiles`, `bms.organizations.default_poll_interval_ms`)
 * guarantees against a real database. `tests/f1.2-device-profiles-schema.test.ts`
 * asserts the text; this asserts what Postgres enforces.
 *
 * The `tests/e1.9c-ml-finding-paragraphs-schema.integration.test.ts` lifecycle:
 * one held client on the superuser pool, every case inside `BEGIN … ROLLBACK`, a
 * role reached by `SET LOCAL ROLE` plus the tenant setting, and a
 * `SAVEPOINT`-protected probe per refusal. Nothing commits.
 */
const connectionString = process.env.DATABASE_URL;

requireIntegrationDb({
  item: "F1.2",
  label: "device profiles schema tests",
  because:
    "row security, the tenant grants from 0041's default privileges and each CHECK are things " +
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

const register = (i: number) => ({ sourceKey: `key_${i}`, table: "holding", address: i * 2, type: "uint32" });
const registers = (count: number): string => JSON.stringify(Array.from({ length: count }, (_, i) => register(i)));
const SOURCE = JSON.stringify({ document: "User manual", revision: "Rev 2", pages: "40-44" });

const INSERT_PLAIN = `INSERT INTO bms.device_profiles
  (organization_id, protocol, code, version, vendor, model, source, registers, stock_code, stock_version)
  VALUES ($1, $2, $3, $4, 'Vendor', 'Model', $5::jsonb, $6::jsonb, $7, $8)`;
/**
 * `RETURNING` makes Postgres apply the SELECT policy's USING to the new row, so
 * a cross-organization probe must use `INSERT_PLAIN`: only WITH CHECK can
 * refuse it there (code review, PR 2).
 */
const INSERT = `${INSERT_PLAIN} RETURNING id`;

/** A good row for `org`; `over` replaces positional parameters by name. */
const good = (org: string, over: Partial<Record<"protocol" | "code" | "version" | "source" | "registers" | "stockCode" | "stockVersion", unknown>> = {}): unknown[] => [
  org,
  "protocol" in over ? over.protocol : "modbus_tcp",
  "code" in over ? over.code : "f12-probe-meter",
  "version" in over ? over.version : 1,
  "source" in over ? over.source : SOURCE,
  "registers" in over ? over.registers : registers(2),
  "stockCode" in over ? over.stockCode : null,
  "stockVersion" in over ? over.stockVersion : null,
];

describe.skipIf(!has)("F1.2 — bms.device_profiles and the organization poll interval against a live database", () => {
  let pool: IntegrationPool;
  let client: IntegrationClient;
  let orgA = "";
  let orgB = "";

  const first = async (sql: string, params: unknown[], what: string): Promise<string> => {
    const r = await client.query(sql, params);
    const id = r.rows[0]?.id as string | undefined;
    if (!id) throw new Error(`F1.2: needs a seeded ${what} — run pnpm db:seed.`);
    return id;
  };

  beforeAll(async () => {
    pool = await openIntegrationPool(
      resolveIntegrationRoleUrl(connectionString as string, "superuser", process.env),
      "F1.2",
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

  const asRole = async (run: Run, role: string, org: string | null): Promise<void> => {
    await run(`SET LOCAL ROLE ${role}`);
    if (org !== null) await run(`SET LOCAL app.current_organization = '${org}'`);
  };

  it("(1) a good row lands as bms_tenant under its own organization, with verified false by default", async () => {
    await inTx("bms_tenant", orgA, async (run) => {
      const id = (await run(INSERT, good(orgA))).rows[0]?.id;
      expect(id).toBeTruthy();
      const row = (await run(`SELECT verified, jsonb_array_length(registers) AS n FROM bms.device_profiles WHERE id = $1`, [id])).rows[0];
      expect(row).toEqual({ verified: false, n: 2 });
      // A stock import carries both stock fields.
      expect((await run(INSERT, good(orgA, { code: "f12-stock", stockCode: "pm5110", stockVersion: 1 }))).rows).toHaveLength(1);
      // 256 registers is the bound, inclusive.
      expect((await run(INSERT, good(orgA, { code: "f12-wide", registers: registers(256) }))).rows).toHaveLength(1);
    });
  });

  it("(2) organization B's bms_tenant neither reads nor writes A's profile; A reads its own", async () => {
    await inTx(null, null, async (run) => {
      await run(INSERT, good(orgA, { code: "f12-tenant-a" }));
      await asRole(run, "bms_tenant", orgB);
      const seen = (await run(`SELECT 1 FROM bms.device_profiles WHERE code = 'f12-tenant-a'`)).rows;
      expect(seen).toHaveLength(0);
      // No RETURNING: WITH CHECK alone refuses B's row for A.
      const insert = await probe(run, INSERT_PLAIN, good(orgA, { code: "f12-from-b" }));
      expect(insert.code, insert.message).toBe("42501");
      expect(insert.message).toContain("row-level security");
    });
    await inTx(null, null, async (run) => {
      await run(INSERT, good(orgA, { code: "f12-tenant-a" }));
      await asRole(run, "bms_tenant", orgA);
      const seen = (await run(`SELECT organization_id FROM bms.device_profiles WHERE code = 'f12-tenant-a'`)).rows;
      expect(seen.map((r) => r.organization_id)).toEqual([orgA]);
    });
  });

  it("(2b) bms_tenant cannot update or delete even its own organization's profile (append-only, P2)", async () => {
    await inTx("bms_tenant", orgA, async (run) => {
      await run(INSERT, good(orgA, { code: "f12-own" }));
      for (const sql of [
        `UPDATE bms.device_profiles SET verified = true WHERE code = 'f12-own'`,
        `UPDATE bms.device_profiles SET registers = '[]'::jsonb WHERE code = 'f12-own'`,
        `DELETE FROM bms.device_profiles WHERE code = 'f12-own'`,
      ]) {
        const r = await probe(run, sql);
        expect(r.code, `${sql}: ${r.message}`).toBe("42501");
        expect(r.message).toContain("permission denied");
      }
    });
  });

  it("(2c) bms_fleet reads every organization's profiles and writes none; bms_auth reads none", async () => {
    await inTx(null, null, async (run) => {
      await run(INSERT, good(orgA, { code: "f12-fleet" }));
      await run(INSERT, good(orgB, { code: "f12-fleet" }));
      await asRole(run, "bms_fleet", null);
      const rows = (await run(`SELECT organization_id FROM bms.device_profiles WHERE code = 'f12-fleet'`)).rows;
      expect(rows.map((r) => r.organization_id).sort()).toEqual([orgA, orgB].sort());
      for (const [sql, params] of [
        [INSERT_PLAIN, good(orgA, { code: "f12-fleet-new" })],
        [`UPDATE bms.device_profiles SET verified = true WHERE code = 'f12-fleet'`, []],
        [`DELETE FROM bms.device_profiles WHERE code = 'f12-fleet'`, []],
      ] as Array<[string, unknown[]]>) {
        const r = await probe(run, sql, params);
        expect(r.code, `${sql.slice(0, 40)}: ${r.message}`).toBe("42501");
      }
    });
    await inTx("bms_auth", orgA, async (run) => {
      const r = await probe(run, `SELECT 1 FROM bms.device_profiles LIMIT 1`);
      expect(r.code, r.message).toBe("42501");
    });
  });

  it("(3) with no setting bms_tenant reads nothing, and bms_owner cannot insert (FORCE)", async () => {
    await inTx(null, null, async (run) => {
      await run(INSERT, good(orgA, { code: "f12-unset" }));
      await asRole(run, "bms_tenant", null);
      expect((await run(`SELECT 1 FROM bms.device_profiles WHERE code = 'f12-unset'`)).rows).toHaveLength(0);
    });
    await inTx("bms_owner", null, async (run) => {
      const r = await probe(run, INSERT_PLAIN, good(orgA, { code: "f12-owner" }));
      expect(r.code, r.message).toBe("42501");
      expect(r.message).toContain("row-level security");
    });
  });

  it("(4) each CHECK and the unique key refuse their bad row", async () => {
    await inTx(null, null, async (run) => {
      await run(INSERT, good(orgA, { code: "f12-dup" }));
      for (const [label, params, code, constraint] of [
        ["version 0", good(orgA, { code: "f12-v0", version: 0 }), "23514", "device_profiles_version_check"],
        ["no registers", good(orgA, { code: "f12-empty", registers: "[]" }), "23514", "device_profiles_registers_check"],
        ["257 registers", good(orgA, { code: "f12-257", registers: registers(257) }), "23514", "device_profiles_registers_check"],
        ["registers an object", good(orgA, { code: "f12-obj", registers: "{}" }), "23514", "device_profiles_registers_check"],
        ["protocol mqtt", good(orgA, { code: "f12-mqtt", protocol: "mqtt" }), "23514", "device_profiles_protocol_check"],
        ["code with a space", good(orgA, { code: "f12 space" }), "23514", "device_profiles_code_check"],
        ["source an array", good(orgA, { code: "f12-src", source: "[]" }), "23514", "device_profiles_source_check"],
        ["stock code alone", good(orgA, { code: "f12-sc", stockCode: "pm5110" }), "23514", "device_profiles_stock_check"],
        ["stock version alone", good(orgA, { code: "f12-sv", stockVersion: 1 }), "23514", "device_profiles_stock_check"],
        ["stock version 0", good(orgA, { code: "f12-s0", stockCode: "pm5110", stockVersion: 0 }), "23514", "device_profiles_stock_check"],
        ["duplicate code and version", good(orgA, { code: "f12-dup" }), "23505", "device_profiles_org_protocol_code_version_key"],
      ] as Array<[string, unknown[], string, string]>) {
        const r = await probe(run, INSERT, params);
        expect(r.code, `${label}: ${r.message}`).toBe(code);
        expect(r.message, label).toContain(constraint);
      }
      // Every CHECK and the unique key pass on NULL, so NOT NULL is what holds these.
      for (const column of ["protocol", "code", "version", "source", "registers"] as const) {
        const r = await probe(run, INSERT, good(orgA, { code: `f12-null-${column}`, [column]: null }));
        expect(r.code, `${column} NULL: ${r.message}`).toBe("23502");
        expect(r.message, column).toContain(`"${column}"`);
      }
      for (const column of ["vendor", "model"]) {
        const r = await probe(
          run,
          `INSERT INTO bms.device_profiles (organization_id, protocol, code, version, vendor, model, source, registers)
            VALUES ($1, 'modbus_tcp', 'f12-null-text', 1, $2, $3, $4::jsonb, $5::jsonb)`,
          [orgA, column === "vendor" ? null : "V", column === "model" ? null : "M", SOURCE, registers(1)],
        );
        expect(r.code, `${column} NULL: ${r.message}`).toBe("23502");
      }
      // The good twins: the next version of the same code, and the same code in another organization.
      expect((await run(INSERT, good(orgA, { code: "f12-dup", version: 2 }))).rows).toHaveLength(1);
      expect((await run(INSERT, good(orgB, { code: "f12-dup" }))).rows).toHaveLength(1);
    });
  });

  it("(5) default_poll_interval_ms refuses 999 and 3,600,001, and accepts NULL, 1,000, 60,000 and 3,600,000", async () => {
    await inTx(null, null, async (run) => {
      const set = (value: number | null) =>
        probe(run, `UPDATE bms.organizations SET default_poll_interval_ms = $1 WHERE id = $2 RETURNING id`, [value, orgA]);
      for (const value of [999, 3_600_001, 0, -1]) {
        const r = await set(value);
        expect(r.code, `${value}: ${r.message}`).toBe("23514");
        expect(r.message).toContain("organizations_default_poll_interval_ms_check");
      }
      for (const value of [null, 1_000, 60_000, 3_600_000]) {
        const r = await set(value);
        expect(r.code, `${String(value)}: ${r.message}`).toBeUndefined();
        expect(r.rows).toBe(1);
      }
      const column = (
        await run(
          `SELECT is_nullable, column_default FROM information_schema.columns
            WHERE table_schema = 'bms' AND table_name = 'organizations' AND column_name = 'default_poll_interval_ms'`,
        )
      ).rows[0];
      expect(column).toEqual({ is_nullable: "YES", column_default: null });
    });
  });
});
