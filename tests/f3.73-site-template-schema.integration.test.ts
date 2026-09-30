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
 * `F3.73` — what migration `0095` guarantees against a real database (plan
 * Task 2.1). `tests/f3.73-site-template-schema.test.ts` asserts the
 * migration's *text*; this asserts what Postgres enforces and what the
 * backfill does. Lifecycle of `tests/f3.73-dashboard-tabs-schema.integration.test.ts`:
 * superuser pool, one held client, every case inside `BEGIN` … `ROLLBACK`, each
 * refusal probed under a `SAVEPOINT`. The superuser mirrors the migration's own
 * connection (`pnpm db:migrate`), which is the role the backfill runs as.
 */
const connectionString = process.env.DATABASE_URL;

requireIntegrationDb({
  item: "F3.73",
  label: "site template schema tests",
  because:
    "the target CHECK, the domain foreign key and the backfill are things Postgres enforces, " +
    "so a green run without a database asserts nothing about any of them.",
});

const RUN = randomUUID().slice(0, 8);
const has = connectionString !== undefined && connectionString !== "";
const repoRoot = fileURLToPath(new URL("..", import.meta.url));

type IntegrationPool = Awaited<ReturnType<typeof openIntegrationPool>>;
type Rows = { rows: Array<Record<string, unknown>>; rowCount?: number | null };
type Run = (sql: string, params?: unknown[]) => Promise<Rows>;
type IntegrationClient = {
  query: (sql: string, params?: unknown[]) => Promise<Rows>;
  release: () => void;
};

/** The migration's backfill: every statement after the last `RESET ROLE;`, comments dropped. */
const backfillSql = (): string => {
  const sql = readFileSync(
    join(repoRoot, "packages/db/drizzle/0095_site_template_target_and_group_domain.sql"),
    "utf8",
  )
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  const at = sql.lastIndexOf("RESET ROLE;");
  if (at < 0) throw new Error("0095 has no RESET ROLE — fix this parser, do not delete it");
  return sql.slice(at + "RESET ROLE;".length);
};

describe.skipIf(!has)("F3.73 — template target and group domain against a live database", () => {
  let pool: IntegrationPool;
  let client: IntegrationClient;
  let org = "";
  let locationType = "";

  beforeAll(async () => {
    pool = await openIntegrationPool(
      resolveIntegrationRoleUrl(connectionString as string, "superuser", process.env),
      "F3.73",
    );
    client = (await pool.connect()) as unknown as IntegrationClient;
    const orgs = await client.query(`SELECT id FROM bms.organizations ORDER BY created_at, code LIMIT 1`);
    org = orgs.rows[0]?.id as string;
    const type = await client.query(`SELECT type FROM bms.locations ORDER BY created_at, code LIMIT 1`);
    locationType = type.rows[0]?.type as string;
    if (!org || !locationType) throw new Error("F3.73: needs a seeded organization and location — run pnpm db:seed.");
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

  const newLocation = async (run: Run, suffix: string): Promise<string> => {
    const row = await run(
      `INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude)
       VALUES ($1, $2, $3, $4, $5, 0, 0) RETURNING id`,
      [org, `F373B-${RUN}-${suffix}`, `f373b-${RUN}-${suffix}`.toLowerCase(), `F3.73b ${suffix}`, locationType],
    );
    return row.rows[0]?.id as string;
  };

  const INSERT_GROUP = `INSERT INTO bms.asset_groups (organization_id, location_id, code, name, domain)
     VALUES ($1, $2, $3, $3, $4) RETURNING id`;
  const INSERT_TEMPLATE = `INSERT INTO bms.dashboard_templates (organization_id, code, name, section, target)
     VALUES ($1, $2, $2, 'electrical', $3) RETURNING id`;

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

  it("refuses a template target outside the CHECK, naming it", async () => {
    await inTx(async (run) => {
      // Positive controls: both allowed values are accepted, and the column defaults.
      await run(INSERT_TEMPLATE, [org, `f373b-${RUN}-a`, "site"]);
      await run(INSERT_TEMPLATE, [org, `f373b-${RUN}-b`, "asset_group"]);
      const dflt = await run(
        `INSERT INTO bms.dashboard_templates (organization_id, code, name, section)
         VALUES ($1, $2, $2, 'electrical') RETURNING target`,
        [org, `f373b-${RUN}-c`],
      );
      expect(dflt.rows[0]?.target).toBe("asset_group");

      const { code, message } = await probe(run, INSERT_TEMPLATE, [org, `f373b-${RUN}-d`, "x"]);
      expect(code).toBe("23514");
      expect(message).toContain("dashboard_templates_target_check");
    });
  });

  it("refuses an asset group domain that is not in asset_domains", async () => {
    await inTx(async (run) => {
      const site = await newLocation(run, "d");
      // Positive controls: a real domain and NULL are accepted.
      await run(INSERT_GROUP, [org, site, `f373b-${RUN}-ok`, "water"]);
      await run(INSERT_GROUP, [org, site, `f373b-${RUN}-nul`, null]);

      const { code, message } = await probe(run, INSERT_GROUP, [org, site, `f373b-${RUN}-bad`, "nope"]);
      expect(code).toBe("23503");
      expect(message).toContain("asset_groups_domain_fkey");
    });
  });

  it("seeds the site section and the two role codes", async () => {
    const section = await client.query(`SELECT sort_order FROM bms.dashboard_sections WHERE code = 'site'`);
    expect(section.rows[0]?.sort_order).toBe(900);
    const roles = await client.query(
      `SELECT code, sort_order FROM bms.asset_roles WHERE code IN ('leak-sensor', 'smoke-detector') AND active ORDER BY code`,
    );
    expect(roles.rows).toEqual([
      { code: "leak-sensor", sort_order: 850 },
      { code: "smoke-detector", sort_order: 860 },
    ]);
  });

  it("backfills domain from the code, the three named groups, and leaves IT_LOAD NULL", async () => {
    await inTx(async (run) => {
      const site = await newLocation(run, "bf");
      const codes = ["electrical", "ups-battery", "IT_LOAD", "demo-water-plant", "it-rack", "custom-x"];
      for (const code of codes) await run(INSERT_GROUP, [org, site, code, null]);
      // A group already carrying a domain is never overwritten.
      await run(INSERT_GROUP, [org, site, "hvac", "water"]);

      await run(backfillSql());

      const rows = await run(`SELECT code, domain FROM bms.asset_groups WHERE location_id = $1 ORDER BY code`, [site]);
      const byCode = Object.fromEntries(rows.rows.map((r) => [r.code as string, r.domain as string | null]));
      expect(byCode).toEqual({
        electrical: "electrical",
        "ups-battery": "electrical",
        IT_LOAD: null,
        "demo-water-plant": "water",
        "it-rack": "it",
        "custom-x": null,
        hvac: "water",
      });
    });
  });
});
