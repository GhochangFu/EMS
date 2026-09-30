import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  openIntegrationPool,
  requireIntegrationDb,
  resolveIntegrationRoleUrl,
} from "../apps/api/src/testing/integration-db-gate.js";

/**
 * `F3.73` — what migration `0096` guarantees against a real database (plan
 * Task 3.1). `tests/f3.73-site-widget-types.test.ts` asserts the migration's
 * *text*; this asserts what Postgres enforces: each new widget type and each new
 * catalog key is accepted, and a value outside the lists is still refused by
 * name. Lifecycle of `tests/f3.73-site-template-schema.integration.test.ts`:
 * superuser pool, one held client, every case inside `BEGIN` … `ROLLBACK`.
 */
const connectionString = process.env.DATABASE_URL;

requireIntegrationDb({
  item: "F3.73",
  label: "site widget types tests",
  because:
    "the two widened CHECKs are things Postgres enforces, so a green run without a database " +
    "asserts nothing about either.",
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

const NEW_WIDGET_TYPES = [
  "active_alarms_rail",
  "state_legend",
  "asset_class_strip",
  "module_summary_card",
  "critical_systems_list",
];
const NEW_CATALOG_KEYS = ["assets.offline.count", "assets.list"];

describe.skipIf(!has)("F3.73 — site widget types and catalog keys against a live database", () => {
  let pool: IntegrationPool;
  let client: IntegrationClient;
  let org = "";

  beforeAll(async () => {
    pool = await openIntegrationPool(
      resolveIntegrationRoleUrl(connectionString as string, "superuser", process.env),
      "F3.73",
    );
    client = (await pool.connect()) as unknown as IntegrationClient;
    const orgs = await client.query(`SELECT id FROM bms.organizations ORDER BY created_at, code LIMIT 1`);
    org = orgs.rows[0]?.id as string;
    if (!org) throw new Error("F3.73: needs a seeded organization — run pnpm db:seed.");
  });

  afterAll(async () => {
    client?.release();
    await pool?.end();
  });

  const inTx = async (body: (run: Run) => Promise<void>): Promise<void> => {
    await client.query("BEGIN");
    try {
      await body((sql, params) => client.query(sql, params));
    } finally {
      await client.query("ROLLBACK");
    }
  };

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

  const INSERT_WIDGET = `INSERT INTO bms.dashboard_widgets
     (organization_id, dashboard_id, widget_type, grid_x, grid_y, grid_w, grid_h)
     VALUES ($1, $2, $3, 0, 0, 3, 2) RETURNING id`;

  const newDashboard = async (run: Run): Promise<string> => {
    const row = await run(
      `INSERT INTO bms.dashboards (organization_id, slug, name) VALUES ($1, $2, $2) RETURNING id`,
      [org, `f373c-${RUN}`],
    );
    return row.rows[0]?.id as string;
  };

  it("accepts each of the five new widget types and still refuses an unknown one, naming the CHECK", async () => {
    await inTx(async (run) => {
      const dash = await newDashboard(run);
      for (const type of NEW_WIDGET_TYPES) {
        const ok = await run(INSERT_WIDGET, [org, dash, type]);
        expect(ok.rows.length, `${type} must be accepted`).toBe(1);
      }
      // Positive control for the widening's own keep: an old type still passes.
      expect((await run(INSERT_WIDGET, [org, dash, "mimic"])).rows.length).toBe(1);

      const { code, message } = await probe(run, INSERT_WIDGET, [org, dash, "not_a_widget"]);
      expect(code).toBe("23514");
      expect(message).toContain("dashboard_widgets_widget_type_check");
    });
  });

  it("accepts both new catalog keys and still refuses an unknown one, naming the CHECK", async () => {
    await inTx(async (run) => {
      const dash = await newDashboard(run);
      const widget = (await run(INSERT_WIDGET, [org, dash, "table"])).rows[0]?.id as string;
      const INSERT_SOURCE = `INSERT INTO bms.dashboard_widget_sources (organization_id, widget_id, catalog_key)
         VALUES ($1, $2, $3) RETURNING id`;
      for (const key of NEW_CATALOG_KEYS) {
        const ok = await run(INSERT_SOURCE, [org, widget, key]);
        expect(ok.rows.length, `${key} must be accepted`).toBe(1);
      }
      const { code, message } = await probe(run, INSERT_SOURCE, [org, widget, "assets.nope"]);
      expect(code).toBe("23514");
      expect(message).toContain("dashboard_widget_sources_catalog_key_check");
    });
  });
});
