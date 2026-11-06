import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  openIntegrationPool,
  requireIntegrationDb,
  resolveIntegrationRoleUrl,
} from "../apps/api/src/testing/integration-db-gate.js";

/**
 * `F4.317` / ADR 0112 decisions 2, 4 and 9 — what migration `0126` guarantees against a real
 * database. `tests/f4.317-organization-control-room-views-schema.test.ts` asserts the
 * migration's text; this asserts what Postgres enforces, on the
 * `tests/f3.67-site-control-room-views-schema.integration.test.ts` lifecycle: superuser pool,
 * one held client, `SET LOCAL ROLE bms_owner` (FORCE-bound) plus the tenant GUC, a
 * `SAVEPOINT`-protected probe per refusal, everything rolled back.
 *
 * `organization_id` is the primary key, so each case first deletes organization A's row inside
 * its own transaction (the seed may make one; the ROLLBACK restores it).
 */
const connectionString = process.env.DATABASE_URL;

requireIntegrationDb({
  item: "F4.317",
  label: "organization control room view schema tests",
  because:
    "the two-leg tenant_isolation policy, the SET NULL foreign key and the two widened " +
    "CHECKs are all things Postgres enforces, so a green run without a database asserts " +
    "nothing about any of them.",
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

describe.skipIf(!has)("F4.317 — bms.organization_control_room_views against a live database", () => {
  let pool: IntegrationPool;
  let client: IntegrationClient;
  let orgA = "";
  let orgB = "";

  beforeAll(async () => {
    pool = await openIntegrationPool(
      resolveIntegrationRoleUrl(connectionString as string, "superuser", process.env),
      "F4.317",
    );
    client = (await pool.connect()) as unknown as IntegrationClient;
    // The two oldest (the seeded ESKOM and PHEWB), never the first by code — F4.53/F4.71.
    const orgs = await client.query(`SELECT id FROM bms.organizations ORDER BY created_at, code LIMIT 2`);
    if (orgs.rows.length < 2) {
      throw new Error("F4.317: needs two bms.organizations rows to prove tenant isolation — run pnpm db:seed.");
    }
    orgA = orgs.rows[0]?.id as string;
    orgB = orgs.rows[1]?.id as string;
  });

  afterAll(async () => {
    client?.release();
    await pool?.end();
  });

  const setOrg = (org: string): Promise<Rows> => client.query(`SET LOCAL app.current_organization = '${org}'`);

  /** Runs `body` in a rolled-back transaction, as `bms_owner` under org A's GUC, with A's row cleared. */
  const inTx = async (body: (run: Run) => Promise<void>): Promise<void> => {
    await client.query("BEGIN");
    try {
      await client.query("SET LOCAL ROLE bms_owner");
      await setOrg(orgA);
      await client.query(`DELETE FROM bms.organization_control_room_views WHERE organization_id = $1`, [orgA]);
      await body((sql, params) => client.query(sql, params));
    } finally {
      await client.query("ROLLBACK");
    }
  };

  /** A fresh organization-wide dashboard under `org`; leaves the GUC on org A. */
  const newDashboard = async (run: Run, org: string, suffix: string): Promise<string> => {
    await setOrg(org);
    const row = await run(
      `INSERT INTO bms.dashboards (organization_id, slug, name) VALUES ($1, $2, $3) RETURNING id`,
      [org, `f4317-${RUN}-${suffix}`.toLowerCase(), `F4.317 ${suffix}`],
    );
    await setOrg(orgA);
    return row.rows[0]?.id as string;
  };

  const INSERT_VIEW = `INSERT INTO bms.organization_control_room_views (organization_id, dashboard_id) VALUES ($1, $2)`;

  /** Runs `sql` under a SAVEPOINT and returns the error it raised (empty if none). */
  const probe = async (run: Run, sql: string, params: unknown[]): Promise<{ code: string | undefined; message: string }> => {
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

  const countUnderA = async (run: Run): Promise<unknown> => {
    await run("SET LOCAL ROLE bms_owner");
    await setOrg(orgA);
    const seen = await run(
      `SELECT count(*)::int AS n FROM bms.organization_control_room_views WHERE organization_id = $1`,
      [orgA],
    );
    return seen.rows[0]?.n;
  };

  it("I1 accepts organization A's row with no dashboard, and with its own dashboard", async () => {
    await inTx(async (run) => {
      await run(INSERT_VIEW, [orgA, null]);
      await run(`DELETE FROM bms.organization_control_room_views WHERE organization_id = $1`, [orgA]);
      const dash = await newDashboard(run, orgA, "i1");
      await run(INSERT_VIEW, [orgA, dash]);
      const back = await run(
        `SELECT dashboard_id, updated_at IS NOT NULL AS stamped FROM bms.organization_control_room_views
          WHERE organization_id = $1`,
        [orgA],
      );
      expect(back.rows).toEqual([{ dashboard_id: dash, stamped: true }]);
    });
  });

  it("I2 under GUC A, refuses a row for organization B (42501)", async () => {
    await inTx(async (run) => {
      const { code } = await probe(run, INSERT_VIEW, [orgB, null]);
      expect(code).toBe("42501");
    });
  });

  it("I3 under GUC A, refuses organization A's row pointing at an organization-B dashboard (42501)", async () => {
    await inTx(async (run) => {
      // Positive control first: an own-organization dashboard is accepted.
      const own = await newDashboard(run, orgA, "i3a");
      const ok = await probe(run, INSERT_VIEW, [orgA, own]);
      expect(ok.code).toBeUndefined();

      const foreign = await newDashboard(run, orgB, "i3b");
      const { code } = await probe(run, INSERT_VIEW, [orgA, foreign]);
      expect(code).toBe("42501");
    });
  });

  it("I4 organization A's row is invisible under GUC B", async () => {
    await inTx(async (run) => {
      await run(INSERT_VIEW, [orgA, null]);
      expect(await countUnderA(run)).toBe(1);
      await setOrg(orgB);
      const seen = await run(
        `SELECT count(*)::int AS n FROM bms.organization_control_room_views WHERE organization_id = $1`,
        [orgA],
      );
      expect(seen.rows[0]?.n).toBe(0);
    });
  });

  // The USING half's dashboards leg: the row is written as `bms_fleet` (BYPASSRLS), which the
  // WITH CHECK half would refuse, so only USING can hide it on the read.
  it("I5 under GUC A, hides organization A's row when it points at an organization-B dashboard", async () => {
    await inTx(async (run) => {
      const foreign = await newDashboard(run, orgB, "i5");
      await run("SET LOCAL ROLE bms_fleet");
      await run(INSERT_VIEW, [orgA, foreign]);
      expect(await countUnderA(run)).toBe(0);

      // Positive control in the same transaction: re-pointed at nothing, the row is visible.
      await run("SET LOCAL ROLE bms_fleet");
      await run(`UPDATE bms.organization_control_room_views SET dashboard_id = NULL WHERE organization_id = $1`, [
        orgA,
      ]);
      expect(await countUnderA(run)).toBe(1);
    });
  });

  it("I6 deleting the pointed dashboard keeps the row with dashboard_id NULL", async () => {
    await inTx(async (run) => {
      const dash = await newDashboard(run, orgA, "i6");
      await run(INSERT_VIEW, [orgA, dash]);
      await run(`DELETE FROM bms.dashboards WHERE id = $1`, [dash]);
      const back = await run(
        `SELECT dashboard_id FROM bms.organization_control_room_views WHERE organization_id = $1`,
        [orgA],
      );
      expect(back.rows).toEqual([{ dashboard_id: null }]);
    });
  });

  it("I7 accepts an 'organization' template in the 'organization' section, and refuses target 'x' (23514)", async () => {
    await inTx(async (run) => {
      const INSERT_TEMPLATE = `INSERT INTO bms.dashboard_templates (organization_id, code, name, section, target)
         VALUES ($1, $2, $2, 'organization', $3) RETURNING target`;
      const ok = await run(INSERT_TEMPLATE, [orgA, `f4317-${RUN}-a`, "organization"]);
      expect(ok.rows[0]?.target).toBe("organization");

      const { code, message } = await probe(run, INSERT_TEMPLATE, [orgA, `f4317-${RUN}-b`, "x"]);
      expect(code).toBe("23514");
      expect(message).toContain("dashboard_templates_target_check");
    });
  });

  it("I8 accepts 'pue.ratio', 'sites.live.count', and 'alarms.active.count' + 'alarms.critical.count' on one widget; refuses an unknown key (23514)", async () => {
    await inTx(async (run) => {
      const dash = await newDashboard(run, orgA, "i8");
      const widget = await run(
        `INSERT INTO bms.dashboard_widgets (organization_id, dashboard_id, widget_type, grid_x, grid_y, grid_w, grid_h)
         VALUES ($1, $2, 'value_tile', 0, 0, 3, 3) RETURNING id`,
        [orgA, dash],
      );
      const widgetId = widget.rows[0]?.id as string;
      const INSERT_SOURCE = `INSERT INTO bms.dashboard_widget_sources (organization_id, widget_id, catalog_key)
         VALUES ($1, $2, $3)`;
      for (const key of ["pue.ratio", "sites.live.count"]) {
        const { code } = await probe(run, INSERT_SOURCE, [orgA, widgetId, key]);
        expect(code, `${key} must be accepted`).toBeUndefined();
      }
      // ADR 0112 Amendment 1: tile 3's two keys sit on one widget at the same time — both rows are
      // kept (no savepoint rollback), so UNIQUE (widget_id, catalog_key) and any per-widget rule must admit the pair.
      await run(INSERT_SOURCE, [orgA, widgetId, "alarms.active.count"]);
      await run(INSERT_SOURCE, [orgA, widgetId, "alarms.critical.count"]);
      const held = await run(
        `SELECT count(*)::int AS n FROM bms.dashboard_widget_sources WHERE widget_id = $1`,
        [widgetId],
      );
      expect(held.rows[0]?.n).toBe(2);
      const { code, message } = await probe(run, INSERT_SOURCE, [orgA, widgetId, "sites.total"]);
      expect(code).toBe("23514");
      expect(message).toContain("dashboard_widget_sources_catalog_key_check");
    });
  });
});
