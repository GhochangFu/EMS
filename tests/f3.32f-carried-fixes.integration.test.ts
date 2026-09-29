import { createHash, randomUUID } from "node:crypto";
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
 * `F3.32f` / ADR 0086 decision 10 — what migration `0091` guarantees against a real database
 * (slice 1, U0). The static twin `tests/f3.32f-carried-fixes.test.ts` asserts the migration's
 * text; this asserts what a migrated database holds.
 *
 * The `tests/f3.32e-mimic-symbol-libraries.integration.test.ts` lifecycle: superuser pool, one
 * held client, every case inside a transaction that is always rolled back — nothing commits.
 * The fixture organization is written by the superuser inside that transaction; the probes then
 * run as `bms_tenant` under the tenant GUC. The migrations-table read is a superuser read and
 * says so.
 */
const connectionString = process.env.DATABASE_URL;

requireIntegrationDb({
  item: "F3.32f",
  label: "mimic Lucide licence tests",
  because:
    "the corrected lucide licence row and the applied 0091 migration are things only a " +
    "migrated database holds, so a green run without a database asserts nothing about them.",
});

const RUN = randomUUID().slice(0, 8);
const has = connectionString !== undefined && connectionString !== "";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const MIGRATION_REL = "packages/db/drizzle/0091_mimic_lucide_licence.sql";

type IntegrationPool = Awaited<ReturnType<typeof openIntegrationPool>>;
type Rows = { rows: Array<Record<string, unknown>> };
type Run = (sql: string, params?: unknown[]) => Promise<Rows>;
type IntegrationClient = {
  query: (sql: string, params?: unknown[]) => Promise<Rows>;
  release: () => void;
};

describe.skipIf(!has)("F3.32f — migration 0091 against a live database", () => {
  let pool: IntegrationPool;
  let client: IntegrationClient;

  beforeAll(async () => {
    pool = await openIntegrationPool(
      resolveIntegrationRoleUrl(connectionString as string, "superuser", process.env),
      "F3.32f",
    );
    client = (await pool.connect()) as unknown as IntegrationClient;
  });

  afterAll(async () => {
    client?.release();
    await pool?.end();
  });

  /** Runs `body` inside a transaction that is always rolled back: a fixture organization, then
   * `bms_tenant` under that organization's GUC. */
  const inTx = async (body: (run: Run) => Promise<void>): Promise<void> => {
    const run: Run = (sql, params) => client.query(sql, params);
    await client.query("BEGIN");
    try {
      const org = (
        await run(`INSERT INTO bms.organizations (code, name, currency) VALUES ($1, $2, 'INR') RETURNING id`, [
          `F332F${RUN}`.toUpperCase(),
          `F3.32f fixture ${RUN}`,
        ])
      ).rows[0]?.id as string;
      await run("SET LOCAL ROLE bms_tenant");
      await run(`SET LOCAL app.current_organization = '${org}'`);
      await body(run);
    } finally {
      await client.query("ROLLBACK");
    }
  };

  const licenceOf = async (run: Run, code: string): Promise<unknown> =>
    (await run("SELECT licence FROM bms.mimic_symbol_libraries WHERE code = $1", [code])).rows[0]?.licence;

  it("the tenant reads the lucide licence as 'ISC and MIT'", async () => {
    await inTx(async (run) => {
      expect((await run("SELECT current_user AS u")).rows[0]?.u).toBe("bms_tenant");
      expect(await licenceOf(run, "lucide")).toBe("ISC and MIT");
    });
  });

  it.each([
    ["core", "Own drawings"],
    ["tabler", "MIT"],
    ["mdi", "Apache 2.0"],
  ])("the tenant reads the %s licence unchanged as %j", async (code, licence) => {
    await inTx(async (run) => {
      expect((await run("SELECT current_user AS u")).rows[0]?.u).toBe("bms_tenant");
      expect(await licenceOf(run, code)).toBe(licence);
    });
  });

  it("drizzle.__drizzle_migrations holds 0091 by the sha256 of the file's bytes (superuser read)", async () => {
    const hash = createHash("sha256").update(readFileSync(join(repoRoot, MIGRATION_REL)).toString()).digest("hex");
    const rows = await client.query("SELECT hash FROM drizzle.__drizzle_migrations WHERE hash = $1", [hash]);
    expect(rows.rows, `no applied migration has hash ${hash}`).toHaveLength(1);
  });
});
