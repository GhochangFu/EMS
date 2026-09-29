import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  openIntegrationPool,
  requireIntegrationDb,
  resolveIntegrationRoleUrl,
} from "../apps/api/src/testing/integration-db-gate.js";

/**
 * `F3.32c` / ADR 0081 decision 1 — what migration `0088` guarantees against a
 * real database (plan U1, I1–I11, plus the per-leg policy probes). The static
 * twin `tests/f3.32c-mimic-layouts-schema.test.ts` asserts the migration's
 * text; this asserts what Postgres enforces.
 *
 * The `tests/f3.67-site-control-room-views-schema.integration.test.ts`
 * lifecycle: superuser pool, one held client, `SET LOCAL ROLE bms_owner`
 * (FORCE-bound) plus the tenant GUC, a `SAVEPOINT`-protected probe per
 * refusal, and every case inside a transaction that is rolled back — nothing
 * commits.
 *
 * Each refusal probe breaks exactly one rule and names the constraint it
 * expects, excluding the others, so a refusal by the wrong rule cannot pass for
 * the right one. The per-leg policy probes write the offending neighbours as
 * `bms_fleet` (BYPASSRLS), so one `EXISTS` leg is false — see I12 for the one
 * leg no live probe can isolate.
 */
const connectionString = process.env.DATABASE_URL;

requireIntegrationDb({
  item: "F3.32c",
  label: "mimic layout schema tests",
  because:
    "the CHECKs, the three-column pipe foreign keys and the tenant_isolation legs of " +
    "bms.mimic_layouts, _nodes and _pipes are all things Postgres enforces, so a green run " +
    "without a database asserts nothing about any of them.",
});

const RUN = randomUUID().slice(0, 8);
const has = connectionString !== undefined && connectionString !== "";
const ROLE = "pump";

const CONSTRAINTS = [
  "mimic_layout_nodes_kind_check",
  "mimic_layout_nodes_symbol_fkey",
  "mimic_layout_nodes_tone_check",
  "mimic_layout_nodes_kind_fields_check",
  "mimic_layout_nodes_box_check",
  "mimic_layout_nodes_role_code_fkey",
  "mimic_layout_pipes_from_fkey",
  "mimic_layout_pipes_to_fkey",
  "mimic_layout_pipes_ends_are_units_check",
  "mimic_layout_pipes_not_self_check",
] as const;

type IntegrationPool = Awaited<ReturnType<typeof openIntegrationPool>>;
type Rows = { rows: Array<Record<string, unknown>> };
type Run = (sql: string, params?: unknown[]) => Promise<Rows>;
type IntegrationClient = {
  query: (sql: string, params?: unknown[]) => Promise<Rows>;
  release: () => void;
};
type NodeSpec = {
  kind?: string;
  symbol?: string | null;
  role?: string | null;
  tone?: string | null;
  box?: [number, number, number, number];
};

describe.skipIf(!has)("F3.32c — bms.mimic_layouts, _nodes, _pipes against a live database", () => {
  let pool: IntegrationPool;
  let client: IntegrationClient;
  let orgA = "";
  let orgB = "";

  beforeAll(async () => {
    pool = await openIntegrationPool(
      resolveIntegrationRoleUrl(connectionString as string, "superuser", process.env),
      "F3.32c",
    );
    client = (await pool.connect()) as unknown as IntegrationClient;
    // The two oldest (the seeded ESKOM and PHEWB), never the first by code — F4.53/F4.71.
    const orgs = await client.query(`SELECT id FROM bms.organizations ORDER BY created_at, code LIMIT 2`);
    if (orgs.rows.length < 2) {
      throw new Error("F3.32c: needs two bms.organizations rows to prove tenant isolation — run pnpm db:seed.");
    }
    orgA = orgs.rows[0]?.id as string;
    orgB = orgs.rows[1]?.id as string;
    const role = await client.query(`SELECT 1 FROM bms.asset_roles WHERE code = $1`, [ROLE]);
    if (role.rows.length !== 1) throw new Error(`F3.32c: needs the seeded asset role '${ROLE}'.`);
  });

  afterAll(async () => {
    client?.release();
    await pool?.end();
  });

  const setOrg = (org: string): Promise<Rows> => client.query(`SET LOCAL app.current_organization = '${org}'`);
  const asOwnerUnderA = async (run: Run): Promise<void> => {
    await run("SET LOCAL ROLE bms_owner");
    await setOrg(orgA);
  };

  /** Runs `body` inside a transaction that is always rolled back, as `bms_owner` under GUC A. */
  const inTx = async (body: (run: Run) => Promise<void>): Promise<void> => {
    await client.query("BEGIN");
    try {
      await asOwnerUnderA((sql, params) => client.query(sql, params));
      await body((sql, params) => client.query(sql, params));
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
      [org, `F3.32c ${suffix}`, `f332c-${RUN}-${suffix}`.toLowerCase()],
    );
    await setOrg(orgA);
    return row.rows[0]?.id as string;
  };

  const INSERT_NODE = `INSERT INTO bms.mimic_layout_nodes
     (organization_id, layout_id, key, kind, symbol, label, role_code, tone, x, y, w, h)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`;

  const nodeParams = (org: string, layout: string, key: string, spec: NodeSpec = {}): unknown[] => {
    const [x, y, w, h] = spec.box ?? [0, 0, 10, 10];
    return [
      org,
      layout,
      key,
      spec.kind ?? "unit",
      spec.symbol === undefined ? "tank" : spec.symbol,
      `F3.32c ${key}`,
      spec.role === undefined ? ROLE : spec.role,
      spec.tone ?? null,
      x,
      y,
      w,
      h,
    ];
  };

  /** A node under `org`'s GUC (the policy's own rules apply); leaves the GUC on org A. */
  const newNode = async (run: Run, org: string, layout: string, key: string, spec: NodeSpec = {}): Promise<string> => {
    await setOrg(org);
    const row = await run(`${INSERT_NODE} RETURNING id`, nodeParams(org, layout, key, spec));
    await setOrg(orgA);
    return row.rows[0]?.id as string;
  };

  /** A node written as `bms_fleet` (BYPASSRLS) — so a probe can set up a cross-organization
   * neighbour the policy would refuse. Returns to `bms_owner` under GUC A. */
  const fleetNode = async (run: Run, stamp: string, layout: string, key: string): Promise<string> => {
    await run("SET LOCAL ROLE bms_fleet");
    const row = await run(`${INSERT_NODE} RETURNING id`, nodeParams(stamp, layout, key));
    await asOwnerUnderA(run);
    return row.rows[0]?.id as string;
  };

  const INSERT_PIPE = `INSERT INTO bms.mimic_layout_pipes
     (organization_id, layout_id, from_node_id, to_node_id) VALUES ($1, $2, $3, $4)`;
  const INSERT_PIPE_KINDS = `INSERT INTO bms.mimic_layout_pipes
     (organization_id, layout_id, from_node_id, to_node_id, from_kind, to_kind) VALUES ($1, $2, $3, $4, $5, $6)`;

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

  const count = async (run: Run, table: string, id: string): Promise<unknown> =>
    (await run(`SELECT count(*)::int AS n FROM bms.${table} WHERE id = $1`, [id])).rows[0]?.n;

  it("I1 accepts a layout with a unit, a passive unit, a panel, a label and a pipe", async () => {
    await inTx(async (run) => {
      const layout = await newLayout(run, orgA, "i1");
      const a = await newNode(run, orgA, layout, "a");
      const b = await newNode(run, orgA, layout, "b", { symbol: "discharge", role: null });
      await newNode(run, orgA, layout, "p", { kind: "panel", symbol: null, role: null, tone: "info" });
      await newNode(run, orgA, layout, "l", { kind: "label", symbol: null, role: null });
      await run(INSERT_PIPE, [orgA, layout, a, b]);
      const back = await run(
        `SELECT from_kind, to_kind FROM bms.mimic_layout_pipes WHERE layout_id = $1`,
        [layout],
      );
      expect(back.rows).toEqual([{ from_kind: "unit", to_kind: "unit" }]);
      const nodes = await run(`SELECT key FROM bms.mimic_layout_nodes WHERE layout_id = $1 ORDER BY key`, [layout]);
      expect(nodes.rows.map((r) => r.key)).toEqual(["a", "b", "l", "p"]);
    });
  });

  it("I2a refuses a pipe to a panel, naming _to_fkey (no unit-kind node has that id)", async () => {
    await inTx(async (run) => {
      const layout = await newLayout(run, orgA, "i2a");
      const unit = await newNode(run, orgA, layout, "u");
      const panel = await newNode(run, orgA, layout, "p", { kind: "panel", symbol: null, role: null, tone: "info" });
      await refuses(run, INSERT_PIPE, [orgA, layout, unit, panel], "mimic_layout_pipes_to_fkey");
    });
  });

  it("I2b refuses a pipe that declares its end a panel, naming _ends_are_units_check", async () => {
    await inTx(async (run) => {
      const layout = await newLayout(run, orgA, "i2b");
      const unit = await newNode(run, orgA, layout, "u");
      const panel = await newNode(run, orgA, layout, "p", { kind: "panel", symbol: null, role: null, tone: "info" });
      await refuses(
        run,
        INSERT_PIPE_KINDS,
        [orgA, layout, unit, panel, "unit", "panel"],
        "mimic_layout_pipes_ends_are_units_check",
      );
    });
  });

  it("I3 refuses a pipe from a unit to itself, naming _not_self_check", async () => {
    await inTx(async (run) => {
      const layout = await newLayout(run, orgA, "i3");
      const unit = await newNode(run, orgA, layout, "u");
      await refuses(run, INSERT_PIPE, [orgA, layout, unit, unit], "mimic_layout_pipes_not_self_check");
    });
  });

  it("I4 refuses a pipe to a unit of another layout, naming _to_fkey", async () => {
    await inTx(async (run) => {
      const one = await newLayout(run, orgA, "i4a");
      const two = await newLayout(run, orgA, "i4b");
      const a = await newNode(run, orgA, one, "a");
      const b = await newNode(run, orgA, one, "b");
      const foreign = await newNode(run, orgA, two, "c");
      await accepts(run, INSERT_PIPE, [orgA, one, a, b]);
      await refuses(run, INSERT_PIPE, [orgA, one, a, foreign], "mimic_layout_pipes_to_fkey");
    });
  });

  // Since 0090 (F3.32e, ADR 0084 decision 3) the symbol is a foreign key to bms.mimic_symbols,
  // not a CHECK: an unknown symbol is a 23503 naming _symbol_fkey.
  it("I5 refuses an unknown symbol, naming _symbol_fkey", async () => {
    await inTx(async (run) => {
      const layout = await newLayout(run, orgA, "i5");
      await refuses(run, INSERT_NODE, nodeParams(orgA, layout, "u", { symbol: "reactor" }), "mimic_layout_nodes_symbol_fkey");
    });
  });

  it("I5b refuses an unknown symbol with 23503, a foreign-key violation", async () => {
    await inTx(async (run) => {
      const layout = await newLayout(run, orgA, "i5b");
      const { code, message } = await probe(run, INSERT_NODE, nodeParams(orgA, layout, "u", { symbol: "reactor" }));
      expect(code, message).toBe("23503");
    });
  });

  it("I6 refuses a panel that carries a symbol, naming _kind_fields_check", async () => {
    await inTx(async (run) => {
      const layout = await newLayout(run, orgA, "i6");
      await refuses(
        run,
        INSERT_NODE,
        nodeParams(orgA, layout, "p", { kind: "panel", symbol: "tank", role: null, tone: "info" }),
        "mimic_layout_nodes_kind_fields_check",
      );
    });
  });

  it("I7 refuses a box with x + w = 241, naming _box_check (240 accepted)", async () => {
    await inTx(async (run) => {
      const layout = await newLayout(run, orgA, "i7");
      await accepts(run, INSERT_NODE, nodeParams(orgA, layout, "ok", { box: [200, 0, 40, 10] }));
      await refuses(run, INSERT_NODE, nodeParams(orgA, layout, "u", { box: [200, 0, 41, 10] }), "mimic_layout_nodes_box_check");
    });
  });

  it("I8 refuses an unknown role code, naming _role_code_fkey", async () => {
    await inTx(async (run) => {
      const layout = await newLayout(run, orgA, "i8");
      await refuses(
        run,
        INSERT_NODE,
        nodeParams(orgA, layout, "u", { role: `f332c-no-such-role-${RUN}` }),
        "mimic_layout_nodes_role_code_fkey",
      );
    });
  });

  it("I9a under GUC A, refuses a node stamped A on an organization-B layout (nodes layouts leg, WITH CHECK)", async () => {
    await inTx(async (run) => {
      const own = await newLayout(run, orgA, "i9a-own");
      await accepts(run, INSERT_NODE, nodeParams(orgA, own, "u"));
      const foreign = await newLayout(run, orgB, "i9a-foreign");
      await refusesRls(run, INSERT_NODE, nodeParams(orgA, foreign, "u"));
    });
  });

  it("I9b under GUC A, hides a node stamped A that sits on an organization-B layout (nodes layouts leg, USING)", async () => {
    await inTx(async (run) => {
      const own = await newLayout(run, orgA, "i9b-own");
      const foreign = await newLayout(run, orgB, "i9b-foreign");
      const visible = await fleetNode(run, orgA, own, "u");
      const hidden = await fleetNode(run, orgA, foreign, "u");
      expect(await count(run, "mimic_layout_nodes", visible)).toBe(1);
      expect(await count(run, "mimic_layout_nodes", hidden)).toBe(0);
    });
  });

  it("I10 an organization-A layout is visible under GUC A and invisible under GUC B", async () => {
    await inTx(async (run) => {
      const layout = await newLayout(run, orgA, "i10");
      expect(await count(run, "mimic_layouts", layout)).toBe(1);
      await setOrg(orgB);
      expect(await count(run, "mimic_layouts", layout)).toBe(0);
    });
  });

  it("I11 deleting a layout removes its nodes and its pipes", async () => {
    await inTx(async (run) => {
      const layout = await newLayout(run, orgA, "i11");
      const a = await newNode(run, orgA, layout, "a");
      const b = await newNode(run, orgA, layout, "b");
      await run(INSERT_PIPE, [orgA, layout, a, b]);
      const children = async (): Promise<unknown[]> => [
        (await run(`SELECT count(*)::int AS n FROM bms.mimic_layout_nodes WHERE layout_id = $1`, [layout])).rows[0]?.n,
        (await run(`SELECT count(*)::int AS n FROM bms.mimic_layout_pipes WHERE layout_id = $1`, [layout])).rows[0]?.n,
      ];
      expect(await children()).toEqual([2, 1]);
      await run(`DELETE FROM bms.mimic_layouts WHERE id = $1`, [layout]);
      expect(await children()).toEqual([0, 0]);
    });
  });

  // The pipes policy's layouts leg cannot be isolated live: a policy's EXISTS
  // subquery is itself filtered by the nodes policy, and a node on a B layout
  // is hidden under GUC A by that policy's own layouts leg — so the from- and
  // to-node legs are false too whenever the layouts leg is. The composite
  // foreign keys already tie a pipe's layout to its nodes' layout. The leg is
  // defence in depth; the static twin pins its text.
  it("I12 under GUC A, refuses a pipe stamped A on an organization-B layout", async () => {
    await inTx(async (run) => {
      // Positive control: the same shape on an own layout is accepted.
      const own = await newLayout(run, orgA, "i12-own");
      const oa = await newNode(run, orgA, own, "a");
      const ob = await newNode(run, orgA, own, "b");
      await accepts(run, INSERT_PIPE, [orgA, own, oa, ob]);
      // Nodes stamped A on the B layout, written as fleet.
      const foreign = await newLayout(run, orgB, "i12-foreign");
      const fa = await fleetNode(run, orgA, foreign, "a");
      const fb = await fleetNode(run, orgA, foreign, "b");
      await refusesRls(run, INSERT_PIPE, [orgA, foreign, fa, fb]);
    });
  });

  it("I13 under GUC A, refuses a pipe whose from-node is stamped B (pipes from-node leg, WITH CHECK)", async () => {
    await inTx(async (run) => {
      const layout = await newLayout(run, orgA, "i13");
      const own = await newNode(run, orgA, layout, "a");
      const to = await newNode(run, orgA, layout, "b");
      await accepts(run, INSERT_PIPE, [orgA, layout, own, to]);
      const foreignFrom = await fleetNode(run, orgB, layout, "c");
      await refusesRls(run, INSERT_PIPE, [orgA, layout, foreignFrom, to]);
    });
  });

  it("I14 under GUC A, refuses a pipe whose to-node is stamped B (pipes to-node leg, WITH CHECK)", async () => {
    await inTx(async (run) => {
      const layout = await newLayout(run, orgA, "i14");
      const from = await newNode(run, orgA, layout, "a");
      const own = await newNode(run, orgA, layout, "b");
      await accepts(run, INSERT_PIPE, [orgA, layout, from, own]);
      const foreignTo = await fleetNode(run, orgB, layout, "c");
      await refusesRls(run, INSERT_PIPE, [orgA, layout, from, foreignTo]);
    });
  });

  it("I15 under GUC A, hides a pipe on a B layout, and one whose from- or to-node is stamped B (USING)", async () => {
    await inTx(async (run) => {
      const layout = await newLayout(run, orgA, "i15");
      const a = await newNode(run, orgA, layout, "a");
      const b = await newNode(run, orgA, layout, "b");
      const foreignNode = await fleetNode(run, orgB, layout, "c");
      const foreignLayout = await newLayout(run, orgB, "i15-foreign");
      const fa = await fleetNode(run, orgA, foreignLayout, "a");
      const fb = await fleetNode(run, orgA, foreignLayout, "b");

      await run("SET LOCAL ROLE bms_fleet");
      const pipe = async (layoutId: string, from: string, to: string): Promise<string> =>
        (await run(`${INSERT_PIPE} RETURNING id`, [orgA, layoutId, from, to])).rows[0]?.id as string;
      const good = await pipe(layout, a, b);
      const badLayout = await pipe(foreignLayout, fa, fb);
      const badFrom = await pipe(layout, foreignNode, b);
      const badTo = await pipe(layout, a, foreignNode);
      await asOwnerUnderA(run);

      expect(await count(run, "mimic_layout_pipes", good), "positive control").toBe(1);
      expect(await count(run, "mimic_layout_pipes", badLayout), "layouts leg").toBe(0);
      expect(await count(run, "mimic_layout_pipes", badFrom), "from-node leg").toBe(0);
      expect(await count(run, "mimic_layout_pipes", badTo), "to-node leg").toBe(0);
    });
  });
});
