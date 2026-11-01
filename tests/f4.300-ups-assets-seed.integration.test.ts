import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type * as AssetGroupsSeed from "../packages/db/dist/asset-groups-seed.js";
import type * as AutomationRulesSeed from "../packages/db/dist/automation-rules-seed.js";
import type * as DbClient from "../packages/db/dist/client.js";
import type * as EskomAssetsSeed from "../packages/db/dist/eskom-assets-seed.js";
import type * as HealthSeed from "../packages/db/dist/asset-template-health-seed.js";
import type * as HierarchySeed from "../packages/db/dist/hierarchy-seed.js";
import type * as SeedTenant from "../packages/db/dist/seed-tenant.js";
import {
  openIntegrationPool,
  requireIntegrationDb,
  resolveIntegrationRoleUrl,
} from "../apps/api/src/testing/integration-db-gate.js";

// Loaded from `packages/db/dist` through `createRequire`, for the reason
// `tests/f4.129-ladder-rule-code-bound.integration.test.ts` gives: the
// non-strict `typecheck:tests` flags fail on the seed sources. After a source
// edit, run `pnpm --filter @bms/db build` before this suite, or it runs the
// last build.
const require_ = createRequire(import.meta.url);
const { eskomSeedAssetCatalog, seedEskomAssets } = require_(
  "../packages/db/dist/eskom-assets-seed.js",
) as typeof EskomAssetsSeed;
const { DOMAIN_RTU_SUFFIX, rtuDomainForAssetDomain } = require_(
  "../packages/db/dist/hierarchy-seed.js",
) as typeof HierarchySeed;
const { demoGroupCodesForAsset, demoRoleForAsset } = require_(
  "../packages/db/dist/asset-groups-seed.js",
) as typeof AssetGroupsSeed;
const { LADDER_ASSET_DOMAINS, ESKOM_LADDER_RULES, ladderRuleCode } = require_(
  "../packages/db/dist/automation-rules-seed.js",
) as typeof AutomationRulesSeed;
const { seedAssetTemplateHealth } = require_(
  "../packages/db/dist/asset-template-health-seed.js",
) as typeof HealthSeed;
const { createDb } = require_("../packages/db/dist/client.js") as typeof DbClient;
const { createSeedPool } = require_("../packages/db/dist/seed-tenant.js") as typeof SeedTenant;

/**
 * `F4.300` U4c (owner ruling 2026-11-01, "Move UPS assets too") — the seeded
 * UPS and battery assets join the `ups` segment U4b created for their point
 * codes.
 *
 * Static (no database):
 * - **S1** every seeded catalog asset that `demoGroupCodesForAsset` puts in the
 *   `ups-battery` group is `ups`, and no `electrical` catalog asset is one.
 * - **S2** a `ups` asset runs on its site's electrical simulator RTU: no
 *   `UPS` RTU exists, and `rtuDomainForAssetDomain` maps `ups` to `electrical`.
 * - **S3** the ladder seed and its boot gate read `electrical` and `ups`.
 * - **S4** `seed.ts` writes the `ups` domain row before the first asset that
 *   names it (`assets.domain` is a foreign key to `bms.asset_domains`).
 *
 * Database (`pnpm db:seed` already run):
 * - **I1** the UPS and battery catalog assets read `ups`.
 * - **I2** each one sits on an electrical simulator RTU.
 * - **I3** each one is pinned to a `ups` template.
 * - **I4** each keeps its `ups` or `battery` role.
 * - **I5** each still carries the seeded ladder (the rules the ladder seed wrote).
 * - **I6** an old database moves in one seed pass: with the assets set back to
 *   `electrical` and pinned to an electrical seed baseline inside a rolled-back
 *   transaction, `seedEskomAssets` + `seedAssetTemplateHealth` file them under
 *   `ups` and pin them to a `ups` template without the verify throwing.
 */

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");

function codeOnly(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const CATALOG = eskomSeedAssetCatalog();
/** The catalog's UPS and battery assets, by the group rule (code-keyed, domain-blind for these). */
const UPS_ASSETS = CATALOG.filter(
  (asset) =>
    asset.domain !== "environment" && demoGroupCodesForAsset(asset.code, asset.domain).includes("ups-battery"),
);
const UPS_CODES = UPS_ASSETS.map((asset) => asset.code);
const CONTROL_ROOM_CODES = ["CR-UPS-1", "CR-UPS-2", "CR-BATT-1", "CR-BATT-2"];

describe("F4.300 U4c — UPS assets join the ups segment (static)", () => {
  it("S0 anti-vacuity: the catalog holds the Control Room UPS and battery assets and UPS-A", () => {
    for (const code of [...CONTROL_ROOM_CODES, "UPS-A", "CR-UPS-OUT-BUS"]) expect(UPS_CODES).toContain(code);
    expect(UPS_CODES.some((code) => /^[A-Z]+-CR-UPS-1$/.test(code)), "a regional RSMOC UPS").toBe(true);
    expect(UPS_CODES.some((code) => /^[A-Z]+-CR-BATT-1$/.test(code)), "a regional RSMOC battery").toBe(true);
  });

  it("S1a every UPS and battery catalog asset is ups", () => {
    for (const asset of UPS_ASSETS) expect(asset.domain, asset.code).toBe("ups");
  });

  it("S1b no electrical catalog asset names a UPS or a battery (the positive beside S1a)", () => {
    const electrical = CATALOG.filter((asset) => asset.domain === "electrical");
    expect(electrical.length, "positive control: electrical assets remain").toBeGreaterThan(0);
    for (const asset of electrical) expect(asset.code, asset.code).not.toMatch(/UPS|BATT/);
  });

  it("S1c the environment rooms named for a UPS or a battery stay environment", () => {
    const rooms = CATALOG.filter((asset) => asset.code === "CR-ENV-UPS-ROOM" || asset.code === "CR-ENV-BATTERY-ROOM");
    expect(rooms).toHaveLength(2);
    for (const room of rooms) expect(room.domain, room.code).toBe("environment");
  });

  it("S2 a ups asset runs on the electrical simulator RTU, and no UPS RTU exists", () => {
    expect(rtuDomainForAssetDomain("ups")).toBe("electrical");
    expect(DOMAIN_RTU_SUFFIX[rtuDomainForAssetDomain("ups")]).toBe("ELEC");
    expect(Object.keys(DOMAIN_RTU_SUFFIX)).not.toContain("ups");
    // The adjacent positive: every other domain still maps to itself.
    expect(rtuDomainForAssetDomain("hvac")).toBe("hvac");
  });

  it("S2b the seeded UPS and battery assets keep their roles under ups", () => {
    expect(demoRoleForAsset("CR-UPS-1", "ups")).toBe("ups");
    expect(demoRoleForAsset("CR-BATT-2", "ups")).toBe("battery");
  });

  it("S3 the ladder seed and its boot gate read electrical and ups", () => {
    expect([...LADDER_ASSET_DOMAINS]).toEqual(["electrical", "ups"]);
    const seed = codeOnly(readFileSync(join(root, "packages/db/src/automation-rules-seed.ts"), "utf8"));
    expect(seed).toMatch(/inArray\(assets\.domain, \[\.\.\.LADDER_ASSET_DOMAINS\]\)/);
    expect(seed).not.toMatch(/eq\(assets\.domain, "electrical"\)/);
    const verify = codeOnly(readFileSync(join(root, "packages/db/src/verify-hierarchy-seed.ts"), "utf8"));
    expect(verify).toMatch(/a\.domain = ANY\(\$1::text\[\]\)/);
    expect(verify).not.toMatch(/a\.domain = 'electrical'/);
  });

  it("S4 seed.ts writes the domain rows before the first asset", () => {
    const seed = codeOnly(readFileSync(join(root, "packages/db/src/seed.ts"), "utf8"));
    const domainsAt = seed.indexOf("await seedAssetDomains(pool);");
    const assetsAt = seed.indexOf("await seedEskomAssets(");
    expect(domainsAt).toBeGreaterThan(-1);
    expect(assetsAt).toBeGreaterThan(-1);
    expect(domainsAt).toBeLessThan(assetsAt);
  });
});

const ownerUrl = requireIntegrationDb({
  item: "F4.300 U4c",
  label: "the seeded UPS and battery assets under ups (domain, RTU, template pin, role, ladder)",
  because:
    "the domain, the RTU, the template pin, the role and the ladder rules are rows Postgres holds, and " +
    "the move of an old database is an UPDATE under FORCE ROW LEVEL SECURITY, so a green run without a " +
    "database asserts nothing about any of them.",
  connection: "owner",
});

type IntegrationPool = Awaited<ReturnType<typeof openIntegrationPool>>;
type SeedPool = ReturnType<typeof createSeedPool>;

describe.skipIf(!ownerUrl)("F4.300 U4c — UPS assets join the ups segment (database)", () => {
  let fleet: IntegrationPool | undefined;
  let seedPool: SeedPool | undefined;
  let eskomOrgId = "";

  beforeAll(async () => {
    const url = ownerUrl as string;
    fleet = await openIntegrationPool(resolveIntegrationRoleUrl(url, "fleet", process.env), "F4.300 U4c");
    seedPool = createSeedPool(url);
    const org = await fleet.query<{ id: string }>(`SELECT id FROM bms.organizations WHERE code = 'ESKOM'`);
    eskomOrgId = org.rows[0]?.id ?? "";
    expect(eskomOrgId, "the ESKOM organization is not seeded — run pnpm db:seed").not.toBe("");
  }, 60_000);

  afterAll(async () => {
    await seedPool?.end();
    await fleet?.end();
  }, 60_000);

  function db(): IntegrationPool {
    if (!fleet) throw new Error("pool not initialised");
    return fleet;
  }

  type AssetRow = {
    code: string;
    domain: string;
    rtu_domain: string | null;
    rtu_source: string | null;
    template_code: string | null;
    template_domain: string | null;
    role: string | null;
  };

  async function upsRows(): Promise<AssetRow[]> {
    const { rows } = await db().query<AssetRow>(
      `SELECT a.code, a.domain, r.domain AS rtu_domain, r.source_type AS rtu_source,
              t.code AS template_code, t.domain AS template_domain,
              (SELECT min(agm.role) FROM bms.asset_group_members agm WHERE agm.asset_id = a.id) AS role
         FROM bms.assets a
         JOIN bms.organizations o ON o.id = a.organization_id
         LEFT JOIN bms.rtus r ON r.id = a.rtu_id
         LEFT JOIN bms.asset_templates t ON t.id = a.template_id
        WHERE o.code = 'ESKOM' AND a.code = ANY($1::text[])
        ORDER BY a.code`,
      [UPS_CODES],
    );
    return rows;
  }

  it("I1 the UPS and battery catalog assets read ups", async () => {
    const rows = await upsRows();
    expect(rows.map((r) => r.code).sort()).toEqual([...UPS_CODES].sort());
    for (const row of rows) expect(row.domain, row.code).toBe("ups");
  });

  it("I2 each one sits on an electrical simulator RTU", async () => {
    for (const row of await upsRows()) {
      expect({ rtu: row.rtu_domain, source: row.rtu_source }, row.code).toEqual({
        rtu: "electrical",
        source: "simulator",
      });
    }
  });

  it("I3 each one is pinned to a ups template", async () => {
    for (const row of await upsRows()) {
      expect(row.template_domain, `${row.code} on ${row.template_code}`).toBe("ups");
    }
  });

  it("I4 each keeps its ups or battery role", async () => {
    for (const row of await upsRows()) {
      expect(row.role, row.code).toBe(row.code.includes("BATT") ? "battery" : "ups");
    }
  });

  it("I5 each still carries a seeded ladder rule", async () => {
    const codes = UPS_CODES.flatMap((code) => ESKOM_LADDER_RULES.map((rule) => ladderRuleCode(code, rule.suffix)));
    const { rows } = await db().query<{ code: string }>(
      `SELECT a.code FROM bms.automation_rules r JOIN bms.assets a ON a.id = r.asset_id
        WHERE r.code = ANY($1::text[])`,
      [codes],
    );
    const covered = new Set(rows.map((r) => r.code));
    for (const code of UPS_CODES) expect(covered.has(code), code).toBe(true);
  });

  it("I6 moves an old database in one seed pass: domain and template pin", async () => {
    const pool = seedPool as SeedPool;
    await pool.query("BEGIN");
    try {
      await pool.query("select set_config('app.current_organization', $1, true)", [eskomOrgId]);
      const baseline = await pool.query<{ id: string }>(
        `SELECT id FROM bms.asset_templates
          WHERE organization_id = $1 AND asset_type = 'baseline' AND domain = 'electrical'
            AND version = 1 AND code LIKE 'BASELINE-%'
          ORDER BY code LIMIT 1`,
        [eskomOrgId],
      );
      const baselineId = baseline.rows[0]?.id;
      expect(baselineId, "no electrical seed baseline — run pnpm db:seed").toBeTruthy();
      const old = await pool.query(
        `UPDATE bms.assets SET domain = 'electrical', template_id = $2
          WHERE organization_id = $1 AND code = ANY($3::text[])`,
        [eskomOrgId, baselineId, UPS_CODES],
      );
      expect(old.rowCount, "precondition: the old state").toBe(UPS_CODES.length);

      // The UPS entries only: the same upsert path, and it locks only the rows it
      // moves, so another suite's seed transaction does not deadlock on the rest.
      await seedEskomAssets(createDb(pool), pool, UPS_ASSETS, eskomOrgId);
      const result = await seedAssetTemplateHealth(pool, eskomOrgId);
      expect(result.released).toBeGreaterThanOrEqual(UPS_CODES.length);

      const after = await pool.query<{ code: string; domain: string; template_domain: string | null }>(
        `SELECT a.code, a.domain, t.domain AS template_domain
           FROM bms.assets a LEFT JOIN bms.asset_templates t ON t.id = a.template_id
          WHERE a.organization_id = $1 AND a.code = ANY($2::text[])`,
        [eskomOrgId, UPS_CODES],
      );
      expect(after.rows).toHaveLength(UPS_CODES.length);
      for (const row of after.rows) {
        expect({ domain: row.domain, template: row.template_domain }, row.code).toEqual({
          domain: "ups",
          template: "ups",
        });
      }
    } finally {
      await pool.query("ROLLBACK");
    }
  }, 180_000);
});
