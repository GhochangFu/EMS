import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  openIntegrationPool,
  requireIntegrationDb,
  resolveIntegrationRoleUrl,
} from "../apps/api/src/testing/integration-db-gate.js";

/**
 * `F3.32d` / ADR 0082 decisions 1 and 4 — what migration `0089` guarantees
 * against a real database (plan U1). The static twin
 * `tests/f3.32d-mimic-domain-symbols-and-roles.test.ts` asserts the migration's
 * text; this asserts what Postgres enforces.
 *
 * Lifecycle: superuser pool, one held client, every case inside a transaction
 * that is always rolled back — nothing commits. The fixture organization is
 * written by the superuser inside that transaction, so the suite needs no seed.
 * The probes then run as `bms_tenant` under the tenant GUC: the role the API
 * writes layouts as. The first case proves the new `bms.asset_roles` rows are
 * present, active and readable by that role — not that the `SET ROLE` bracket
 * is needed for it (the table has no RLS; `0041`'s grants decide visibility).
 */
const connectionString = process.env.DATABASE_URL;

requireIntegrationDb({
  item: "F3.32d",
  label: "mimic domain symbols and role codes tests",
  because:
    "the symbol CHECK and the role_code foreign key are things Postgres enforces, and the " +
    "eighteen role codes are rows only a migrated database holds, so a green run without a " +
    "database asserts nothing about any of them.",
});

const RUN = randomUUID().slice(0, 8);
const has = connectionString !== undefined && connectionString !== "";

const NEW_SYMBOLS = [
  "transformer", "breaker", "switchboard", "generator", "meter", "motor",
  "ups", "battery", "rack", "chiller", "ahu", "fan",
  "compressor", "boiler", "sensor", "lamp", "lift",
] as const;

const NEW_CODES = [
  "dg-set", "secondary-pump", "ups", "battery", "pdu", "it-rack", "crac",
  "air-compressor", "air-dryer", "air-receiver", "air-header",
  "ambient-station", "indoor-air", "stack-monitor", "effluent-monitor",
  "lighting", "lifts", "fire-pump",
] as const;

type IntegrationPool = Awaited<ReturnType<typeof openIntegrationPool>>;
type Rows = { rows: Array<Record<string, unknown>> };
type Run = (sql: string, params?: unknown[]) => Promise<Rows>;
type IntegrationClient = {
  query: (sql: string, params?: unknown[]) => Promise<Rows>;
  release: () => void;
};

describe.skipIf(!has)("F3.32d — migration 0089 against a live database", () => {
  let pool: IntegrationPool;
  let client: IntegrationClient;

  beforeAll(async () => {
    pool = await openIntegrationPool(
      resolveIntegrationRoleUrl(connectionString as string, "superuser", process.env),
      "F3.32d",
    );
    client = (await pool.connect()) as unknown as IntegrationClient;
  });

  afterAll(async () => {
    client?.release();
    await pool?.end();
  });

  /**
   * Runs `body` inside a transaction that is always rolled back: a fixture
   * organization and layout, then `bms_tenant` under that organization's GUC.
   */
  const inTx = async (body: (run: Run, org: string, layout: string) => Promise<void>): Promise<void> => {
    const run: Run = (sql, params) => client.query(sql, params);
    await client.query("BEGIN");
    try {
      const org = (
        await run(`INSERT INTO bms.organizations (code, name, currency) VALUES ($1, $2, 'INR') RETURNING id`, [
          `F332D${RUN}`.toUpperCase(),
          `F3.32d fixture ${RUN}`,
        ])
      ).rows[0]?.id as string;
      await run("SET LOCAL ROLE bms_tenant");
      await run(`SET LOCAL app.current_organization = '${org}'`);
      const layout = (
        await run(
          `INSERT INTO bms.mimic_layouts (organization_id, name, slug, canvas_w, canvas_h)
           VALUES ($1, $2, $3, 120, 80) RETURNING id`,
          [org, `F3.32d ${RUN}`, `f332d-${RUN}`],
        )
      ).rows[0]?.id as string;
      await body(run, org, layout);
    } finally {
      await client.query("ROLLBACK");
    }
  };

  const INSERT_UNIT = `INSERT INTO bms.mimic_layout_nodes
     (organization_id, layout_id, key, kind, symbol, label, role_code, x, y, w, h)
     VALUES ($1, $2, $3, 'unit', $4, $5, $6, 0, 0, 10, 10)`;

  /** Runs `sql` under a SAVEPOINT and returns the error it raised (empty if none). Probed without
   * `RETURNING`, which can report an RLS refusal for a write that succeeded. */
  const probe = async (run: Run, sql: string, params: unknown[]): Promise<{ code?: string; message: string }> => {
    await run("SAVEPOINT probe");
    let code: string | undefined;
    let message = "";
    try {
      await run(sql, params);
    } catch (err) {
      code = (err as NodeJS.ErrnoException | undefined)?.code;
      message = err instanceof Error ? err.message : String(err);
    }
    await run("ROLLBACK TO SAVEPOINT probe");
    return { code, message };
  };

  it("the tenant sees all eighteen new role codes, active", async () => {
    await inTx(async (run) => {
      const role = await run("SELECT current_user AS u");
      expect(role.rows[0]?.u).toBe("bms_tenant");
      const rows = await run(
        `SELECT code FROM bms.asset_roles WHERE code = ANY($1::text[]) AND active = true ORDER BY code`,
        [[...NEW_CODES]],
      );
      expect(rows.rows.map((r) => r.code)).toEqual([...NEW_CODES].sort());
    });
  });

  it("_symbol_check accepts 'lift' (positive control for the refusal below)", async () => {
    await inTx(async (run, org, layout) => {
      const { code, message } = await probe(run, INSERT_UNIT, [org, layout, "lift", "lift", "Lift", null]);
      expect(message, `'lift' must be accepted (code ${code})`).toBe("");
      // The probe rolls back to its savepoint; write it once for real to read it back.
      await run(INSERT_UNIT, [org, layout, "lift", "lift", "Lift", null]);
      const back = await run(`SELECT symbol FROM bms.mimic_layout_nodes WHERE layout_id = $1`, [layout]);
      expect(back.rows).toEqual([{ symbol: "lift" }]);
    });
  });

  it("_symbol_check accepts every one of the seventeen new symbols", async () => {
    await inTx(async (run, org, layout) => {
      for (const symbol of NEW_SYMBOLS) {
        const { message } = await probe(run, INSERT_UNIT, [org, layout, `s_${symbol}`, symbol, symbol, null]);
        expect(message, `'${symbol}' must be accepted`).toBe("");
      }
    });
  });

  it("_symbol_check refuses 'panel' with 23514, naming the constraint", async () => {
    await inTx(async (run, org, layout) => {
      const { code, message } = await probe(run, INSERT_UNIT, [org, layout, "panel_sym", "panel", "Panel", null]);
      expect(code, message).toBe("23514");
      expect(message).toContain("mimic_layout_nodes_symbol_check");
      expect(message).not.toContain("mimic_layout_nodes_kind_fields_check");
    });
  });

  it("role_code accepts 'dg-set' (positive control for the refusal below)", async () => {
    await inTx(async (run, org, layout) => {
      const { code, message } = await probe(run, INSERT_UNIT, [org, layout, "dg", "generator", "DG Set", "dg-set"]);
      expect(message, `'dg-set' must be accepted (code ${code})`).toBe("");
    });
  });

  it("role_code refuses 'dg_set' with 23503, naming the role_code foreign key", async () => {
    await inTx(async (run, org, layout) => {
      const { code, message } = await probe(run, INSERT_UNIT, [org, layout, "dg", "generator", "DG Set", "dg_set"]);
      expect(code, message).toBe("23503");
      expect(message).toContain("mimic_layout_nodes_role_code_fkey");
    });
  });

  it("the stored constraint lists twenty-nine symbols", async () => {
    const def = await client.query(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid = 'bms.mimic_layout_nodes'::regclass AND conname = 'mimic_layout_nodes_symbol_check'`,
    );
    expect(def.rows).toHaveLength(1);
    const listed = [...String(def.rows[0]?.def).matchAll(/'([a-z_]+)'::/g)].map((m) => m[1]);
    expect(listed).toHaveLength(29);
    expect(listed.slice(12)).toEqual([...NEW_SYMBOLS]);
  });
});
