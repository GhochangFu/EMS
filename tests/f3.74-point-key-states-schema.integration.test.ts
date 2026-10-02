import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  openIntegrationPool,
  requireIntegrationDb,
  resolveIntegrationRoleUrl,
} from "../apps/api/src/testing/integration-db-gate.js";

/**
 * `F3.74` — what migration `0097` guarantees against a real database (plan
 * Task 1.2, I1-I9). `tests/f3.74-point-key-states-schema.test.ts` asserts the
 * migration's text; this asserts what Postgres enforces.
 *
 * The `tests/f3.32c-mimic-layouts-schema.integration.test.ts` lifecycle:
 * superuser pool, one held client, a `SAVEPOINT`-protected probe per refusal,
 * and every case inside a `BEGIN` … `ROLLBACK` that always rolls back — nothing
 * commits. (The node-pg client's own ROLLBACK is used instead of drizzle's
 * `withRollback`: the cases switch role with `SET LOCAL ROLE`, which needs the
 * raw transaction.)
 */
const connectionString = process.env.DATABASE_URL;

requireIntegrationDb({
  item: "F3.74",
  label: "point key states schema tests",
  because:
    "the tone CHECK, the unique pair, the foreign key, the tenant revoke and the layout flags " +
    "CHECK are things Postgres enforces, so a green run without a database asserts nothing about any of them.",
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
type NodeSpec = { kind?: string; symbol?: string | null; role?: string | null; tone?: string | null; fanOut?: boolean; isSource?: boolean };

describe.skipIf(!has)("F3.74 — bms.point_key_states, the breaker roles and the layout flags against a live database", () => {
  let pool: IntegrationPool;
  let client: IntegrationClient;
  let orgA = "";
  let orgB = "";
  let pointKey = "";

  beforeAll(async () => {
    pool = await openIntegrationPool(
      resolveIntegrationRoleUrl(connectionString as string, "superuser", process.env),
      "F3.74",
    );
    client = (await pool.connect()) as unknown as IntegrationClient;
    const orgs = await client.query(`SELECT id FROM bms.organizations ORDER BY created_at, code LIMIT 2`);
    if (orgs.rows.length < 2) throw new Error("F3.74: needs two bms.organizations rows — run pnpm db:seed.");
    orgA = orgs.rows[0]?.id as string;
    orgB = orgs.rows[1]?.id as string;
    // A named seed-owned key, not "the first row": no suite deletes `breaker_main`,
    // and naming it keeps the F4.53 fixture-read gate's "oldest wins" rule moot.
    const key = await client.query(`SELECT code FROM bms.point_keys WHERE code = 'breaker_main'`);
    pointKey = key.rows[0]?.code as string;
    if (!pointKey) throw new Error("F3.74: needs the seeded bms.point_keys row breaker_main — run pnpm db:seed.");
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

  it("I1 refuses a tone outside the CHECK (23514); a ruled tone is accepted", async () => {
    await inTx(async (run) => {
      const ok = await probe(run, INSERT_STATE, [pointKey, 7001, "OK", "open"]);
      expect(ok.message, "the positive control must be accepted").toBe("");
      const bad = await probe(run, INSERT_STATE, [pointKey, 7002, "Bad", "ok"]);
      expect(bad.code).toBe("23514");
      expect(bad.message).toContain("point_key_states");
    });
  });

  it("I2 refuses a duplicate (point_key_code, value) (23505)", async () => {
    await inTx(async (run) => {
      await run(INSERT_STATE, [pointKey, 7003, "First", "closed"]);
      const dup = await probe(run, INSERT_STATE, [pointKey, 7003, "Second", "open"]);
      expect(dup.code).toBe("23505");
      const other = await probe(run, INSERT_STATE, [pointKey, 7004, "Other value", "open"]);
      expect(other.message, "a different value under the same key is accepted").toBe("");
    });
  });

  it("I3 refuses an unknown point_key_code (23503)", async () => {
    await inTx(async (run) => {
      const bad = await probe(run, INSERT_STATE, ["nope", 7005, "X", "open"]);
      expect(bad.code).toBe("23503");
    });
  });

  it("I4 as bms_tenant, INSERT is refused (42501) and SELECT succeeds", async () => {
    await inTx(async (run) => {
      await run("SET LOCAL ROLE bms_tenant");
      const select = await probe(run, `SELECT count(*) FROM bms.point_key_states`, []);
      expect(select.message, "SELECT must survive the revoke").toBe("");
      const insert = await probe(run, INSERT_STATE, [pointKey, 7006, "T", "open"]);
      expect(insert.code).toBe("42501");
    });
  });

  it("I5 the five breaker roles exist and are active", async () => {
    const roles = await client.query(
      `SELECT code, sort_order FROM bms.asset_roles WHERE sort_order BETWEEN 151 AND 155 AND active ORDER BY sort_order`,
    );
    expect(roles.rows).toEqual([
      { code: "main-breaker", sort_order: 151 },
      { code: "ups-input-breaker", sort_order: 152 },
      { code: "ups-output-breaker", sort_order: 153 },
      { code: "load-feeder-breaker", sort_order: 154 },
      { code: "mains-feeder-breaker", sort_order: 155 },
    ]);
  });

  const newLayout = async (run: Run, org: string, suffix: string): Promise<string> => {
    await setOrg(org);
    const row = await run(
      `INSERT INTO bms.mimic_layouts (organization_id, name, slug, canvas_w, canvas_h)
       VALUES ($1, $2, $3, 120, 80) RETURNING id`,
      [org, `F3.74 ${suffix}`, `f374-${RUN}-${suffix}`.toLowerCase()],
    );
    await setOrg(orgA);
    return row.rows[0]?.id as string;
  };

  const INSERT_NODE = `INSERT INTO bms.mimic_layout_nodes
     (organization_id, layout_id, key, kind, symbol, label, role_code, tone, x, y, w, h, fan_out, is_source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $10, 0, 0, 10, 10, $8, $9)`;

  const nodeParams = (org: string, layout: string, key: string, spec: NodeSpec = {}): unknown[] => [
    org,
    layout,
    key,
    spec.kind ?? "unit",
    spec.symbol === undefined ? "tank" : spec.symbol,
    `F3.74 ${key}`,
    spec.role === undefined ? null : spec.role,
    spec.fanOut ?? false,
    spec.isSource ?? false,
    spec.tone ?? null,
  ];

  it("I6 refuses a panel with fan_out = true (23514, _flags_units_check)", async () => {
    await inOwnerTx(async (run) => {
      const layout = await newLayout(run, orgA, "i6");
      const ok = await probe(run, INSERT_NODE, nodeParams(orgA, layout, "p0", { kind: "panel", symbol: null, tone: "info" }));
      expect(ok.message, "a panel with both flags false is accepted").toBe("");
      const bad = await probe(run, INSERT_NODE, nodeParams(orgA, layout, "p1", { kind: "panel", symbol: null, tone: "info", fanOut: true }));
      expect(bad.code).toBe("23514");
      expect(bad.message).toContain("mimic_layout_nodes_flags_units_check");
      expect(bad.message).not.toContain("mimic_layout_nodes_kind_fields_check");
    });
  });

  it("I7 refuses a label with is_source = true (23514, _flags_units_check)", async () => {
    await inOwnerTx(async (run) => {
      const layout = await newLayout(run, orgA, "i7");
      const bad = await probe(run, INSERT_NODE, nodeParams(orgA, layout, "l1", { kind: "label", symbol: null, isSource: true }));
      expect(bad.code).toBe("23514");
      expect(bad.message).toContain("mimic_layout_nodes_flags_units_check");
    });
  });

  it("I8 accepts a unit with both flags true, and both read back true", async () => {
    await inOwnerTx(async (run) => {
      const layout = await newLayout(run, orgA, "i8");
      const ok = await probe(run, INSERT_NODE, nodeParams(orgA, layout, "u1", { fanOut: true, isSource: true }));
      expect(ok.message).toBe("");
      await run(INSERT_NODE, nodeParams(orgA, layout, "u1", { fanOut: true, isSource: true }));
      const back = await run(`SELECT fan_out, is_source FROM bms.mimic_layout_nodes WHERE layout_id = $1`, [layout]);
      expect(back.rows).toEqual([{ fan_out: true, is_source: true }]);
    });
  });

  it("I9 under GUC A, refuses a flagged unit stamped A on an organization-B layout (RLS, 42501)", async () => {
    await inOwnerTx(async (run) => {
      const own = await newLayout(run, orgA, "i9-own");
      const accepted = await probe(run, INSERT_NODE, nodeParams(orgA, own, "u", { fanOut: true }));
      expect(accepted.message, "the positive control must be accepted").toBe("");
      const foreign = await newLayout(run, orgB, "i9-foreign");
      const refused = await probe(run, INSERT_NODE, nodeParams(orgA, foreign, "u", { fanOut: true }));
      expect(refused.code, `expected a row-level security violation (got: ${refused.message})`).toBe("42501");
    });
  });
});
