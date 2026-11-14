import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  openIntegrationPool,
  requireIntegrationDb,
  resolveIntegrationRoleUrl,
} from "../apps/api/src/testing/integration-db-gate.js";

/**
 * `F4.365` / ADR 0134 — what migrations `0154` and `0155` guarantee against a
 * real database. The lifecycle is `tests/e4.1a-calc-parameters-schema.integration.test.ts`'s:
 * superuser pool, one held client, every case a rolled-back transaction, a
 * per-probe SAVEPOINT, every code suffixed with a per-run id.
 *
 * `bms_fleet` holds BYPASSRLS, so the isolation cases run as `bms_tenant`.
 */
const connectionString = process.env.DATABASE_URL;

requireIntegrationDb({
  item: "F4.365",
  label: "tariff schema tests",
  because:
    "the month-start checks, the gist exclusion, the composite slab FK, the catalog REVOKE and " +
    "the tenant_isolation policies' location and asset legs are all things Postgres enforces.",
  connection: "superuser",
});

const RUN = randomUUID().slice(0, 8);
const has = connectionString !== undefined && connectionString !== "";

type IntegrationPool = Awaited<ReturnType<typeof openIntegrationPool>>;
type Row = Record<string, unknown>;
type Run = (sql: string, params?: unknown[]) => Promise<{ rows: Row[] }>;
type IntegrationClient = {
  query: <R extends Row = Row>(sql: string, params?: unknown[]) => Promise<{ rows: R[] }>;
  release: () => void;
};
type PgError = { code?: string; constraint?: string };

const CATEGORY_COLS =
  "key, area_id, state, discoms, ownership, code, name, segment, supply, energy_unit, fixed_basis, data_status, effective_from";
const CATEGORY_VALS = (key: string, from = "2026-04-01") => [
  key, "MH", "Maharashtra", "MSEDCL", "Government", "LT-I", "Residential", "Domestic", "LT", "kwh", "per_connection_month", "official", from,
];
const CATEGORY_PLACEHOLDERS = "$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13";

describe.skipIf(!has)("F4.365 — tariff tables against a live database", () => {
  let pool: IntegrationPool;
  let client: IntegrationClient;
  let orgA = "";
  let orgB = "";

  beforeAll(async () => {
    pool = await openIntegrationPool(resolveIntegrationRoleUrl(connectionString as string, "superuser", process.env), "F4.365");
    client = (await pool.connect()) as unknown as IntegrationClient;
    const orgs = await client.query<{ id: string }>(`SELECT id FROM bms.organizations ORDER BY created_at, code LIMIT 2`);
    if (orgs.rows.length < 2) {
      throw new Error("F4.365: needs two bms.organizations rows — run pnpm db:seed.");
    }
    orgA = orgs.rows[0]?.id as string;
    orgB = orgs.rows[1]?.id as string;
  });

  afterAll(async () => {
    client?.release();
    await pool?.end();
  });

  const run: Run = (sql, params) => client.query(sql, params);

  const tx = async (role: string, org: string, body: () => Promise<void>): Promise<void> => {
    await client.query("BEGIN");
    try {
      await client.query(`SET LOCAL ROLE ${role}`);
      await client.query(`SET LOCAL app.current_organization = '${org}'`);
      await body();
    } finally {
      await client.query("ROLLBACK");
    }
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

  /** An asset of `org` at its first location, created as bms_owner under that org's GUC. */
  const seedAsset = async (org: string, suffix: string): Promise<{ assetId: string; locationId: string }> => {
    await run(`SET LOCAL app.current_organization = '${org}'`);
    const loc = await run(`SELECT id FROM bms.locations WHERE organization_id = $1 ORDER BY created_at, code LIMIT 1`, [org]);
    const locationId = loc.rows[0]?.id as string;
    if (!locationId) throw new Error(`F4.365: org ${org} needs a seeded location`);
    const domain = await run(`SELECT code FROM bms.asset_domains ORDER BY code`);
    const asset = await run(
      `INSERT INTO bms.assets (organization_id, location_id, code, name, site_name, domain)
       VALUES ($1, $2, $3, $4, 'F4.365', $5) RETURNING id`,
      [org, locationId, `F4365-${suffix}-${RUN}`, `F4.365 ${suffix}`, domain.rows[0]?.code],
    );
    return { assetId: asset.rows[0]?.id as string, locationId };
  };

  const MAP =
    `INSERT INTO bms.location_tariffs (organization_id, location_id, tariff_key, billing_meter_asset_id, sanctioned_load, sanctioned_load_unit, effective_from, effective_to)
     VALUES ($1, $2, $3, $4, $5, 'kw', $6, $7) RETURNING id`;

  it("the catalog: bms_tenant reads but cannot write; deleting a category removes its slabs", async () => {
    await tx("bms_owner", orgA, async () => {
      const cat = await run(`INSERT INTO bms.tariff_categories (${CATEGORY_COLS}) VALUES (${CATEGORY_PLACEHOLDERS}) RETURNING id`, CATEGORY_VALS(`F4365 cat ${RUN}`));
      const id = cat.rows[0]?.id as string;
      await run(`INSERT INTO bms.tariff_slabs (category_id, slab_no, from_units, to_units, energy_rate) VALUES ($1, 1, 0, 100, 3.96), ($1, 2, 101, NULL, 10.8)`, [id]);
      await refuses(`INSERT INTO bms.tariff_categories (${CATEGORY_COLS}) VALUES (${CATEGORY_PLACEHOLDERS})`, CATEGORY_VALS(`F4365 day15 ${RUN}`, "2026-04-15"), "23514", "tariff_categories_effective_from_month_start_check");
      await refuses(`INSERT INTO bms.tariff_categories (${CATEGORY_COLS}) VALUES (${CATEGORY_PLACEHOLDERS})`, CATEGORY_VALS(`custom:F4365 ${RUN}`), "23514", "tariff_categories_key_not_custom_check");

      await run("SET LOCAL ROLE bms_tenant");
      const seen = await run(`SELECT count(*)::int AS n FROM bms.tariff_slabs WHERE category_id = $1`, [id]);
      expect(seen.rows[0]?.n, "bms_tenant reads the catalog").toBe(2);
      await refuses(`INSERT INTO bms.tariff_categories (${CATEGORY_COLS}) VALUES (${CATEGORY_PLACEHOLDERS})`, CATEGORY_VALS(`F4365 tenant ${RUN}`), "42501");
      await refuses(`DELETE FROM bms.tariff_slabs WHERE category_id = $1`, [id], "42501");

      await run("SET LOCAL ROLE bms_owner");
      await run(`DELETE FROM bms.tariff_categories WHERE id = $1`, [id]);
      const left = await run(`SELECT count(*)::int AS n FROM bms.tariff_slabs WHERE category_id = $1`, [id]);
      expect(left.rows[0]?.n, "slabs cascade with their category").toBe(0);
    });
  });

  it("location_tariffs: own rows pass; another org's location or meter is refused; windows may not overlap", async () => {
    await tx("bms_owner", orgA, async () => {
      const a = await seedAsset(orgA, "A");
      const b = await seedAsset(orgB, "B");
      await run(MAP, [orgB, b.locationId, "k", b.assetId, 10, "2026-01-01", null]);
      await run(`SET LOCAL app.current_organization = '${orgA}'`);

      await run("SET LOCAL ROLE bms_tenant");
      const who = await run(`SELECT current_user`);
      expect(who.rows[0]?.current_user).toBe("bms_tenant");
      const seenB = await run(`SELECT count(*)::int AS n FROM bms.location_tariffs WHERE organization_id = $1`, [orgB]);
      expect(seenB.rows[0]?.n, "org A sees none of org B's mappings").toBe(0);

      expect((await run(MAP, [orgA, a.locationId, "k", a.assetId, 10, "2026-01-01", "2026-03-01"])).rows.length).toBe(1);
      // Org B's meter at org A's location: only the asset leg refuses it.
      await refuses(MAP, [orgA, a.locationId, "k", b.assetId, 10, "2026-05-01", null], "42501");
      // Org B's location: only the location leg refuses it.
      await refuses(MAP, [orgA, b.locationId, "k", a.assetId, 10, "2026-05-01", null], "42501");
      await refuses(MAP, [orgA, a.locationId, "k", a.assetId, 10, "2026-02-01", null], "23P01", "location_tariffs_no_overlap");
      await refuses(MAP, [orgA, a.locationId, "k", a.assetId, 10, "2026-05-15", null], "23514", "location_tariffs_month_start_check");
      // Adjacent windows are fine: [Jan, Mar) then [Mar, ∞).
      expect((await run(MAP, [orgA, a.locationId, "k", a.assetId, 10, "2026-03-01", null])).rows.length).toBe(1);
    });
  });

  it("org versions: isolated per org; a slab cannot hang under another org's category", async () => {
    await tx("bms_owner", orgB, async () => {
      const catB = await run(`INSERT INTO bms.org_tariff_categories (${CATEGORY_COLS}, organization_id, reason) VALUES (${CATEGORY_PLACEHOLDERS}, $14, $15) RETURNING id`, [...CATEGORY_VALS(`F4365 org ${RUN}`), orgB, "revision B"]);
      const idB = catB.rows[0]?.id as string;
      await run(`SET LOCAL app.current_organization = '${orgA}'`);
      const catA = await run(`INSERT INTO bms.org_tariff_categories (${CATEGORY_COLS}, organization_id, reason) VALUES (${CATEGORY_PLACEHOLDERS}, $14, $15) RETURNING id`, [...CATEGORY_VALS(`F4365 org ${RUN}`), orgA, "revision A"]);
      const idA = catA.rows[0]?.id as string;
      await run(`INSERT INTO bms.org_tariff_slabs (category_id, organization_id, slab_no, from_units, to_units, energy_rate) VALUES ($1, $2, 1, 0, NULL, 5)`, [idA, orgA]);
      // A slab claiming org A under org B's category: the composite FK refuses it.
      await refuses(`INSERT INTO bms.org_tariff_slabs (category_id, organization_id, slab_no, from_units, to_units, energy_rate) VALUES ($1, $2, 1, 0, NULL, 5)`, [idB, orgA], "23503", "org_tariff_slabs_category_fk");
      await refuses(`INSERT INTO bms.org_tariff_categories (${CATEGORY_COLS}, organization_id, reason) VALUES (${CATEGORY_PLACEHOLDERS}, $14, $15)`, [...CATEGORY_VALS(`F4365 r ${RUN}`), orgA, "x"], "23514", "org_tariff_categories_reason_check");

      await run("SET LOCAL ROLE bms_tenant");
      const seen = await run(`SELECT organization_id FROM bms.org_tariff_categories WHERE key = $1`, [`F4365 org ${RUN}`]);
      expect(seen.rows.map((r) => r.organization_id)).toEqual([orgA]);
      await refuses(`INSERT INTO bms.org_tariff_categories (${CATEGORY_COLS}, organization_id, reason) VALUES (${CATEGORY_PLACEHOLDERS}, $14, $15)`, [...CATEGORY_VALS(`F4365 x ${RUN}`), orgB, "for B"], "42501");
    });
  });
});
