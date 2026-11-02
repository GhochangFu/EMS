import { createRequire } from "node:module";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  openIntegrationPool,
  requireIntegrationDb,
  resolveIntegrationRoleUrl,
} from "../apps/api/src/testing/integration-db-gate.js";

/**
 * `F4.302` / ADR 0108 Amendment 4, owner ruling B (2026-11-02, build review) — the Energy
 * sub-tab is `?view=energy` and a segment sub-tab is `?view=<asset_domains.code>`, so no
 * domain may carry the code `energy`: its sub-tab would be unreachable. Domains change only
 * through migrations and seeds (no route writes `bms.asset_domains`), so the gate is the
 * migrated and seeded database itself. Read-only; nothing is written.
 */
/** `@bms/shared` through `createRequire`, as `tests/f3.21-organization-llm-settings-schema.test.ts` does (it reads `packages/shared/dist`). */
const require_ = createRequire(import.meta.url);
const { SITE_TRENDS_ENERGY_VIEW } = require_("@bms/shared/contracts") as { SITE_TRENDS_ENERGY_VIEW: string };

const connectionString = process.env.DATABASE_URL;

requireIntegrationDb({
  item: "F4.302",
  label: "reserved energy domain code tests",
  because:
    "the reserved code is a fact of the migrated and seeded catalog, so a green run without a " +
    "database asserts nothing about it.",
});

const has = connectionString !== undefined && connectionString !== "";

type IntegrationPool = Awaited<ReturnType<typeof openIntegrationPool>>;

describe.skipIf(!has)("F4.302 — no asset domain is coded like the Energy sub-tab", () => {
  let pool: IntegrationPool;

  beforeAll(async () => {
    pool = await openIntegrationPool(
      resolveIntegrationRoleUrl(connectionString as string, "superuser", process.env),
      "F4.302",
    );
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("the Energy sub-tab's view value is `energy`", () => {
    expect(SITE_TRENDS_ENERGY_VIEW).toBe("energy");
  });

  it("the catalog holds domains (positive control for the count below)", async () => {
    const all = await pool.query(`SELECT count(*)::int AS n FROM bms.asset_domains`);
    expect(all.rows[0]?.n).toBeGreaterThan(0);
  });

  it("no bms.asset_domains row has the code of the Energy sub-tab, in any case", async () => {
    const hit = await pool.query(`SELECT count(*)::int AS n FROM bms.asset_domains WHERE lower(code) = lower($1)`, [
      SITE_TRENDS_ENERGY_VIEW,
    ]);
    expect(hit.rows[0]?.n).toBe(0);
  });
});
