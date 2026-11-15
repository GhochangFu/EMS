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
 * `F4.373` / ADR 0134 Amendment 3 — what migration `0156` guarantees against a
 * real database. The lifecycle is `tests/f4.365-tariff-schema.integration.test.ts`'s:
 * superuser pool, one held client, every case a rolled-back transaction, a
 * per-probe SAVEPOINT. Isolation cases run as `bms_tenant` (`bms_fleet` holds
 * BYPASSRLS).
 */
const connectionString = process.env.DATABASE_URL;

requireIntegrationDb({
  item: "F4.373",
  label: "location tariff meters schema tests",
  because:
    "the composite mapping FK, the asset cascade, the tenant_isolation policy's own and asset legs and " +
    "the 0156 backfill are things Postgres enforces.",
  connection: "superuser",
});

const RUN = randomUUID().slice(0, 8);
const has = connectionString !== undefined && connectionString !== "";

type IntegrationPool = Awaited<ReturnType<typeof openIntegrationPool>>;
type Row = Record<string, unknown>;
type IntegrationClient = {
  query: <R extends Row = Row>(sql: string, params?: unknown[]) => Promise<{ rows: R[] }>;
  release: () => void;
};
type PgError = { code?: string; constraint?: string };

const BACKFILL = (() => {
  const file = join(fileURLToPath(new URL("..", import.meta.url)), "packages", "db", "drizzle", "0156_location_tariff_meters.sql");
  const statement = /INSERT INTO bms\.location_tariff_meters[\s\S]*?;/.exec(readFileSync(file, "utf8"))?.[0];
  if (!statement) throw new Error("F4.373: 0156 has no backfill INSERT");
  return statement;
})();

describe.skipIf(!has)("F4.373 — location_tariff_meters against a live database", () => {
  let pool: IntegrationPool;
  let client: IntegrationClient;
  let orgA = "";
  let orgB = "";

  beforeAll(async () => {
    pool = await openIntegrationPool(resolveIntegrationRoleUrl(connectionString as string, "superuser", process.env), "F4.373");
    client = (await pool.connect()) as unknown as IntegrationClient;
    const orgs = await client.query<{ id: string }>(`SELECT id FROM bms.organizations ORDER BY created_at, code LIMIT 2`);
    if (orgs.rows.length < 2) throw new Error("F4.373: needs two bms.organizations rows — run pnpm db:seed.");
    orgA = orgs.rows[0]?.id as string;
    orgB = orgs.rows[1]?.id as string;
  });

  afterAll(async () => {
    client?.release();
    await pool?.end();
  });

  const run = (sql: string, params?: unknown[]) => client.query(sql, params);

  const tx = async (body: () => Promise<void>): Promise<void> => {
    await run("BEGIN");
    try {
      await body();
    } finally {
      await run("ROLLBACK");
    }
  };

  const as = async (role: "bms_owner" | "bms_tenant", org: string): Promise<void> => {
    await run(`SET LOCAL ROLE ${role}`);
    await run(`SET LOCAL app.current_organization = '${org}'`);
  };

  const refuses = async (sql: string, params: unknown[], code: string, constraint?: string): Promise<void> => {
    await run("SAVEPOINT probe");
    let err: PgError | undefined;
    try {
      await run(sql, params);
    } catch (e) {
      err = e as PgError;
    }
    await run("ROLLBACK TO SAVEPOINT probe");
    expect(err?.code, `expected SQLSTATE ${code}`).toBe(code);
    if (constraint) expect(err?.constraint).toBe(constraint);
  };

  /** A location + meter + mapping of `org`, written as bms_owner under that org's GUC. */
  const seedMapping = async (org: string, suffix: string): Promise<{ mappingId: string; meter: string; locationId: string }> => {
    await as("bms_owner", org);
    const loc = await run(`SELECT id FROM bms.locations WHERE organization_id = $1 ORDER BY created_at, code LIMIT 1`, [org]);
    const locationId = loc.rows[0]?.id as string;
    if (!locationId) throw new Error(`F4.373: org ${org} needs a seeded location`);
    const domain = (await run(`SELECT code FROM bms.asset_domains ORDER BY code`)).rows[0]?.code;
    const asset = await run(
      `INSERT INTO bms.assets (organization_id, location_id, code, name, site_name, domain)
       VALUES ($1, $2, $3, $4, 'F4.373', $5) RETURNING id`,
      [org, locationId, `F4373-${suffix}-${RUN}`, `F4.373 ${suffix}`, domain],
    );
    const meter = asset.rows[0]?.id as string;
    const mapping = await run(
      `INSERT INTO bms.location_tariffs (organization_id, location_id, tariff_key, billing_meter_asset_id, sanctioned_load, sanctioned_load_unit, effective_from)
       VALUES ($1, $2, 'k', $3, 10, 'kw', '2031-01-01') RETURNING id`,
      [org, locationId, meter],
    );
    return { mappingId: mapping.rows[0]?.id as string, meter, locationId };
  };

  const secondMeter = async (org: string, locationId: string, suffix: string): Promise<string> => {
    const domain = (await run(`SELECT code FROM bms.asset_domains ORDER BY code`)).rows[0]?.code;
    const asset = await run(
      `INSERT INTO bms.assets (organization_id, location_id, code, name, site_name, domain)
       VALUES ($1, $2, $3, $4, 'F4.373', $5) RETURNING id`,
      [org, locationId, `F4373-${suffix}-${RUN}`, `F4.373 ${suffix}`, domain],
    );
    return asset.rows[0]?.id as string;
  };

  const METER = `INSERT INTO bms.location_tariff_meters (location_tariff_id, organization_id, asset_id) VALUES ($1, $2, $3)`;

  it("is enabled and forced under RLS, owned by bms_owner", async () => {
    const r = await run(
      `SELECT c.relrowsecurity, c.relforcerowsecurity, pg_get_userbyid(c.relowner) AS owner
         FROM pg_class c WHERE c.oid = 'bms.location_tariff_meters'::regclass`,
    );
    expect(r.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true, owner: "bms_owner" });
  });

  it("own meters pass; another org's meter or mapping is refused; a meter row cannot cross organizations", async () => {
    await tx(async () => {
      const b = await seedMapping(orgB, "B");
      await run(METER, [b.mappingId, orgB, b.meter]);
      const a = await seedMapping(orgA, "A");
      const a2 = await secondMeter(orgA, a.locationId, "A2");

      await as("bms_tenant", orgA);
      expect((await run(`SELECT current_user`)).rows[0]?.current_user).toBe("bms_tenant");
      await run(METER, [a.mappingId, orgA, a.meter]);
      await run(METER, [a.mappingId, orgA, a2]);
      const own = await run(`SELECT asset_id FROM bms.location_tariff_meters WHERE location_tariff_id = $1 ORDER BY asset_id`, [a.mappingId]);
      expect(own.rows.map((r) => r.asset_id).sort()).toEqual([a.meter, a2].sort());
      // Org B's meter under org A's mapping: only the asset leg refuses it.
      await refuses(METER, [a.mappingId, orgA, b.meter], "42501");
      // Claiming org B: the own-column leg refuses it.
      await refuses(METER, [b.mappingId, orgB, a.meter], "42501");
      // A duplicate meter on one mapping: the primary key.
      await refuses(METER, [a.mappingId, orgA, a.meter], "23505");
      const seenB = await run(`SELECT count(*)::int AS n FROM bms.location_tariff_meters WHERE organization_id = $1`, [orgB]);
      expect(seenB.rows[0]?.n, "org A sees none of org B's meter rows").toBe(0);

      // As bms_owner (FORCE binds it too, but the composite FK runs with row security off):
      // org A's meter row naming org B's mapping is refused structurally.
      await as("bms_owner", orgA);
      await refuses(METER, [b.mappingId, orgA, a.meter], "23503", "location_tariff_meters_mapping_fk");
    });
  });

  it("cascades with the mapping and with the asset", async () => {
    await tx(async () => {
      const a = await seedMapping(orgA, "C");
      const a2 = await secondMeter(orgA, a.locationId, "C2");
      await run(METER, [a.mappingId, orgA, a.meter]);
      await run(METER, [a.mappingId, orgA, a2]);
      await run(`DELETE FROM bms.assets WHERE id = $1`, [a2]);
      const left = await run(`SELECT asset_id FROM bms.location_tariff_meters WHERE location_tariff_id = $1`, [a.mappingId]);
      expect(left.rows.map((r) => r.asset_id)).toEqual([a.meter]);
      await run(`DELETE FROM bms.location_tariffs WHERE id = $1`, [a.mappingId]);
      const none = await run(`SELECT count(*)::int AS n FROM bms.location_tariff_meters WHERE location_tariff_id = $1`, [a.mappingId]);
      expect(none.rows[0]?.n).toBe(0);
    });
  });

  it("the 0156 backfill copies an existing mapping's billing meter, and a second run changes nothing", async () => {
    await tx(async () => {
      const a = await seedMapping(orgA, "D");
      const b = await seedMapping(orgB, "E");
      await run("RESET ROLE");
      const before = await run(`SELECT count(*)::int AS n FROM bms.location_tariff_meters WHERE location_tariff_id = ANY($1::uuid[])`, [[a.mappingId, b.mappingId]]);
      expect(before.rows[0]?.n).toBe(0);
      await run(BACKFILL);
      await run(BACKFILL);
      const after = await run(
        `SELECT location_tariff_id, organization_id, asset_id FROM bms.location_tariff_meters
          WHERE location_tariff_id = ANY($1::uuid[]) ORDER BY organization_id = $2 DESC`,
        [[a.mappingId, b.mappingId], orgA],
      );
      expect(after.rows).toEqual([
        { location_tariff_id: a.mappingId, organization_id: orgA, asset_id: a.meter },
        { location_tariff_id: b.mappingId, organization_id: orgB, asset_id: b.meter },
      ]);
    });
  });
});
