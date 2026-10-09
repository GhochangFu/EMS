import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type * as HealthSeed from "../packages/db/dist/asset-template-health-seed.js";
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
const { seedAssetTemplateHealth } = require_(
  "../packages/db/dist/asset-template-health-seed.js",
) as typeof HealthSeed;
const { createSeedPool } = require_("../packages/db/dist/seed-tenant.js") as typeof SeedTenant;

/**
 * `F2.32` (ADR 0058 Amendment 3) — a seeded baseline per domain AND role, and
 * the one-time re-pin of a database seeded before it.
 *
 * **This suite never seeds.** The read cases assert the state `pnpm db:seed`
 * left; the write cases call `seedAssetTemplateHealth` inside `BEGIN` …
 * `ROLLBACK` on the seed pool's one connection, in ESKOM's tenant context, so
 * nothing they write survives the case.
 *
 * Connection `"owner"`, as `pnpm db:seed` runs (`seed-tenant.ts`), so the
 * `FORCE ROW LEVEL SECURITY` path is the real one.
 */

const ownerUrl = requireIntegrationDb({
  item: "F2.32",
  label: "the per-role health baselines and the one-time re-pin",
  because:
    "the class a template is built from is an asset_group_members join and the re-pin is an " +
    "UPDATE under FORCE ROW LEVEL SECURITY, so a green run without a real Postgres asserts " +
    "nothing about either.",
  connection: "owner",
});

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

type IntegrationPool = Awaited<ReturnType<typeof openIntegrationPool>>;
type SeedPool = ReturnType<typeof createSeedPool>;

const RUN_ID = randomUUID().slice(0, 8).toUpperCase();

/** The point keys a template declares, by code, version 1, in ESKOM. */
async function keysOf(pool: IntegrationPool, orgId: string, code: string): Promise<string[]> {
  const rows = await pool.query<{ point_key: string }>(
    `SELECT tp.point_key
       FROM bms.template_points tp
       JOIN bms.asset_templates t ON t.id = tp.template_id
      WHERE t.organization_id = $1 AND t.code = $2 AND t.version = 1
      ORDER BY tp.point_key`,
    [orgId, code],
  );
  assert(rows.rows.length > 0, `${code} v1 declares no point in ESKOM — run pnpm db:seed.`);
  return rows.rows.map((row) => row.point_key);
}

describe.skipIf(!ownerUrl)("F2.32 — a seeded health baseline per domain and role", () => {
  let probePool: IntegrationPool | undefined;
  let seedPool: SeedPool | undefined;
  let eskomOrgId = "";

  beforeAll(async () => {
    const url = ownerUrl as string;
    probePool = await openIntegrationPool(resolveIntegrationRoleUrl(url, "fleet", process.env), "F2.32");
    seedPool = createSeedPool(url);
    const org = await probePool.query<{ id: string }>(`SELECT id FROM bms.organizations WHERE code = 'ESKOM'`);
    eskomOrgId = org.rows[0]?.id ?? "";
    assert(eskomOrgId !== "", "the ESKOM organization is not seeded — run pnpm db:seed.");
  }, 60_000);

  afterAll(async () => {
    await seedPool?.end();
    await probePool?.end();
  }, 60_000);

  it("BASELINE-ELECTRICAL-TRANSFORMER does not declare the battery key backup_min", async () => {
    const keys = await keysOf(probePool as IntegrationPool, eskomOrgId, "BASELINE-ELECTRICAL-TRANSFORMER");
    expect(keys).not.toContain("backup_min");
  });

  it("BASELINE-ELECTRICAL-BATTERY declares backup_min (the positive beside the absence)", async () => {
    const keys = await keysOf(probePool as IntegrationPool, eskomOrgId, "BASELINE-ELECTRICAL-BATTERY");
    expect(keys).toContain("backup_min");
  });

  it("the domain baseline keeps the union, as the fallback (BASELINE-ELECTRICAL still declares backup_min)", async () => {
    const keys = await keysOf(probePool as IntegrationPool, eskomOrgId, "BASELINE-ELECTRICAL");
    expect(keys).toContain("backup_min");
  });

  // No read case asserts "no roled asset is on its domain baseline v1": ADR
  // 0058 Amendment 3 decision 4 makes that a legal state once an operator
  // instantiates from, or migrates back to, that row, and the seed leaves it.
  // The rolled-back cases below hold the seed's side of it.

  it("every ESKOM asset on a role template holds that template's role, and some do", async () => {
    const rows = await (probePool as IntegrationPool).query<{ on_role: number; mismatched: number }>(
      `SELECT count(*)::int AS on_role,
              count(*) FILTER (WHERE t.code IS DISTINCT FROM
                'BASELINE-' || upper(a.domain) || '-' || upper(replace(
                  (SELECT min(agm.role) FROM bms.asset_group_members agm WHERE agm.asset_id = a.id),
                  '-', '_')))::int AS mismatched
         FROM bms.assets a
         JOIN bms.asset_templates t ON t.id = a.template_id
        WHERE a.organization_id = $1 AND a.active = true
          AND t.code LIKE 'BASELINE-%-%'
          AND t.code <> 'BASELINE-ELECTRICAL-INCOMER'`,
      [eskomOrgId],
    );
    expect(rows.rows[0]?.mismatched).toBe(0);
    expect(rows.rows[0]?.on_role).toBeGreaterThan(0);
  });

  /** What the re-pin fixture hands its body. */
  type RepinFixture = {
    pool: SeedPool;
    transformerId: string;
    batteryId: string;
    domainId: string;
    operatorTemplateId: string;
    templateCodeOf: (assetId: string) => Promise<string>;
  };

  /**
   * In one rolled-back ESKOM transaction: puts a seeded transformer on
   * `BASELINE-ELECTRICAL` v1, migrates a seeded battery to an operator's own
   * template (ADR 0039's path), and hands both to `body`. The `ROLLBACK` is
   * in a `finally`.
   *
   * `preF232` makes the transaction look like a database seeded before
   * `F2.32`: it renames the seeded `BASELINE-ELECTRICAL-TRANSFORMER`, so the
   * next seed run inserts that role template afresh — the one run decision 4
   * lets re-pin. A rename rather than a delete, because three tables hold a
   * foreign key to `asset_templates` with `NO ACTION`.
   *
   * Every assertion reads an asset or a template this fixture owns, never an
   * org-wide count of pins or templates: under READ COMMITTED another suite
   * can commit an unpinned ESKOM asset between two statements here, and the
   * pin would count it. `repinned` stays exact, because a run moves an asset
   * only to a role template that the same run inserted.
   */
  async function withRepinFixture(
    options: { preF232: boolean },
    body: (fixture: RepinFixture) => Promise<void>,
  ): Promise<void> {
    const pool = seedPool as SeedPool;
    await pool.query("BEGIN");
    try {
      await pool.query("select set_config('app.current_organization', $1, true)", [eskomOrgId]);
      const pick = async (role: string): Promise<string> => {
        const found = await pool.query<{ id: string }>(
          `SELECT a.id FROM bms.assets a
            WHERE a.organization_id = $1 AND a.active = true AND a.domain = 'electrical'
              AND (SELECT min(agm.role) FROM bms.asset_group_members agm WHERE agm.asset_id = a.id) = $2
            ORDER BY a.created_at, a.id LIMIT 1 FOR UPDATE`,
          [eskomOrgId, role],
        );
        const id = found.rows[0]?.id;
        assert(!!id, `ESKOM has no active electrical asset with role ${role} — run pnpm db:seed.`);
        return id as string;
      };
      const transformerId = await pick("transformer");
      const batteryId = await pick("battery");

      const domain = await pool.query<{ id: string }>(
        `SELECT id FROM bms.asset_templates
          WHERE organization_id = $1 AND code = 'BASELINE-ELECTRICAL' AND version = 1`,
        [eskomOrgId],
      );
      const domainId = domain.rows[0]?.id;
      assert(!!domainId, "BASELINE-ELECTRICAL v1 is not seeded — run pnpm db:seed.");

      const operator = await pool.query<{ id: string }>(
        `INSERT INTO bms.asset_templates
           (organization_id, code, version, name, asset_type, domain, status, published_at)
         VALUES ($1, $2, 1, 'F2.32 operator fixture', 'test_rig', 'electrical', 'published', now())
         RETURNING id`,
        [eskomOrgId, `F232-OP-${RUN_ID}`],
      );
      const operatorTemplateId = operator.rows[0]?.id as string;

      if (options.preF232) {
        const renamed = await pool.query(
          `UPDATE bms.asset_templates SET code = code || $2
            WHERE organization_id = $1 AND code = 'BASELINE-ELECTRICAL-TRANSFORMER'`,
          [eskomOrgId, `-PRE-${RUN_ID}`],
        );
        assert((renamed.rowCount ?? 0) >= 1, "BASELINE-ELECTRICAL-TRANSFORMER is not seeded — run pnpm db:seed.");
      }

      await pool.query(`UPDATE bms.assets SET template_id = $1 WHERE id = $2`, [domainId, transformerId]);
      await pool.query(`UPDATE bms.assets SET template_id = $1 WHERE id = $2`, [
        operatorTemplateId,
        batteryId,
      ]);

      await body({
        pool,
        transformerId,
        batteryId,
        domainId: domainId as string,
        operatorTemplateId,
        templateCodeOf: async (assetId) => {
          const row = await pool.query<{ code: string }>(
            `SELECT t.code FROM bms.assets a JOIN bms.asset_templates t ON t.id = a.template_id
              WHERE a.id = $1`,
            [assetId],
          );
          return row.rows[0]?.code ?? "";
        },
      });
    } finally {
      await pool.query("ROLLBACK");
    }
  }

  it("re-pins a transformer on BASELINE-ELECTRICAL v1 in the run that inserts BASELINE-ELECTRICAL-TRANSFORMER", async () => {
    await withRepinFixture({ preF232: true }, async ({ pool, transformerId, templateCodeOf }) => {
      expect(await templateCodeOf(transformerId)).toBe("BASELINE-ELECTRICAL");
      const result = await seedAssetTemplateHealth(pool, eskomOrgId);
      expect(result.repinned).toBeGreaterThanOrEqual(1);
      expect(await templateCodeOf(transformerId)).toBe("BASELINE-ELECTRICAL-TRANSFORMER");
    });
  }, 60_000);

  it("leaves an operator's migration alone while the same run re-pins the transformer", async () => {
    await withRepinFixture({ preF232: true }, async ({ pool, transformerId, batteryId, templateCodeOf }) => {
      await seedAssetTemplateHealth(pool, eskomOrgId);
      // The positive first: this run did re-pin, so the absence below is not
      // the absence of a re-pin at all.
      expect(await templateCodeOf(transformerId)).toBe("BASELINE-ELECTRICAL-TRANSFORMER");
      expect(await templateCodeOf(batteryId)).toBe(`F232-OP-${RUN_ID}`);
    });
  }, 60_000);

  it("re-pins once: after the inserting run, an asset an operator moves back to v1 stays there", async () => {
    await withRepinFixture({ preF232: true }, async ({ pool, transformerId, domainId, templateCodeOf }) => {
      await seedAssetTemplateHealth(pool, eskomOrgId);
      // The positive: run 1 moved it, so run 2's absence is decision 4's.
      expect(await templateCodeOf(transformerId)).toBe("BASELINE-ELECTRICAL-TRANSFORMER");
      await pool.query(`UPDATE bms.assets SET template_id = $1 WHERE id = $2`, [domainId, transformerId]);
      const second = await seedAssetTemplateHealth(pool, eskomOrgId);
      expect(second.repinned).toBe(0);
      expect(await templateCodeOf(transformerId)).toBe("BASELINE-ELECTRICAL");
    });
  }, 60_000);

  it("on a database whose role templates exist, an asset on BASELINE-ELECTRICAL v1 stays and the verify passes", async () => {
    await withRepinFixture({ preF232: false }, async ({ pool, transformerId, templateCodeOf }) => {
      // The role template exists, so the absence below is not a missing target.
      const target = await pool.query(
        `SELECT 1 FROM bms.asset_templates
          WHERE organization_id = $1 AND code = 'BASELINE-ELECTRICAL-TRANSFORMER' AND version = 1`,
        [eskomOrgId],
      );
      expect(target.rowCount).toBe(1);
      const result = await seedAssetTemplateHealth(pool, eskomOrgId);
      expect(result.repinned).toBe(0);
      expect(await templateCodeOf(transformerId)).toBe("BASELINE-ELECTRICAL");
    });
  }, 60_000);
});
