import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  openIntegrationPool,
  requireIntegrationDb,
  resolveIntegrationRoleUrl,
} from "../apps/api/src/testing/integration-db-gate.js";

/**
 * `F3.73` / ADR 0087 Amendment 1 — what migration `0094` guarantees against a
 * real database (plan D1, Task 1.2, I1–I7). `tests/f3.73-dashboard-tabs-schema.test.ts`
 * asserts the migration's *text*; this asserts what Postgres enforces, in the
 * `tests/f3.67-site-control-room-views-schema.integration.test.ts` lifecycle:
 * superuser pool, one held client, every case inside `BEGIN` … `ROLLBACK` as
 * `bms_owner` (FORCE-bound) under the tenant GUC, each refusal probed under a
 * `SAVEPOINT`. Every fixture is created inside the case's transaction, so
 * nothing commits.
 *
 * Each refusal asserts the SQLSTATE **and** the constraint the message names,
 * so a refusal by the wrong rule cannot pass for the right one — `F3.73` Task
 * 1.4 translates `dashboard_tabs_dashboard_id_location_id_fkey` by name.
 */
const connectionString = process.env.DATABASE_URL;

requireIntegrationDb({
  item: "F3.73",
  label: "dashboard tabs schema tests",
  because:
    "the composite foreign keys, the group/location CHECK and the three-leg tenant_isolation " +
    "policy are all things Postgres enforces, so a green run without a database asserts " +
    "nothing about any of them.",
});

const RUN = randomUUID().slice(0, 8);
const has = connectionString !== undefined && connectionString !== "";

type IntegrationPool = Awaited<ReturnType<typeof openIntegrationPool>>;
type Rows = { rows: Array<Record<string, unknown>>; rowCount?: number | null };
type Run = (sql: string, params?: unknown[]) => Promise<Rows>;
type IntegrationClient = {
  query: (sql: string, params?: unknown[]) => Promise<Rows>;
  release: () => void;
};

describe.skipIf(!has)("F3.73 — bms.dashboard_tabs against a live database", () => {
  let pool: IntegrationPool;
  let client: IntegrationClient;
  let orgA = "";
  let orgB = "";
  let locationType = "";

  beforeAll(async () => {
    pool = await openIntegrationPool(
      resolveIntegrationRoleUrl(connectionString as string, "superuser", process.env),
      "F3.73",
    );
    client = (await pool.connect()) as unknown as IntegrationClient;
    // The two oldest (the seeded ESKOM and PHEWB), never the first by code — F4.53/F4.71.
    const orgs = await client.query(`SELECT id FROM bms.organizations ORDER BY created_at, code LIMIT 2`);
    if (orgs.rows.length < 2) {
      throw new Error("F3.73: needs two bms.organizations rows to prove tenant isolation — run pnpm db:seed.");
    }
    orgA = orgs.rows[0]?.id as string;
    orgB = orgs.rows[1]?.id as string;
    const type = await client.query(`SELECT type FROM bms.locations ORDER BY created_at, code LIMIT 1`);
    locationType = type.rows[0]?.type as string;
    if (!locationType) throw new Error("F3.73: needs a seeded location — run pnpm db:seed.");
  });

  afterAll(async () => {
    client?.release();
    await pool?.end();
  });

  const setOrg = (org: string): Promise<Rows> => client.query(`SET LOCAL app.current_organization = '${org}'`);

  /** Runs `body` inside a rolled-back transaction, as `bms_owner` with org A's tenant GUC. */
  const inTx = async (body: (run: Run) => Promise<void>): Promise<void> => {
    await client.query("BEGIN");
    try {
      await client.query("SET LOCAL ROLE bms_owner");
      await setOrg(orgA);
      await body((sql, params) => client.query(sql, params));
    } finally {
      await client.query("ROLLBACK");
    }
  };

  /** A fresh location under organization A. */
  const newLocation = async (run: Run, suffix: string): Promise<string> => {
    const row = await run(
      `INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude)
       VALUES ($1, $2, $3, $4, $5, 0, 0) RETURNING id`,
      [orgA, `F373-${RUN}-${suffix}`, `f373-${RUN}-${suffix}`.toLowerCase(), `F3.73 ${suffix}`, locationType],
    );
    return row.rows[0]?.id as string;
  };

  /** A fresh site dashboard under organization A at `location`. */
  const newDashboard = async (run: Run, location: string, suffix: string): Promise<string> => {
    const row = await run(
      `INSERT INTO bms.dashboards (organization_id, slug, name, location_id) VALUES ($1, $2, $3, $4) RETURNING id`,
      [orgA, `f373-${RUN}-${suffix}`.toLowerCase(), `F3.73 ${suffix}`, location],
    );
    return row.rows[0]?.id as string;
  };

  /** A fresh asset group at `location`, stamped and written under `org`; leaves the GUC on org A. */
  const newGroup = async (run: Run, org: string, location: string, suffix: string): Promise<string> => {
    await setOrg(org);
    const row = await run(
      `INSERT INTO bms.asset_groups (organization_id, location_id, code, name) VALUES ($1, $2, $3, $4) RETURNING id`,
      [org, location, `f373-${RUN}-${suffix}`.toLowerCase(), `F3.73 ${suffix}`],
    );
    await setOrg(orgA);
    return row.rows[0]?.id as string;
  };

  const INSERT_TAB = `INSERT INTO bms.dashboard_tabs
     (organization_id, dashboard_id, location_id, asset_group_id, tab_key, label, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`;

  const newTab = async (
    run: Run,
    dashboard: string,
    location: string | null,
    group: string | null,
    key: string,
  ): Promise<string> => {
    const row = await run(INSERT_TAB, [orgA, dashboard, location, group, key, key, 0]);
    return row.rows[0]?.id as string;
  };

  const INSERT_WIDGET = `INSERT INTO bms.dashboard_widgets
     (organization_id, dashboard_id, tab_id, widget_type, grid_x, grid_y, grid_w, grid_h)
     VALUES ($1, $2, $3, 'value_tile', 0, 0, 3, 2) RETURNING id`;

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

  const count = async (run: Run, sql: string, params: unknown[]): Promise<unknown> =>
    (await run(sql, params)).rows[0]?.n;

  // I1
  it("I1 refuses a tab whose group sits at another location, naming the group FK", async () => {
    await inTx(async (run) => {
      const site = await newLocation(run, "i1a");
      const other = await newLocation(run, "i1b");
      const dash = await newDashboard(run, site, "i1");
      // Positive control: a group at the dashboard's own site is accepted.
      const own = await newGroup(run, orgA, site, "i1-own");
      await newTab(run, dash, site, own, "own");

      const foreign = await newGroup(run, orgA, other, "i1-far");
      const { code, message } = await probe(run, INSERT_TAB, [orgA, dash, site, foreign, "far", "far", 1]);
      expect(code).toBe("23503");
      expect(message).toContain("dashboard_tabs_asset_group_id_location_id_fkey");
    });
  });

  // I2
  it("I2 under GUC A, refuses a tab naming an organization-B group at the same site (42501)", async () => {
    await inTx(async (run) => {
      const site = await newLocation(run, "i2");
      const dash = await newDashboard(run, site, "i2");
      // Positive control first: an own-organization group is accepted, so the
      // refusal below is the group leg, not a policy that refuses everything.
      const own = await newGroup(run, orgA, site, "i2-own");
      await newTab(run, dash, site, own, "own");

      // Organization B's group at organization A's site: every FK is satisfied
      // (Postgres runs them with row security off), so only the policy's group
      // leg can refuse it.
      const foreign = await newGroup(run, orgB, site, "i2-foreign");
      const { code } = await probe(run, INSERT_TAB, [orgA, dash, site, foreign, "foreign", "foreign", 1]);
      expect(code, "expected a row-level security violation, code 42501").toBe("42501");
    });
  });

  // I3
  it("I3 refuses a widget whose tab belongs to another dashboard, naming the widgets composite FK", async () => {
    await inTx(async (run) => {
      const site = await newLocation(run, "i3");
      const dash = await newDashboard(run, site, "i3a");
      const otherDash = await newDashboard(run, site, "i3b");
      const tab = await newTab(run, dash, null, null, "overview");
      const otherTab = await newTab(run, otherDash, null, null, "overview");
      // Positive control: the widget on its own dashboard's tab is accepted.
      await run(INSERT_WIDGET, [orgA, dash, tab]);

      const { code, message } = await probe(run, INSERT_WIDGET, [orgA, dash, otherTab]);
      expect(code).toBe("23503");
      expect(message).toContain("dashboard_widgets_dashboard_id_tab_id_fkey");
    });
  });

  // I4
  it("I4 refuses moving a dashboard with a group-bound tab to another site, naming the pinned FK", async () => {
    await inTx(async (run) => {
      const site = await newLocation(run, "i4a");
      const other = await newLocation(run, "i4b");
      const dash = await newDashboard(run, site, "i4");
      const group = await newGroup(run, orgA, site, "i4");
      await newTab(run, dash, site, group, "sld");

      const { code, message } = await probe(run, `UPDATE bms.dashboards SET location_id = $2 WHERE id = $1`, [
        dash,
        other,
      ]);
      expect(code).toBe("23503");
      expect(message).toContain("dashboard_tabs_dashboard_id_location_id_fkey");
    });
  });

  // I4b
  it("I4b moves a dashboard whose only tab is an Overview (location_id NULL)", async () => {
    await inTx(async (run) => {
      const site = await newLocation(run, "i4ba");
      const other = await newLocation(run, "i4bb");
      const dash = await newDashboard(run, site, "i4b");
      await newTab(run, dash, null, null, "overview");

      const moved = await run(`UPDATE bms.dashboards SET location_id = $2 WHERE id = $1`, [dash, other]);
      expect(moved.rowCount).toBe(1);
      const back = await run(`SELECT location_id FROM bms.dashboards WHERE id = $1`, [dash]);
      expect(back.rows[0]?.location_id).toBe(other);
    });
  });

  // I5
  it("I5 deleting the dashboard cascades its tabs and their widgets", async () => {
    await inTx(async (run) => {
      const site = await newLocation(run, "i5");
      const dash = await newDashboard(run, site, "i5");
      const group = await newGroup(run, orgA, site, "i5");
      const overview = await newTab(run, dash, null, null, "overview");
      const sld = await newTab(run, dash, site, group, "sld");
      await run(INSERT_WIDGET, [orgA, dash, overview]);
      await run(INSERT_WIDGET, [orgA, dash, sld]);
      // Positive control: the rows are there before the delete.
      const tabsSql = `SELECT count(*)::int AS n FROM bms.dashboard_tabs WHERE dashboard_id = $1`;
      const widgetsSql = `SELECT count(*)::int AS n FROM bms.dashboard_widgets WHERE dashboard_id = $1`;
      expect(await count(run, tabsSql, [dash])).toBe(2);
      expect(await count(run, widgetsSql, [dash])).toBe(2);

      await run(`DELETE FROM bms.dashboards WHERE id = $1`, [dash]);

      expect(await count(run, tabsSql, [dash])).toBe(0);
      expect(await count(run, widgetsSql, [dash])).toBe(0);
    });
  });

  // I6
  it("I6 refuses deleting an asset group a tab binds, naming the group FK", async () => {
    await inTx(async (run) => {
      const site = await newLocation(run, "i6");
      const dash = await newDashboard(run, site, "i6");
      // Positive control: an unbound group at the same site deletes.
      const free = await newGroup(run, orgA, site, "i6-free");
      const gone = await run(`DELETE FROM bms.asset_groups WHERE id = $1`, [free]);
      expect(gone.rowCount).toBe(1);

      const bound = await newGroup(run, orgA, site, "i6-bound");
      await newTab(run, dash, site, bound, "sld");
      const { code, message } = await probe(run, `DELETE FROM bms.asset_groups WHERE id = $1`, [bound]);
      expect(code).toBe("23503");
      expect(message).toContain("dashboard_tabs_asset_group_id_location_id_fkey");
    });
  });

  // I7
  it("I7 refuses an Overview tab (no group) that carries a location, naming the CHECK", async () => {
    await inTx(async (run) => {
      const site = await newLocation(run, "i7");
      const dash = await newDashboard(run, site, "i7");
      // Positive control: the same Overview tab with location_id NULL is accepted.
      await newTab(run, dash, null, null, "overview");

      // The dashboard's own site, so the pinned FK is satisfied and only the
      // CHECK can refuse it.
      const { code, message } = await probe(run, INSERT_TAB, [orgA, dash, site, null, "overview-2", "o", 1]);
      expect(code).toBe("23514");
      expect(message).toContain("dashboard_tabs_group_location_check");
    });
  });
});
