import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Relative, not `@bms/db`: see tests/f3.68-point-key-headline-ranks-seed.integration.test.ts.
import { PACK_ASSET_DOMAINS, seedAssetDomains } from "../packages/db/src/asset-domains-seed.js";
import { seedPointKeyCatalog } from "../packages/db/src/point-keys-seed.js";
import { TREND_DEFAULT_SEED } from "../packages/db/src/point-key-trend-defaults-seed.js";
import { resolveSegments, type TrendCatalogRow } from "../apps/api/src/trend-points/trend-points.pure.js";
import {
  openIntegrationPool,
  requireIntegrationDb,
} from "../apps/api/src/testing/integration-db-gate.js";

/**
 * `F4.300` U4b (ADR 0108 decision 3, owner answer Q1) — the `ups` segment.
 *
 * The owner ruled that F4.300 adds a `ups` row to `bms.asset_domains` and
 * re-files the seven `CONTROL_ROOM_UPS_POINT_KEYS` codes from `electrical` to
 * `ups`, and that a test proves the seven codes read `ups` and the UPS Control
 * Room view still lists them.
 *
 * - **S1/S2** (static): the pack row exists; the seed files the UPS array under
 *   `ups`, and no other `keysForDomain` line names the array.
 * - **I1** after `pnpm db:seed` the `ups` row is active and sorts after
 *   `electrical` and before `hvac` (S1 pins the exact `15`; a pack domain
 *   placed at 11-14 must not redden this).
 * - **I2** the seven codes read `domain = 'ups'`, and none reads
 *   `electrical`. Not "all active": an admin may retire one, and the check
 *   would then be red forever on that database (AGENTS.md §4.6, F4.40).
 * - **I3** the re-file reaches a database seeded before this change: with the
 *   seven codes set back to `electrical` inside a rolled-back transaction, one
 *   seed pass files them under `ups` again (`domain = EXCLUDED.domain`).
 * - **I4** the UPS Control Room view still lists them: the view keys on the
 *   asset code (`CR-UPS-*`, `CR-BATT-*`) and on the point code, never on
 *   `point_keys.domain`, so the seeded UPS and battery assets keep their asset
 *   domain and every seeded `CR_BATT_*` rule the view reads still targets an
 *   catalog code — now filed under `ups` (its `active` flag is an admin's to
 *   change, so not asserted here).
 * - **I5** the trend-point resolution over the real catalog filing puts the
 *   UPS default set in the `ups` segment and no UPS code in `electrical`. The
 *   flags come from `TREND_DEFAULT_SEED` (every code active), not from the
 *   rows, so an admin's `false` or a retire cannot redden it; the filing
 *   (`point_keys.domain`) and the segments are the database's.
 */

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");

/** The seven `CONTROL_ROOM_UPS_POINT_KEYS` codes, parsed from the source. */
function upsCodes(): string[] {
  const src = readFileSync(join(root, "packages/shared/src/constants.ts"), "utf8");
  const m = /export const CONTROL_ROOM_UPS_POINT_KEYS = \[([^\]]*)\]/.exec(src);
  if (!m) throw new Error("CONTROL_ROOM_UPS_POINT_KEYS not found");
  return [...(m[1] as string).matchAll(/"([a-z0-9_]+)"/g)].map((x) => x[1] as string);
}

const UPS = upsCodes();

describe("F4.300 U4b — the ups segment (static)", () => {
  it("S0 anti-vacuity: the source names seven UPS codes", () => {
    expect(UPS).toHaveLength(7);
  });

  it("S1 PACK_ASSET_DOMAINS declares ups / UPS, ordered after electrical (10) and before hvac (20)", () => {
    const row = PACK_ASSET_DOMAINS.find((d) => d.code === "ups");
    expect(row).toEqual({ code: "ups", label: "UPS", sortOrder: 15 });
  });

  it("S2 point-keys-seed files CONTROL_ROOM_UPS_POINT_KEYS under ups, once", () => {
    const seed = readFileSync(join(root, "packages/db/src/point-keys-seed.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    const calls = [...seed.matchAll(/keysForDomain\(\s*CONTROL_ROOM_UPS_POINT_KEYS\s*,\s*"([a-z_]+)"\s*\)/g)];
    expect(calls.map((c) => c[1])).toEqual(["ups"]);
  });
});

const fleetUrl = requireIntegrationDb({
  item: "F4.300 U4b",
  label: "the seeded ups segment (bms.asset_domains, bms.point_keys.domain)",
  because:
    "the ups row, the re-filed domain of the seven UPS codes and the rules the UPS Control Room view " +
    "reads are rows Postgres holds, so a green run without a database asserts nothing about any of them.",
  connection: "fleet",
});

const ownerUrl = requireIntegrationDb({
  item: "F4.300 U4b",
  label: "the ups re-file on an existing database (seedPointKeyCatalog)",
  because: "the re-file is an upsert Postgres runs; without a database nothing proves it reaches old rows.",
  connection: "owner",
});

type IntegrationPool = Awaited<ReturnType<typeof openIntegrationPool>>;

describe.skipIf(!fleetUrl || !ownerUrl)("F4.300 U4b — the ups segment (database)", () => {
  let fleet: IntegrationPool | undefined;
  let owner: IntegrationPool | undefined;

  beforeAll(async () => {
    fleet = await openIntegrationPool(fleetUrl as string, "F4.300 U4b");
    owner = await openIntegrationPool(ownerUrl as string, "F4.300 U4b");
  }, 60_000);

  afterAll(async () => {
    await fleet?.end();
    await owner?.end();
  }, 60_000);

  function db(): IntegrationPool {
    if (!fleet) throw new Error("pool not initialised");
    return fleet;
  }

  it("I1 holds an active ups row ordered after electrical and before hvac", async () => {
    const { rows } = await db().query<{ code: string; label: string; active: boolean }>(
      `SELECT code, label, active FROM bms.asset_domains ORDER BY sort_order, code`,
    );
    const at = rows.findIndex((r) => r.code === "ups");
    expect(at, "no ups row — run pnpm db:seed first").toBeGreaterThan(-1);
    expect(rows[at]).toEqual({ code: "ups", label: "UPS", active: true });
    const electrical = rows.findIndex((r) => r.code === "electrical");
    const hvac = rows.findIndex((r) => r.code === "hvac");
    expect(electrical, "precondition: electrical is seeded").toBeGreaterThan(-1);
    expect(hvac, "precondition: hvac is seeded").toBeGreaterThan(-1);
    expect(at, "ups sorts after electrical").toBeGreaterThan(electrical);
    expect(at, "ups sorts before hvac").toBeLessThan(hvac);
  });

  it("I2 files the seven UPS codes under ups", async () => {
    const { rows } = await db().query<{ code: string; domain: string | null }>(
      `SELECT code, domain FROM bms.point_keys WHERE code = ANY($1::text[]) ORDER BY code`,
      [UPS],
    );
    expect(rows).toHaveLength(7);
    for (const row of rows) expect(row, row.code).toEqual({ code: row.code, domain: "ups" });
  });

  it("I2b leaves no UPS code under electrical", async () => {
    const { rows } = await db().query<{ n: string }>(
      `SELECT count(*)::text AS n FROM bms.point_keys WHERE domain = 'electrical' AND code = ANY($1::text[])`,
      [UPS],
    );
    expect(rows[0]?.n).toBe("0");
  });

  it("I3 re-files a database seeded before this change in one seed pass", async () => {
    if (!owner) throw new Error("pool not initialised");
    const client = await owner.connect();
    try {
      await client.query("BEGIN");
      await client.query(`UPDATE bms.point_keys SET domain = 'electrical' WHERE code = ANY($1::text[])`, [UPS]);
      const before = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM bms.point_keys WHERE domain = 'electrical' AND code = ANY($1::text[])`,
        [UPS],
      );
      expect(before.rows[0]?.n, "precondition: the old filing").toBe("7");

      // `seedAssetDomains` / `seedPointKeyCatalog` take a `pg.Pool` and only call `query`.
      await seedAssetDomains(client as unknown as Parameters<typeof seedAssetDomains>[0]);
      await seedPointKeyCatalog(client as unknown as Parameters<typeof seedPointKeyCatalog>[0]);

      const after = await client.query<{ code: string; domain: string | null }>(
        `SELECT code, domain FROM bms.point_keys WHERE code = ANY($1::text[])`,
        [UPS],
      );
      expect(after.rows).toHaveLength(7);
      for (const row of after.rows) expect(row.domain, row.code).toBe("ups");
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }, 120_000);

  it("I4 keeps the Control Room UPS and battery assets' own domain", async () => {
    const { rows } = await db().query<{ code: string; domain: string }>(
      `SELECT DISTINCT a.code, a.domain FROM bms.assets a
        WHERE a.code IN ('CR-UPS-1', 'CR-UPS-2', 'CR-BATT-1', 'CR-BATT-2') ORDER BY a.code`,
    );
    expect(rows.map((r) => r.code)).toEqual(["CR-BATT-1", "CR-BATT-2", "CR-UPS-1", "CR-UPS-2"]);
    for (const row of rows) expect(row.domain, row.code).toBe("electrical");
  });

  it("I4b every seeded CR_BATT rule the UPS view reads targets a catalog code filed under ups", async () => {
    const { rows } = await db().query<{ rule: string; point_key: string; domain: string | null }>(
      `SELECT r.code AS rule, r.point_key, pk.domain
         FROM bms.automation_rules r
         JOIN bms.assets a ON a.id = r.asset_id
         LEFT JOIN bms.point_keys pk ON pk.code = r.point_key
        WHERE a.code IN ('CR-UPS-1', 'CR-UPS-2', 'CR-BATT-1', 'CR-BATT-2')
          -- The control-room threshold rules automation-rules-seed.ts writes. The
          -- same assets also carry breaker rules (ESKOM_CR_BATT_*_BREAKER_OPEN on
          -- breaker_main), which name no UPS code and are not this claim.
          AND (r.code LIKE 'CR\\_BATT\\_%' OR r.code LIKE 'CR\\_UPS\\_%')
        ORDER BY r.code`,
    );
    expect(rows.length, "anti-vacuity: the seeded CR_BATT_* rules").toBeGreaterThanOrEqual(4);
    for (const row of rows) {
      expect(UPS, `${row.rule} targets ${row.point_key}`).toContain(row.point_key);
      expect(row.domain, row.rule).toBe("ups");
    }
  });

  it("I5 resolves the UPS default set into the ups segment and none into electrical", async () => {
    const domains = await db().query<{ code: string; label: string; sort_order: number; active: boolean }>(
      `SELECT code, label, sort_order, active FROM bms.asset_domains`,
    );
    const catalog = await db().query<{
      code: string;
      name: string;
      unit: string | null;
      domain: string | null;
      headline_rank: number | null;
    }>(`SELECT code, name, unit, domain, headline_rank FROM bms.point_keys`);
    // The seed's flags, every code active: the claim is the filing, not an
    // admin's later edit of the flag or the active state.
    const rows: TrendCatalogRow[] = catalog.rows.map((r) => ({
      code: r.code,
      name: r.name,
      unit: r.unit,
      domain: r.domain,
      active: true,
      trendDefault: TREND_DEFAULT_SEED.includes(r.code),
      headlineRank: r.headline_rank,
    }));
    const segments = resolveSegments(
      domains.rows.map((d) => ({ code: d.code, label: d.label, sortOrder: d.sort_order, active: d.active })),
      rows,
      [],
    );

    const ups = segments.find((s) => s.domain === "ups");
    const expected = TREND_DEFAULT_SEED.filter((c) => UPS.includes(c)).sort();
    expect(expected.length, "anti-vacuity: the Q4 ups default set").toBeGreaterThanOrEqual(3);
    expect(ups?.label).toBe("UPS");
    expect(ups?.catalogDefaults.map((p) => p.code).sort()).toEqual(expected);

    const electrical = segments.find((s) => s.domain === "electrical");
    expect(electrical?.catalogDefaults.length, "positive control: electrical keeps its defaults").toBeGreaterThan(0);
    for (const point of electrical?.catalogDefaults ?? []) expect(UPS, point.code).not.toContain(point.code);
  });
});
