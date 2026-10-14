import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  openIntegrationPool,
  requireIntegrationDb,
  resolveIntegrationRoleUrl,
} from "../apps/api/src/testing/integration-db-gate.js";

/**
 * `F3.80` — what migration `0109` guarantees against a real database (plan
 * Task 1.2, I1-I9). `tests/f3.80-network-mimics-migration.test.ts` asserts the
 * migration's text; this asserts what Postgres enforces.
 *
 * The `tests/f3.74-point-key-states-schema.integration.test.ts` lifecycle:
 * superuser pool, one held client, a `SAVEPOINT`-protected probe per refusal,
 * and every case inside a `BEGIN` … `ROLLBACK` that always rolls back — nothing
 * commits.
 */
const connectionString = process.env.DATABASE_URL;

requireIntegrationDb({
  item: "F3.80",
  label: "network mimics migration tests",
  because:
    "the switching units CHECK, the five-tone CHECK, the eight roles and the tenant revoke " +
    "are things Postgres enforces, so a green run without a database asserts nothing about any of them.",
});

const RUN = randomUUID().slice(0, 8);
const has = connectionString !== undefined && connectionString !== "";

type IntegrationPool = Awaited<ReturnType<typeof openIntegrationPool>>;
type Rows = { rows: Array<Record<string, unknown>> };
type Run = (sql: string, params?: unknown[]) => Promise<Rows>;
type IntegrationClient = {
  query: (sql: string, params?: unknown[]) => Promise<Rows>;
  release: () => void;
};
type NodeSpec = { kind?: string; symbol?: string | null; role?: string | null; tone?: string | null; isSwitching?: boolean };

describe.skipIf(!has)("F3.80 — is_switching, the position roles and the five-tone CHECK against a live database", () => {
  let pool: IntegrationPool;
  let client: IntegrationClient;
  let orgA = "";
  let orgB = "";
  let pointKey = "";

  beforeAll(async () => {
    pool = await openIntegrationPool(
      resolveIntegrationRoleUrl(connectionString as string, "superuser", process.env),
      "F3.80",
    );
    client = (await pool.connect()) as unknown as IntegrationClient;
    const orgs = await client.query(`SELECT id FROM bms.organizations ORDER BY created_at, code LIMIT 2`);
    if (orgs.rows.length < 2) throw new Error("F3.80: needs two bms.organizations rows — run pnpm db:seed.");
    orgA = orgs.rows[0]?.id as string;
    orgB = orgs.rows[1]?.id as string;
    const key = await client.query(`SELECT code FROM bms.point_keys WHERE code = 'breaker_main'`);
    pointKey = key.rows[0]?.code as string;
    if (!pointKey) throw new Error("F3.80: needs the seeded bms.point_keys row breaker_main — run pnpm db:seed.");
  });

  afterAll(async () => {
    client?.release();
    await pool?.end();
  });

  const setOrg = (org: string): Promise<Rows> => client.query(`SET LOCAL app.current_organization = '${org}'`);

  /** A transaction that is always rolled back, as the connection's superuser (no role switch). */
  const inTx = async (body: (run: Run) => Promise<void>): Promise<void> => {
    await client.query("BEGIN");
    try {
      await body((sql, params) => client.query(sql, params));
    } finally {
      await client.query("ROLLBACK");
    }
  };

  /** As `bms_owner` under GUC A (FORCE-bound), always rolled back. */
  const inOwnerTx = async (body: (run: Run) => Promise<void>): Promise<void> => {
    await inTx(async (run) => {
      await run("SET LOCAL ROLE bms_owner");
      await setOrg(orgA);
      await body(run);
    });
  };

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

  const INSERT_STATE = `INSERT INTO bms.point_key_states (point_key_code, value, label, tone) VALUES ($1, $2, $3, $4)`;

  const newLayout = async (run: Run, org: string, suffix: string): Promise<string> => {
    await setOrg(org);
    const row = await run(
      `INSERT INTO bms.mimic_layouts (organization_id, name, slug, canvas_w, canvas_h)
       VALUES ($1, $2, $3, 120, 80) RETURNING id`,
      [org, `F3.80 ${suffix}`, `f380-${RUN}-${suffix}`.toLowerCase()],
    );
    await setOrg(orgA);
    return row.rows[0]?.id as string;
  };

  const INSERT_NODE = `INSERT INTO bms.mimic_layout_nodes
     (organization_id, layout_id, key, kind, symbol, label, role_code, tone, x, y, w, h, is_switching)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $9, 0, 0, 10, 10, $8)`;

  const nodeParams = (org: string, layout: string, key: string, spec: NodeSpec = {}): unknown[] => [
    org,
    layout,
    key,
    spec.kind ?? "unit",
    spec.symbol === undefined ? "tank" : spec.symbol,
    `F3.80 ${key}`,
    spec.role === undefined ? null : spec.role,
    spec.isSwitching ?? false,
    spec.tone ?? null,
  ];

  it("I1 refuses a label with is_switching = true (23514, _switching_units_check)", async () => {
    await inOwnerTx(async (run) => {
      const layout = await newLayout(run, orgA, "i1");
      const ok = await probe(run, INSERT_NODE, nodeParams(orgA, layout, "l0", { kind: "label", symbol: null }));
      expect(ok.message, "a label with is_switching false is accepted").toBe("");
      const bad = await probe(run, INSERT_NODE, nodeParams(orgA, layout, "l1", { kind: "label", symbol: null, isSwitching: true }));
      expect(bad.code).toBe("23514");
      expect(bad.message).toContain("_switching_units_check");
      expect(bad.message).not.toContain("_flags_units_check");
    });
  });

  it("I2 refuses a panel with is_switching = true (23514, _switching_units_check)", async () => {
    await inOwnerTx(async (run) => {
      const layout = await newLayout(run, orgA, "i2");
      const ok = await probe(run, INSERT_NODE, nodeParams(orgA, layout, "p0", { kind: "panel", symbol: null, tone: "info" }));
      expect(ok.message, "a panel with is_switching false is accepted").toBe("");
      const bad = await probe(run, INSERT_NODE, nodeParams(orgA, layout, "p1", { kind: "panel", symbol: null, tone: "info", isSwitching: true }));
      expect(bad.code).toBe("23514");
      expect(bad.message).toContain("_switching_units_check");
      expect(bad.message).not.toContain("_flags_units_check");
    });
  });

  it("I3 accepts a unit with is_switching = true and reads it back true", async () => {
    await inOwnerTx(async (run) => {
      const layout = await newLayout(run, orgA, "i3");
      await run(INSERT_NODE, nodeParams(orgA, layout, "u1", { isSwitching: true }));
      const back = await run(`SELECT is_switching FROM bms.mimic_layout_nodes WHERE layout_id = $1`, [layout]);
      expect(back.rows).toEqual([{ is_switching: true }]);
    });
  });

  it("I4 a unit inserted without the column reads back false", async () => {
    await inOwnerTx(async (run) => {
      const layout = await newLayout(run, orgA, "i4");
      await run(
        `INSERT INTO bms.mimic_layout_nodes (organization_id, layout_id, key, kind, symbol, label, x, y, w, h)
         VALUES ($1, $2, 'u1', 'unit', 'tank', 'F3.80 u1', 0, 0, 10, 10)`,
        [orgA, layout],
      );
      const back = await run(`SELECT is_switching FROM bms.mimic_layout_nodes WHERE layout_id = $1`, [layout]);
      expect(back.rows).toEqual([{ is_switching: false }]);
    });
  });

  it("I5 under GUC A, refuses a switching unit stamped A on an organization-B layout (RLS, 42501)", async () => {
    await inOwnerTx(async (run) => {
      const own = await newLayout(run, orgA, "i5-own");
      const accepted = await probe(run, INSERT_NODE, nodeParams(orgA, own, "u", { isSwitching: true }));
      expect(accepted.message, "the positive control must be accepted").toBe("");
      const foreign = await newLayout(run, orgB, "i5-foreign");
      const refused = await probe(run, INSERT_NODE, nodeParams(orgA, foreign, "u", { isSwitching: true }));
      expect(refused.code, `expected a row-level security violation (got: ${refused.message})`).toBe("42501");
    });
  });

  it("I6 the eight position roles are active rows with sort orders 161-165, 265, 266, 570", async () => {
    const roles = await client.query(
      `SELECT code, sort_order FROM bms.asset_roles
        WHERE code IN ('ht-incomer-breaker','ht-outgoing-breaker','bus-coupler','isolator','dg-breaker','isolation-valve','control-valve','damper')
          AND active ORDER BY sort_order`,
    );
    expect(roles.rows).toEqual([
      { code: "ht-incomer-breaker", sort_order: 161 },
      { code: "ht-outgoing-breaker", sort_order: 162 },
      { code: "bus-coupler", sort_order: 163 },
      { code: "isolator", sort_order: 164 },
      { code: "dg-breaker", sort_order: 165 },
      { code: "isolation-valve", sort_order: 265 },
      { code: "control-valve", sort_order: 266 },
      { code: "damper", sort_order: 570 },
    ]);
  });

  it("I7 point_key_states accepts tone 'flowing' and 'shut'", async () => {
    await inTx(async (run) => {
      const flowing = await probe(run, INSERT_STATE, [pointKey, 7, "Flowing", "flowing"]);
      expect(flowing.message).toBe("");
      const shut = await probe(run, INSERT_STATE, [pointKey, 8, "Shut", "shut"]);
      expect(shut.message).toBe("");
    });
  });

  it("I8 refuses tone 'earthed' (23514, point_key_states_tone_check)", async () => {
    await inTx(async (run) => {
      const bad = await probe(run, INSERT_STATE, [pointKey, 9, "Earthed", "earthed"]);
      expect(bad.code).toBe("23514");
      expect(bad.message).toContain("point_key_states_tone_check");
    });
  });

  it("I9 bms_tenant cannot INSERT on point_key_states and can SELECT", async () => {
    const r = await client.query(
      `SELECT has_table_privilege('bms_tenant', 'bms.point_key_states', 'INSERT') AS ins,
              has_table_privilege('bms_tenant', 'bms.point_key_states', 'SELECT') AS sel`,
    );
    expect(r.rows).toEqual([{ ins: false, sel: true }]);
  });
});
