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
 * `F4.302` U1 / ADR 0108 Amendment 4 item 1 — what migration `0119` guarantees against a real
 * database. `tests/f4.302-dashboard-tab-key-trends.test.ts` asserts the migration's text; this
 * asserts what Postgres enforces, in the `tests/f3.73-dashboard-tabs-schema.integration.test.ts`
 * lifecycle: superuser pool, one held client, every case inside `BEGIN` ... `ROLLBACK` as
 * `bms_owner` under the tenant GUC. Nothing commits.
 */
const connectionString = process.env.DATABASE_URL;

requireIntegrationDb({
  item: "F4.302",
  label: "dashboard tab key trends tests",
  because:
    "the reserved-key CHECK and the rename of an existing `trends` tab are things Postgres " +
    "enforces, so a green run without a database asserts nothing about either of them.",
});

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const MIGRATION_BODY = readFileSync(join(repoRoot, "packages/db/drizzle/0119_dashboard_tab_key_trends.sql"), "utf8")
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

describe.skipIf(!has)("F4.302 — bms.dashboard_tabs.tab_key against a live database", () => {
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

  /** Runs `body` inside a rolled-back transaction, as `bms_owner` under the tenant GUC. */
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

  const newDashboard = async (run: Run): Promise<string> => {
    const location = await run(
      `INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude)
       VALUES ($1, $2, $3, $4, $5, 0, 0) RETURNING id`,
      [org, `F4302-${RUN}`, `f4302-${RUN}`, "F4.302", locationType],
    );
    const row = await run(
      `INSERT INTO bms.dashboards (organization_id, slug, name, location_id) VALUES ($1, $2, $3, $4) RETURNING id`,
      [org, `f4302-${RUN}`, "F4.302", location.rows[0]?.id as string],
    );
    return row.rows[0]?.id as string;
  };

  const INSERT_TAB = `INSERT INTO bms.dashboard_tabs
     (organization_id, dashboard_id, location_id, asset_group_id, tab_key, label, sort_order)
     VALUES ($1, $2, NULL, NULL, $3, $3, 0) RETURNING id`;

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

  it("refuses a tab keyed `trends`, naming the key CHECK", async () => {
    await inTx(async (run) => {
      const dash = await newDashboard(run);
      // Positive control: the neighbouring key is accepted, so the refusal below is the reserved key.
      const ok = await probe(run, INSERT_TAB, [org, dash, "trends-1"]);
      expect(ok.code).toBeUndefined();
      const { code, message } = await probe(run, INSERT_TAB, [org, dash, "trends"]);
      expect(code).toBe("23514");
      expect(message).toContain("dashboard_tabs_tab_key_check");
    });
  });

  it("still refuses `assets`", async () => {
    await inTx(async (run) => {
      const dash = await newDashboard(run);
      const { code } = await probe(run, INSERT_TAB, [org, dash, "assets"]);
      expect(code).toBe("23514");
    });
  });

  it("accepts `trends-1`", async () => {
    await inTx(async (run) => {
      const dash = await newDashboard(run);
      const row = await run(INSERT_TAB, [org, dash, "trends-1"]);
      expect(row.rows).toHaveLength(1);
    });
  });

  it("renames a `trends` row to trends-<8 chars of its id> when the 0119 body is re-run", async () => {
    await inTx(async (run) => {
      const dash = await newDashboard(run);
      // The pre-0119 state: the widened CHECK is not there yet, so `trends` can be stored.
      await run("ALTER TABLE bms.dashboard_tabs DROP CONSTRAINT dashboard_tabs_tab_key_check");
      const inserted = await run(INSERT_TAB, [org, dash, "trends"]);
      const id = inserted.rows[0]?.id as string;
      await run(MIGRATION_BODY);
      const after = await run(`SELECT tab_key FROM bms.dashboard_tabs WHERE id = $1`, [id]);
      expect(after.rows[0]?.tab_key).toBe(`trends-${id.slice(0, 8)}`);
      const still = await run(`SELECT count(*)::int AS n FROM bms.dashboard_tabs WHERE tab_key = 'trends'`);
      expect(still.rows[0]?.n).toBe(0);
    });
  });
});
