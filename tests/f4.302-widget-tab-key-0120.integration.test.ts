import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  openIntegrationPool,
  requireIntegrationDb,
  resolveIntegrationRoleUrl,
} from "../apps/api/src/testing/integration-db-gate.js";

/**
 * `F4.302` / ADR 0108 Amendment 4, owner ruling C (2026-11-02, build review) — what migration
 * `0120` does against a real database. `0119` renamed a tab keyed `trends` to
 * `trends-<first 8 characters of its id>` but left `bms.dashboard_widgets.config->>'tabKey'` at
 * `trends`, and a mimic resolves its tab by `nt.tab_key = w.config->>'tabKey'`
 * (`apps/api/src/dashboard-builder/mimic-nodes.service.ts`). `0120` moves the widget to the
 * renamed key. Lifecycle of `tests/f4.302-dashboard-tab-key-trends.integration.test.ts`: superuser
 * pool, one held client, every case inside `BEGIN` ... `ROLLBACK` as `bms_owner` under the tenant
 * GUC. Nothing commits.
 */
const connectionString = process.env.DATABASE_URL;

requireIntegrationDb({
  item: "F4.302",
  label: "migration 0120 widget tab key tests",
  because:
    "the widget re-point is an UPDATE ... FROM that Postgres runs, so a green run without a " +
    "database asserts nothing about which widgets it moves.",
});

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const MIGRATION_BODY = readFileSync(join(repoRoot, "packages/db/drizzle/0120_widget_tab_key_trends.sql"), "utf8")
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

const RUN = randomUUID().slice(0, 8);
const has = connectionString !== undefined && connectionString !== "";

type IntegrationPool = Awaited<ReturnType<typeof openIntegrationPool>>;
type Rows = { rows: Array<Record<string, unknown>>; rowCount?: number | null };
type Run = (sql: string, params?: unknown[]) => Promise<Rows>;
type IntegrationClient = {
  query: (sql: string, params?: unknown[]) => Promise<Rows>;
  release: () => void;
};

describe.skipIf(!has)("F4.302 — migration 0120 moves a widget's tabKey to the tab 0119 renamed", () => {
  let pool: IntegrationPool;
  let client: IntegrationClient;
  let org = "";
  let locationType = "";

  beforeAll(async () => {
    pool = await openIntegrationPool(
      resolveIntegrationRoleUrl(connectionString as string, "superuser", process.env),
      "F4.302",
    );
    client = (await pool.connect()) as unknown as IntegrationClient;
    // The oldest organization, never the first by code — F4.53/F4.71.
    const orgs = await client.query(`SELECT id FROM bms.organizations ORDER BY created_at, code LIMIT 1`);
    org = orgs.rows[0]?.id as string;
    if (!org) throw new Error("F4.302: needs a seeded organization — run pnpm db:seed.");
    const type = await client.query(`SELECT type FROM bms.locations ORDER BY created_at, code LIMIT 1`);
    locationType = type.rows[0]?.type as string;
    if (!locationType) throw new Error("F4.302: needs a seeded location — run pnpm db:seed.");
  });

  afterAll(async () => {
    client?.release();
    await pool?.end();
  });

  /** Runs `body` inside a transaction that always ends in `ROLLBACK`, as `bms_owner` under the tenant GUC. */
  const inTx = async (body: (run: Run) => Promise<void>): Promise<void> => {
    await client.query("BEGIN");
    try {
      await client.query("SET LOCAL ROLE bms_owner");
      await client.query(`SET LOCAL app.current_organization = '${org}'`);
      await body((sql, params) => client.query(sql, params));
    } finally {
      await client.query("ROLLBACK");
    }
  };

  const newDashboard = async (run: Run, suffix: string): Promise<string> => {
    const location = await run(
      `INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude)
       VALUES ($1, $2, $3, $4, $5, 0, 0) RETURNING id`,
      [org, `F4302-${RUN}-${suffix}`, `f4302-${RUN}-${suffix}`, "F4.302", locationType],
    );
    const row = await run(
      `INSERT INTO bms.dashboards (organization_id, slug, name, location_id) VALUES ($1, $2, $3, $4) RETURNING id`,
      [org, `f4302-${RUN}-${suffix}`, "F4.302", location.rows[0]?.id as string],
    );
    return row.rows[0]?.id as string;
  };

  const insertTab = async (run: Run, dash: string, id: string, key: string): Promise<void> => {
    await run(
      `INSERT INTO bms.dashboard_tabs
         (id, organization_id, dashboard_id, location_id, asset_group_id, tab_key, label, sort_order)
       VALUES ($1, $2, $3, NULL, NULL, $4, $4, 0)`,
      [id, org, dash, key],
    );
  };

  const insertWidget = async (run: Run, dash: string, config: Record<string, unknown>): Promise<string> => {
    const row = await run(
      `INSERT INTO bms.dashboard_widgets
         (organization_id, dashboard_id, tab_id, widget_type, grid_x, grid_y, grid_w, grid_h, config)
       VALUES ($1, $2, NULL, 'mimic', 0, 0, 4, 4, $3::jsonb) RETURNING id`,
      [org, dash, JSON.stringify(config)],
    );
    return row.rows[0]?.id as string;
  };

  /** A dashboard in the post-0119 state: its `trends` tab renamed, a widget still naming `trends`. */
  const renamedByZeroOneOneNine = async (run: Run, suffix: string): Promise<{ key: string; widget: string }> => {
    const dash = await newDashboard(run, suffix);
    const id = randomUUID();
    const key = `trends-${id.slice(0, 8)}`;
    await insertTab(run, dash, id, key);
    const widget = await insertWidget(run, dash, { source: "preset", preset: "lv_single_line", tabKey: "trends" });
    return { key, widget };
  };

  const tabKeyOf = async (run: Run, widget: string): Promise<unknown> =>
    (await run(`SELECT config->>'tabKey' AS k FROM bms.dashboard_widgets WHERE id = $1`, [widget])).rows[0]?.k;

  it("moves a widget naming `trends` to the tab 0119 renamed on its dashboard", async () => {
    await inTx(async (run) => {
      const { key, widget } = await renamedByZeroOneOneNine(run, "a");
      await run(MIGRATION_BODY);
      expect(await tabKeyOf(run, widget)).toBe(key);
    });
  });

  it("keeps the widget's other config keys when it moves tabKey", async () => {
    await inTx(async (run) => {
      const { widget } = await renamedByZeroOneOneNine(run, "a");
      await run(MIGRATION_BODY);
      const after = await run(`SELECT config->>'preset' AS preset FROM bms.dashboard_widgets WHERE id = $1`, [widget]);
      expect(after.rows[0]?.preset).toBe("lv_single_line");
    });
  });

  it("leaves a widget alone when its dashboard's trends-xxxxxxxx tab is not its own id prefix (a user's tab)", async () => {
    await inTx(async (run) => {
      // Positive control in the same run: the 0119-shaped dashboard is moved.
      const moved = await renamedByZeroOneOneNine(run, "a");
      const userDash = await newDashboard(run, "b");
      const id = randomUUID();
      const notItsPrefix = id.startsWith("abcd1234") ? "trends-dcba4321" : "trends-abcd1234";
      await insertTab(run, userDash, id, notItsPrefix);
      const stray = await insertWidget(run, userDash, { tabKey: "trends" });
      await run(MIGRATION_BODY);
      expect(await tabKeyOf(run, moved.widget)).toBe(moved.key);
      expect(await tabKeyOf(run, stray)).toBe("trends");
    });
  });

  it("is a no-op on a second run", async () => {
    await inTx(async (run) => {
      const { key, widget } = await renamedByZeroOneOneNine(run, "a");
      const first = await run(MIGRATION_BODY);
      // Precondition: the first run moved something (this run's widget at least), so a zero below is the no-op.
      expect(first.rowCount ?? 0).toBeGreaterThanOrEqual(1);
      const second = await run(MIGRATION_BODY);
      expect(second.rowCount).toBe(0);
      expect(await tabKeyOf(run, widget)).toBe(key);
    });
  });
});
