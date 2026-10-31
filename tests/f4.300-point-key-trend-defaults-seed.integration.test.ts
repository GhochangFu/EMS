import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Relative, not `@bms/db`: see tests/f3.68-point-key-headline-ranks-seed.integration.test.ts.
import {
  seedPointKeyTrendDefaults,
  TREND_DEFAULT_SEED,
} from "../packages/db/src/point-key-trend-defaults-seed.js";
import {
  openIntegrationPool,
  requireIntegrationDb,
} from "../apps/api/src/testing/integration-db-gate.js";

/**
 * `F4.300` U4 (ADR 0108 decision 3, C2, owner answer Q4) — what
 * `seedPointKeyTrendDefaults` guarantees. Model:
 * `tests/f3.68-point-key-headline-ranks-seed.integration.test.ts`.
 *
 * - **S1/S2/S3** (static, no database): the seed list is the 21 codes plus the
 *   UPS default set; every code is declared in a shared `*_POINT_KEYS` array
 *   (so the seed can never name a code the catalog does not hold);
 *   `seed.ts` calls the function after `seedPointKeyHeadlineRanks(` and before
 *   the ESKOM `withOrganization` bracket.
 * - **I1** after `pnpm db:seed` every list code reads `trend_default = true`.
 * - **I2** a decided `false` is never reverted (C2), while a fresh NULL code in
 *   the same call flips to `true` (adjacent positive control).
 * - **I3** the function returns the changed-row count; a second call returns 0.
 *
 * Connection `owner`; I2/I3 run in `BEGIN` ... `ROLLBACK`.
 */

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");

/** The 21 codes the plan proposed (U4) — the owner accepted them (Q4). */
const PLAN_CODES = [
  "kw",
  "kwh_total",
  "pf",
  "voltage_l1_v",
  "current_a",
  "frequency_hz",
  "supply_air_temp_c",
  "return_air_temp_c",
  "chw_supply_temp_c",
  "chw_return_temp_c",
  "cooling_kw",
  "rack_kw",
  "rack_temp_c",
  "pdu_util_pct",
  "temperature_c",
  "humidity_pct",
  "raw_water_flow_klh",
  "treated_water_flow_klh",
  "raw_turbidity_ntu",
  "treated_cl2_residual_mgl",
  "clearwell_level_pct",
];

/** The seven `CONTROL_ROOM_UPS_POINT_KEYS` codes, parsed from the source. */
function upsCodes(): string[] {
  const src = readFileSync(join(root, "packages/shared/src/constants.ts"), "utf8");
  const m = /export const CONTROL_ROOM_UPS_POINT_KEYS = \[([^\]]*)\]/.exec(src);
  if (!m) throw new Error("CONTROL_ROOM_UPS_POINT_KEYS not found");
  return [...(m[1] as string).matchAll(/"([a-z0-9_]+)"/g)].map((x) => x[1] as string);
}

describe("F4.300 U4 — TREND_DEFAULT_SEED (static)", () => {
  it("S1 holds the 21 plan codes", () => {
    for (const code of PLAN_CODES) expect(TREND_DEFAULT_SEED, code).toContain(code);
  });

  it("S1b adds a ups default set drawn only from the seven UPS codes (Q4)", () => {
    const ups = upsCodes();
    expect(ups.length).toBe(7);
    const extra = TREND_DEFAULT_SEED.filter((c) => !PLAN_CODES.includes(c));
    expect(extra.length, "a ups default set must exist").toBeGreaterThanOrEqual(3);
    for (const code of extra) expect(ups, `${code} must be a UPS code`).toContain(code);
    for (const code of ["load_pct", "battery_v", "backup_min"]) expect(extra).toContain(code);
  });

  it("S1c has no duplicate code", () => {
    expect(new Set(TREND_DEFAULT_SEED).size).toBe(TREND_DEFAULT_SEED.length);
  });

  it("S2 names only codes a shared *_POINT_KEYS array declares", () => {
    const src = readFileSync(join(root, "packages/shared/src/constants.ts"), "utf8");
    const declared = new Set<string>();
    for (const m of src.matchAll(/export const [A-Z_]*POINT_KEYS = \[([^\]]*)\]/g)) {
      for (const c of (m[1] as string).matchAll(/"([a-z0-9_]+)"/g)) declared.add(c[1] as string);
    }
    expect(declared.size, "anti-vacuity: the scan found the arrays").toBeGreaterThan(50);
    for (const code of TREND_DEFAULT_SEED) expect(declared.has(code), `${code} is not in a shared array`).toBe(true);
  });

  it("S3 seed.ts calls it after the headline ranks and before the ESKOM bracket", () => {
    const seed = readFileSync(join(root, "packages/db/src/seed.ts"), "utf8");
    const code = seed.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const rank = code.indexOf("seedPointKeyHeadlineRanks(pool)");
    const trend = code.indexOf("seedPointKeyTrendDefaults(pool)");
    // The first ESKOM bracket AFTER the trend call (earlier brackets exist for
    // unrelated seeds), and it must be the one that follows the point-key seeds.
    const eskom = code.indexOf("withOrganization(pool, eskomOrgId", trend);
    expect(rank).toBeGreaterThan(-1);
    expect(trend).toBeGreaterThan(rank);
    expect(eskom).toBeGreaterThan(trend);
    expect(code.slice(trend, eskom)).not.toContain("seedPointKeyCatalog(");
  });
});

const ownerUrl = requireIntegrationDb({
  item: "F4.300 U4",
  label: "the seeded catalog trend defaults (bms.point_keys.trend_default)",
  because:
    "the NULL-only fill (C2) and the changed-row count are things Postgres holds, so a green run " +
    "without a database asserts nothing about either.",
  connection: "owner",
});

type IntegrationPool = Awaited<ReturnType<typeof openIntegrationPool>>;
type IntegrationClient = Parameters<typeof seedPointKeyTrendDefaults>[0];

const runId = Math.random().toString(16).slice(2, 10);
const codeDecidedFalse = `f4300-${runId}-no`;
const codeFreshNull = `f4300-${runId}-yes`;

async function flagOf(client: IntegrationClient, code: string): Promise<boolean | null | undefined> {
  const { rows } = await client.query<{ trend_default: boolean | null }>(
    `SELECT trend_default FROM bms.point_keys WHERE code = $1`,
    [code],
  );
  return rows[0]?.trend_default;
}

describe.skipIf(!ownerUrl)("F4.300 U4 — seedPointKeyTrendDefaults (database)", () => {
  let pool: IntegrationPool | undefined;

  beforeAll(async () => {
    pool = await openIntegrationPool(ownerUrl as string, "F4.300 U4");
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  }, 60_000);

  async function inRolledBackTransaction(fn: (client: IntegrationClient) => Promise<void>): Promise<void> {
    if (!pool) throw new Error("pool not initialised");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await fn(client);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }

  // I1
  it("I1 holds trend_default = true for every list code after pnpm db:seed", async () => {
    if (!pool) throw new Error("pool not initialised");
    const { rows } = await pool.query<{ code: string; trend_default: boolean | null }>(
      `SELECT code, trend_default FROM bms.point_keys WHERE code = ANY($1::text[])`,
      [[...TREND_DEFAULT_SEED]],
    );
    expect(rows.length, "every list code must be seeded in the catalog — run pnpm db:seed first").toBe(
      TREND_DEFAULT_SEED.length,
    );
    for (const row of rows) expect(row.trend_default, `${row.code} must be true`).toBe(true);
  });

  // I2 (C2)
  it("I2 never reverts a decided false, and flips a fresh NULL code in the same call", async () => {
    await inRolledBackTransaction(async (client) => {
      await client.query(
        `INSERT INTO bms.point_keys (code, name, trend_default) VALUES ($1, 'F4.300 fixture', false), ($2, 'F4.300 fixture', NULL)`,
        [codeDecidedFalse, codeFreshNull],
      );

      await seedPointKeyTrendDefaults(client, [codeDecidedFalse, codeFreshNull]);

      expect(await flagOf(client, codeFreshNull), "positive control: NULL flips to true").toBe(true);
      expect(await flagOf(client, codeDecidedFalse), "a decided false must survive a re-seed (C2)").toBe(false);
    });
  });

  // I3
  it("I3 returns the changed-row count, and 0 on a second call", async () => {
    await inRolledBackTransaction(async (client) => {
      await client.query(`INSERT INTO bms.point_keys (code, name, trend_default) VALUES ($1, 'F4.300 fixture', NULL)`, [
        codeFreshNull,
      ]);

      expect(await seedPointKeyTrendDefaults(client, [codeFreshNull])).toBe(1);
      expect(await seedPointKeyTrendDefaults(client, [codeFreshNull])).toBe(0);
    });
  });
});
