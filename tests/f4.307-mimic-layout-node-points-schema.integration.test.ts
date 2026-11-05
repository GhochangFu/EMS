import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  openIntegrationPool,
  requireIntegrationDb,
  resolveIntegrationRoleUrl,
} from "../apps/api/src/testing/integration-db-gate.js";

/**
 * `F4.307` / ADR 0081 Amendment 1 — what migration `0124` guarantees against a
 * real database (plan §3, T1). The static twin
 * `tests/f4.307-mimic-layout-node-points-schema.test.ts` asserts the text; this
 * asserts what Postgres enforces.
 *
 * The `tests/f3.32c-mimic-layouts-schema.integration.test.ts` lifecycle:
 * superuser pool, one held client, `SET LOCAL ROLE` (FORCE-bound) plus the
 * tenant GUC, a `SAVEPOINT`-protected probe per refusal, and every case inside
 * a transaction that is rolled back — nothing commits. Each refusal names the
 * constraint it expects and excludes the others.
 */
const connectionString = process.env.DATABASE_URL;

requireIntegrationDb({
  item: "F4.307",
  label: "mimic layout node points schema tests",
  because:
    "the ord bound, the two unique keys, the point-key and the composite (node_id, node_kind) " +
    "foreign keys, the cascade and the tenant_isolation legs of bms.mimic_layout_node_points are " +
    "all things Postgres enforces, so a green run without a database asserts nothing about any of them.",
});

const RUN = randomUUID().slice(0, 8);
const has = connectionString !== undefined && connectionString !== "";
const ROLE = "pump";

const CONSTRAINTS = [
  "mimic_layout_node_points_node_fkey",
  "mimic_layout_node_points_point_key_fkey",
  "mimic_layout_node_points_unit_check",
  "mimic_layout_node_points_ord_check",
  "mimic_layout_node_points_node_ord_key",
  "mimic_layout_node_points_node_key_key",
] as const;

type IntegrationPool = Awaited<ReturnType<typeof openIntegrationPool>>;
type Rows = { rows: Array<Record<string, unknown>> };
type Run = (sql: string, params?: unknown[]) => Promise<Rows>;
type IntegrationClient = {
  query: (sql: string, params?: unknown[]) => Promise<Rows>;
  release: () => void;
};

describe.skipIf(!has)("F4.307 — bms.mimic_layout_node_points against a live database", () => {
  let pool: IntegrationPool;
  let client: IntegrationClient;
  let orgA = "";
  let orgB = "";
  let keys: string[] = [];

  beforeAll(async () => {
    pool = await openIntegrationPool(
      resolveIntegrationRoleUrl(connectionString as string, "superuser", process.env),
      "F4.307",
    );
    client = (await pool.connect()) as unknown as IntegrationClient;
    // The two oldest (the seeded ESKOM and PHEWB), never the first by code — F4.53/F4.71.
    const orgs = await client.query(`SELECT id FROM bms.organizations ORDER BY created_at, code LIMIT 2`);
    if (orgs.rows.length < 2) {
      throw new Error("F4.307: needs two bms.organizations rows to prove tenant isolation — run pnpm db:seed.");
    }
    orgA = orgs.rows[0]?.id as string;
    orgB = orgs.rows[1]?.id as string;
    const role = await client.query(`SELECT 1 FROM bms.asset_roles WHERE code = $1`, [ROLE]);
    if (role.rows.length !== 1) throw new Error(`F4.307: needs the seeded asset role '${ROLE}'.`);
    const pk = await client.query(`SELECT code FROM bms.point_keys WHERE active = true ORDER BY created_at, code LIMIT 4`);
    keys = pk.rows.map((r) => r.code as string);
    if (keys.length < 4) throw new Error("F4.307: needs four active bms.point_keys rows — run pnpm db:seed.");
  });

  afterAll(async () => {
    client?.release();
    await pool?.end();
  });

  const setOrg = (org: string): Promise<Rows> => client.query(`SET LOCAL app.current_organization = '${org}'`);
  const asRoleUnderA = async (run: Run, role: string): Promise<void> => {
    await run(`SET LOCAL ROLE ${role}`);
    await setOrg(orgA);
  };

  /** Runs `body` inside a transaction that is always rolled back, as `role` under GUC A. */
  const inTx = async (body: (run: Run) => Promise<void>, role = "bms_owner"): Promise<void> => {
    await client.query("BEGIN");
    try {
      const run: Run = (sql, params) => client.query(sql, params);
      await asRoleUnderA(run, role);
      await body(run);
    } finally {
      await client.query("ROLLBACK");
    }
  };

  /** A layout under `org`, written under that org's GUC; leaves the GUC on org A. */
  const newLayout = async (run: Run, org: string, suffix: string): Promise<string> => {
    await setOrg(org);
    const row = await run(
      `INSERT INTO bms.mimic_layouts (organization_id, name, slug, canvas_w, canvas_h)
       VALUES ($1, $2, $3, 120, 80) RETURNING id`,
      [org, `F4.307 ${suffix}`, `f4307-${RUN}-${suffix}`.toLowerCase()],
    );
    await setOrg(orgA);
    return row.rows[0]?.id as string;
  };

  /** A roled unit (or a panel) under `org`'s GUC; leaves the GUC on org A. */
  const newNode = async (run: Run, org: string, layout: string, key: string, kind: "unit" | "panel" = "unit"): Promise<string> => {
    await setOrg(org);
    const row = await run(
      `INSERT INTO bms.mimic_layout_nodes
         (organization_id, layout_id, key, kind, symbol, label, role_code, tone, x, y, w, h)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, 0, 10, 10) RETURNING id`,
      kind === "unit"
        ? [org, layout, key, "unit", "tank", `F4.307 ${key}`, ROLE, null]
        : [org, layout, key, "panel", null, `F4.307 ${key}`, null, "info"],
    );
    await setOrg(orgA);
    return row.rows[0]?.id as string;
  };

  const INSERT_POINT = `INSERT INTO bms.mimic_layout_node_points (organization_id, node_id, point_key, ord)
     VALUES ($1, $2, $3, $4)`;
  const INSERT_POINT_KIND = `INSERT INTO bms.mimic_layout_node_points (organization_id, node_id, node_kind, point_key, ord)
     VALUES ($1, $2, $3, $4, $5)`;

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

  const refuses = async (run: Run, sql: string, params: unknown[], constraint: string): Promise<void> => {
    const { message } = await probe(run, sql, params);
    expect(message, `expected a refusal naming ${constraint}`).toContain(constraint);
    for (const other of CONSTRAINTS.filter((c) => c !== constraint)) {
      expect(message, `the refusal must not come from ${other}`).not.toContain(other);
    }
  };

  const refusesRls = async (run: Run, sql: string, params: unknown[]): Promise<void> => {
    const { code, message } = await probe(run, sql, params);
    expect(code, `expected a row-level security violation, code 42501 (got: ${message})`).toBe("42501");
  };

  const accepts = async (run: Run, sql: string, params: unknown[]): Promise<void> => {
    const { message } = await probe(run, sql, params);
    expect(message, "the positive control must be accepted").toBe("");
  };

  const pointsOf = async (run: Run, node: string): Promise<unknown[]> =>
    (
      await run(`SELECT point_key FROM bms.mimic_layout_node_points WHERE node_id = $1 ORDER BY ord`, [node])
    ).rows.map((r) => r.point_key);

  it("P0 FORCE row level security is on, and UNIQUE (id, kind) exists on the nodes", async () => {
    const r = await client.query(
      `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'bms.mimic_layout_node_points'::regclass`,
    );
    expect(r.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    const u = await client.query(
      `SELECT contype FROM pg_constraint
        WHERE conname = 'mimic_layout_nodes_id_kind_key' AND conrelid = 'bms.mimic_layout_nodes'::regclass`,
    );
    expect(u.rows).toEqual([{ contype: "u" }]);
  });

  it("P1 inserts three rows on a roled unit and reads them back in ord order, node_kind 'unit'", async () => {
    await inTx(async (run) => {
      const layout = await newLayout(run, orgA, "p1");
      const node = await newNode(run, orgA, layout, "u");
      await run(INSERT_POINT, [orgA, node, keys[2], 0]);
      await run(INSERT_POINT, [orgA, node, keys[0], 1]);
      await run(INSERT_POINT, [orgA, node, keys[1], 2]);
      expect(await pointsOf(run, node)).toEqual([keys[2], keys[0], keys[1]]);
      const kinds = await run(`SELECT DISTINCT node_kind FROM bms.mimic_layout_node_points WHERE node_id = $1`, [node]);
      expect(kinds.rows).toEqual([{ node_kind: "unit" }]);
    });
  });

  it("P2 refuses ord 3, naming _ord_check (ord 2 accepted)", async () => {
    await inTx(async (run) => {
      const layout = await newLayout(run, orgA, "p2");
      const node = await newNode(run, orgA, layout, "u");
      await accepts(run, INSERT_POINT, [orgA, node, keys[0], 2]);
      await refuses(run, INSERT_POINT, [orgA, node, keys[1], 3], "mimic_layout_node_points_ord_check");
      await refuses(run, INSERT_POINT, [orgA, node, keys[1], -1], "mimic_layout_node_points_ord_check");
    });
  });

  it("P3 refuses a key listed twice on one node, naming _node_key_key, and a reused ord, naming _node_ord_key", async () => {
    await inTx(async (run) => {
      const layout = await newLayout(run, orgA, "p3");
      const node = await newNode(run, orgA, layout, "u");
      await run(INSERT_POINT, [orgA, node, keys[0], 0]);
      await refuses(run, INSERT_POINT, [orgA, node, keys[0], 1], "mimic_layout_node_points_node_key_key");
      await refuses(run, INSERT_POINT, [orgA, node, keys[1], 0], "mimic_layout_node_points_node_ord_key");
      // The same key on another node is its own list.
      const other = await newNode(run, orgA, layout, "v");
      await accepts(run, INSERT_POINT, [orgA, other, keys[0], 0]);
    });
  });

  it("P4 refuses an unknown point key with 23503, naming _point_key_fkey", async () => {
    await inTx(async (run) => {
      const layout = await newLayout(run, orgA, "p4");
      const node = await newNode(run, orgA, layout, "u");
      const params = [orgA, node, `f4307_no_such_key_${RUN}`, 0];
      const { code, message } = await probe(run, INSERT_POINT, params);
      expect(code, message).toBe("23503");
      await refuses(run, INSERT_POINT, params, "mimic_layout_node_points_point_key_fkey");
    });
  });

  it("P5a refuses a row on a panel, naming _node_fkey (no unit-kind node has that id)", async () => {
    await inTx(async (run) => {
      const layout = await newLayout(run, orgA, "p5a");
      const unit = await newNode(run, orgA, layout, "u");
      const panel = await newNode(run, orgA, layout, "p", "panel");
      await accepts(run, INSERT_POINT, [orgA, unit, keys[0], 0]);
      await refuses(run, INSERT_POINT, [orgA, panel, keys[0], 0], "mimic_layout_node_points_node_fkey");
    });
  });

  it("P5b refuses a row that declares its node a panel, naming _unit_check", async () => {
    await inTx(async (run) => {
      const layout = await newLayout(run, orgA, "p5b");
      const panel = await newNode(run, orgA, layout, "p", "panel");
      await refuses(
        run,
        INSERT_POINT_KIND,
        [orgA, panel, "panel", keys[0], 0],
        "mimic_layout_node_points_unit_check",
      );
    });
  });

  it("P6a under GUC A, refuses a row stamped B (own-organization leg, WITH CHECK)", async () => {
    await inTx(async (run) => {
      const layout = await newLayout(run, orgA, "p6a");
      const node = await newNode(run, orgA, layout, "u");
      await accepts(run, INSERT_POINT, [orgA, node, keys[0], 0]);
      await refusesRls(run, INSERT_POINT, [orgB, node, keys[0], 0]);
    });
  });

  it("P6b under GUC A, refuses a row stamped A on an organization-B unit (nodes leg, WITH CHECK)", async () => {
    await inTx(async (run) => {
      const foreignLayout = await newLayout(run, orgB, "p6b");
      const foreignNode = await newNode(run, orgB, foreignLayout, "u");
      await refusesRls(run, INSERT_POINT, [orgA, foreignNode, keys[0], 0]);
    });
  });

  it("P7 under GUC A, hides a row stamped A on an organization-B unit, and an own row under GUC B (USING)", async () => {
    await inTx(async (run) => {
      const own = await newLayout(run, orgA, "p7-own");
      const ownNode = await newNode(run, orgA, own, "u");
      const foreign = await newLayout(run, orgB, "p7-foreign");
      const foreignNode = await newNode(run, orgB, foreign, "u");
      await run("SET LOCAL ROLE bms_fleet");
      await run(INSERT_POINT, [orgA, ownNode, keys[0], 0]);
      await run(INSERT_POINT, [orgA, foreignNode, keys[0], 0]);
      await asRoleUnderA(run, "bms_owner");
      expect(await pointsOf(run, ownNode), "positive control").toEqual([keys[0]]);
      expect(await pointsOf(run, foreignNode), "nodes leg").toEqual([]);
      await setOrg(orgB);
      expect(await pointsOf(run, ownNode), "own-organization leg").toEqual([]);
    });
  });

  it("P8 deleting the unit, or its layout, removes its points (ON DELETE CASCADE)", async () => {
    await inTx(async (run) => {
      const layout = await newLayout(run, orgA, "p8");
      const a = await newNode(run, orgA, layout, "a");
      const b = await newNode(run, orgA, layout, "b");
      await run(INSERT_POINT, [orgA, a, keys[0], 0]);
      await run(INSERT_POINT, [orgA, b, keys[1], 0]);
      await run(`DELETE FROM bms.mimic_layout_nodes WHERE id = $1`, [a]);
      expect(await pointsOf(run, a)).toEqual([]);
      expect(await pointsOf(run, b)).toEqual([keys[1]]);
      await run(`DELETE FROM bms.mimic_layouts WHERE id = $1`, [layout]);
      expect(await pointsOf(run, b)).toEqual([]);
    });
  });

  it("P9 bms_tenant writes and reads its own rows; bms_fleet reads (0041's default privileges)", async () => {
    const privs = await client.query(
      `SELECT has_table_privilege('bms_tenant', 'bms.mimic_layout_node_points', 'INSERT') AS t_ins,
              has_table_privilege('bms_tenant', 'bms.mimic_layout_node_points', 'SELECT') AS t_sel,
              has_table_privilege('bms_tenant', 'bms.mimic_layout_node_points', 'DELETE') AS t_del,
              has_table_privilege('bms_fleet', 'bms.mimic_layout_node_points', 'SELECT') AS f_sel`,
    );
    expect(privs.rows[0]).toEqual({ t_ins: true, t_sel: true, t_del: true, f_sel: true });
    await inTx(async (run) => {
      const layout = await newLayout(run, orgA, "p9");
      const node = await newNode(run, orgA, layout, "u");
      await asRoleUnderA(run, "bms_tenant");
      await accepts(run, INSERT_POINT, [orgA, node, keys[3], 0]);
      await run(INSERT_POINT, [orgA, node, keys[3], 0]);
      expect(await pointsOf(run, node)).toEqual([keys[3]]);
    });
  });
});
