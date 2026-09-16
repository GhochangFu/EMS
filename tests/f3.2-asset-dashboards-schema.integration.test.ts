import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  openIntegrationPool,
  requireIntegrationDb,
  resolveIntegrationRoleUrl,
} from "../apps/api/src/testing/integration-db-gate.js";

/**
 * `F3.2` / ADR 0067 decision 1 — what migration `0073` guarantees against a
 * real database. `tests/f3.2-asset-dashboards-schema.test.ts` asserts the
 * migration's *text*; this asserts what Postgres actually enforces, following
 * `tests/f3.1a-dashboard-schema.integration.test.ts`'s lifecycle: superuser
 * pool, one held client, one rolled-back transaction, a per-case
 * `SAVEPOINT`-protected `refuses`, every code and id suffixed with a per-run
 * `randomUUID()`.
 */
const connectionString = process.env.DATABASE_URL;

requireIntegrationDb({
  item: "F3.2",
  label: "asset default dashboard schema tests",
  because:
    "the three-way scope check, the template/asset stamp checks, the cascade and the " +
    "re-created tenant_isolation policy's two new legs are all things Postgres enforces, " +
    "so a green run without a database asserts nothing about any of them.",
});

const RUN = randomUUID().slice(0, 8);
const has = connectionString !== undefined && connectionString !== "";

type IntegrationPool = Awaited<ReturnType<typeof openIntegrationPool>>;
type IntegrationClient = {
  query: <R extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ) => Promise<{ rows: R[] }>;
  release: () => void;
};

describe.skipIf(!has)("F3.2 — asset default dashboards against a live database", () => {
  let pool: IntegrationPool;
  let client: IntegrationClient;
  let orgA = "";
  let orgB = "";

  beforeAll(async () => {
    pool = await openIntegrationPool(
      resolveIntegrationRoleUrl(connectionString as string, "superuser", process.env),
      "F3.2",
    );
    client = (await pool.connect()) as unknown as IntegrationClient;
    const orgs = await client.query<{ id: string }>(
      `SELECT id FROM bms.organizations ORDER BY code`,
    );
    if (orgs.rows.length < 2) {
      throw new Error(
        "F3.2: needs two bms.organizations rows to prove tenant isolation — run pnpm db:seed.",
      );
    }
    orgA = orgs.rows[0]?.id as string;
    orgB = orgs.rows[1]?.id as string;
  });

  afterAll(async () => {
    client?.release();
    await pool?.end();
  });

  /** Runs `body` inside a rolled-back transaction, as `bms_owner` with org A's tenant GUC. */
  const inTx = async (
    body: (
      run: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>,
    ) => Promise<void>,
  ): Promise<void> => {
    await client.query("BEGIN");
    try {
      await client.query("SET LOCAL ROLE bms_owner");
      await client.query(`SET LOCAL app.current_organization = '${orgA}'`);
      await body((sql, params) => client.query(sql, params));
    } finally {
      await client.query("ROLLBACK");
    }
  };

  /** Creates one asset (and, when asked, a location-independent asset template row) under `org`. */
  const seedAsset = async (
    run: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>,
    org: string,
    codeSuffix: string,
  ): Promise<string> => {
    const loc = await run(`SELECT id FROM bms.locations WHERE organization_id = $1 ORDER BY code`, [
      org,
    ]);
    const locationId = loc.rows[0]?.id as string;
    if (!locationId) {
      throw new Error(`F3.2: org ${org} needs a seeded location — run pnpm db:seed.`);
    }
    const domain = await run(`SELECT code FROM bms.asset_domains ORDER BY code`);
    const asset = await run(
      `INSERT INTO bms.assets (organization_id, location_id, code, name, site_name, domain)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [org, locationId, `F32-${codeSuffix}`, `F3.2 ${codeSuffix}`, "F3.2", domain.rows[0]?.code],
    );
    return asset.rows[0]?.id as string;
  };

  const seedAssetTemplate = async (
    run: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>,
    org: string,
    codeSuffix: string,
  ): Promise<string> => {
    const domain = await run(`SELECT code FROM bms.asset_domains ORDER BY code`);
    const template = await run(
      `INSERT INTO bms.asset_templates (organization_id, code, name, asset_type, domain)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [org, `F32TPL-${codeSuffix}`, `F3.2 Template ${codeSuffix}`, "generic", domain.rows[0]?.code],
    );
    return template.rows[0]?.id as string;
  };

  const seedDashboardTemplate = async (
    run: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>,
    org: string,
    codeSuffix: string,
  ): Promise<string> => {
    const section = await run(`SELECT code FROM bms.dashboard_sections ORDER BY code`);
    const dt = await run(
      `INSERT INTO bms.dashboard_templates (organization_id, code, name, section)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [org, `F32DT-${codeSuffix}`, `F3.2 DT ${codeSuffix}`, section.rows[0]?.code],
    );
    return dt.rows[0]?.id as string;
  };

  const refuses = async (
    run: (sql: string, params?: unknown[]) => Promise<unknown>,
    sql: string,
    params: unknown[],
    constraint: string,
  ): Promise<void> => {
    await run("SAVEPOINT probe");
    let message = "";
    try {
      await run(sql, params);
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    await run("ROLLBACK TO SAVEPOINT probe");
    expect(message, `expected a refusal naming ${constraint}`).toContain(constraint);
  };

  /** As `refuses`, but asserts the Postgres RLS-violation error code rather than a
   * constraint name — I4 is refused by the policy, not by a named CHECK. */
  const refusesRls = async (
    run: (sql: string, params?: unknown[]) => Promise<unknown>,
    sql: string,
    params: unknown[],
  ): Promise<void> => {
    await run("SAVEPOINT probe");
    let code: string | undefined;
    try {
      await run(sql, params);
    } catch (err) {
      code = (err as NodeJS.ErrnoException | undefined)?.code;
    }
    await run("ROLLBACK TO SAVEPOINT probe");
    expect(code, "expected a row-level security violation, code 42501").toBe("42501");
  };

  // I1 (owed guard 3)
  it("permits an asset scope alone and refuses it paired with location or asset group", async () => {
    await inTx(async (run) => {
      const assetId = await seedAsset(run, orgA, `I1-${RUN}`);
      const loc = await run(`SELECT id FROM bms.locations WHERE organization_id = $1 ORDER BY code`, [
        orgA,
      ]);
      const group = await run(`SELECT id FROM bms.asset_groups WHERE organization_id = $1 ORDER BY code`, [
        orgA,
      ]);
      const locationId = loc.rows[0]?.id;
      const groupId = group.rows[0]?.id;
      expect(groupId, "F3.2: needs an asset group in the first organization — run pnpm db:seed").toBeDefined();

      // Positive control first — I1 must prove asset_id alone is accepted before it proves
      // the pairwise refusals, or a check that refused everything would look correct here.
      expect(
        (
          await run(
            `INSERT INTO bms.dashboards (organization_id, slug, name, asset_id)
             VALUES ($1, $2, 'asset-alone', $3) RETURNING id`,
            [orgA, `i1-asset-${RUN}`, assetId],
          )
        ).rows.length,
        "asset_id alone must be accepted",
      ).toBe(1);

      await refuses(
        run,
        `INSERT INTO bms.dashboards (organization_id, slug, name, asset_id, location_id)
         VALUES ($1, $2, 'asset+location', $3, $4)`,
        [orgA, `i1-loc-${RUN}`, assetId, locationId],
        "dashboards_scope_check",
      );

      await refuses(
        run,
        `INSERT INTO bms.dashboards (organization_id, slug, name, asset_id, asset_group_id)
         VALUES ($1, $2, 'asset+group', $3, $4)`,
        [orgA, `i1-group-${RUN}`, assetId, groupId],
        "dashboards_scope_check",
      );
    });
  });

  // I2
  it("refuses a dashboard stamped with both template_id and asset_template_id", async () => {
    await inTx(async (run) => {
      const assetId = await seedAsset(run, orgA, `I2-${RUN}`);
      const templateId = await seedDashboardTemplate(run, orgA, `I2-${RUN}`);
      const assetTemplateId = await seedAssetTemplate(run, orgA, `I2-${RUN}`);

      await refuses(
        run,
        `INSERT INTO bms.dashboards (organization_id, slug, name, asset_id, template_id, asset_template_id)
         VALUES ($1, $2, 'both-stamps', $3, $4, $5)`,
        [orgA, `i2-${RUN}`, assetId, templateId, assetTemplateId],
        "dashboards_template_stamp_check",
      );
    });
  });

  // I3
  it("refuses an asset_template_id stamp with no asset_id", async () => {
    await inTx(async (run) => {
      const assetTemplateId = await seedAssetTemplate(run, orgA, `I3-${RUN}`);

      await refuses(
        run,
        `INSERT INTO bms.dashboards (organization_id, slug, name, asset_template_id)
         VALUES ($1, $2, 'stamp-no-asset', $3)`,
        [orgA, `i3-${RUN}`, assetTemplateId],
        "dashboards_asset_stamp_check",
      );
    });
  });

  // I4 (owed guard 4)
  it("as bms_tenant, refuses a dashboard stamped with another organization's asset", async () => {
    await client.query("BEGIN");
    try {
      await client.query("SET LOCAL ROLE bms_owner");
      await client.query(`SET LOCAL app.current_organization = '${orgA}'`);
      const assetA = await seedAsset(
        (sql, params) => client.query(sql, params),
        orgA,
        `I4A-${RUN}`,
      );
      await client.query(`SET LOCAL app.current_organization = '${orgB}'`);
      const assetB = await seedAsset(
        (sql, params) => client.query(sql, params),
        orgB,
        `I4B-${RUN}`,
      );

      await client.query("SET LOCAL ROLE bms_tenant");
      await client.query(`SET LOCAL app.current_organization = '${orgA}'`);
      const run = (sql: string, params?: unknown[]) => client.query(sql, params);

      // Positive control first — the own-organization write must succeed under bms_tenant
      // before the cross-tenant refusal proves anything.
      expect(
        (
          await run(
            `INSERT INTO bms.dashboards (organization_id, slug, name, asset_id)
             VALUES ($1, $2, 'own-org', $3) RETURNING id`,
            [orgA, `i4-own-${RUN}`, assetA],
          )
        ).rows.length,
        "a correctly-stamped write under bms_tenant must succeed",
      ).toBe(1);

      await refusesRls(
        run,
        `INSERT INTO bms.dashboards (organization_id, slug, name, asset_id)
         VALUES ($1, $2, 'cross-org', $3)`,
        [orgA, `i4-cross-${RUN}`, assetB],
      );
    } finally {
      await client.query("ROLLBACK");
    }
  });

  // I6 (owed guard 4, second half)
  it("as bms_tenant, refuses a dashboard stamped with another organization's asset template", async () => {
    await client.query("BEGIN");
    try {
      await client.query("SET LOCAL ROLE bms_owner");
      await client.query(`SET LOCAL app.current_organization = '${orgA}'`);
      const run = (sql: string, params?: unknown[]) => client.query(sql, params);
      const assetA = await seedAsset(run, orgA, `I6A-${RUN}`);
      const templateA = await seedAssetTemplate(run, orgA, `I6A-${RUN}`);
      await client.query(`SET LOCAL app.current_organization = '${orgB}'`);
      const templateB = await seedAssetTemplate(run, orgB, `I6B-${RUN}`);

      await client.query("SET LOCAL ROLE bms_tenant");
      await client.query(`SET LOCAL app.current_organization = '${orgA}'`);

      // Positive control first. `asset_template_id` is checked by the policy and
      // by nothing else — a foreign key runs with row security OFF (the 0056
      // lesson) — so without this the case below would pass on a policy that
      // refused every stamp, including the legitimate one.
      expect(
        (
          await run(
            `INSERT INTO bms.dashboards (organization_id, slug, name, asset_id, asset_template_id)
             VALUES ($1, $2, 'own-stamp', $3, $4) RETURNING id`,
            [orgA, `i6-own-${RUN}`, assetA, templateA],
          )
        ).rows.length,
        "an own-organization asset template stamp must be accepted under bms_tenant",
      ).toBe(1);

      await refusesRls(
        run,
        `INSERT INTO bms.dashboards (organization_id, slug, name, asset_id, asset_template_id)
         VALUES ($1, $2, 'cross-stamp', $3, $4)`,
        [orgA, `i6-cross-${RUN}`, assetA, templateB],
      );
    } finally {
      await client.query("ROLLBACK");
    }
  });

  // I7
  it("refuses to delete an asset template a dashboard still stamps", async () => {
    await inTx(async (run) => {
      const assetId = await seedAsset(run, orgA, `I7-${RUN}`);
      const templateId = await seedAssetTemplate(run, orgA, `I7-${RUN}`);
      await run(
        `INSERT INTO bms.dashboards (organization_id, slug, name, asset_id, asset_template_id)
         VALUES ($1, $2, 'stamped', $3, $4)`,
        [orgA, `i7-${RUN}`, assetId, templateId],
      );

      // The stamp has no `ON DELETE` clause (ADR 0067 decision 1), unlike
      // `asset_id`'s cascade: provenance a delete would orphan must fail loudly.
      await run("SAVEPOINT probe");
      let code: string | undefined;
      let message = "";
      try {
        await run(`DELETE FROM bms.asset_templates WHERE id = $1`, [templateId]);
      } catch (err) {
        code = (err as NodeJS.ErrnoException | undefined)?.code;
        message = err instanceof Error ? err.message : String(err);
      }
      await run("ROLLBACK TO SAVEPOINT probe");
      expect(code, "a stamped asset template must refuse deletion with 23503").toBe("23503");
      expect(message, "the refusal must name the stamp's own foreign key").toContain(
        "dashboards_asset_template_id_fkey",
      );
    });
  });

  // I5
  it("cascades a dashboard's deletion when its asset is deleted", async () => {
    await inTx(async (run) => {
      const assetId = await seedAsset(run, orgA, `I5-${RUN}`);
      const dashboard = await run(
        `INSERT INTO bms.dashboards (organization_id, slug, name, asset_id)
         VALUES ($1, $2, 'cascade', $3) RETURNING id`,
        [orgA, `i5-${RUN}`, assetId],
      );
      const dashboardId = dashboard.rows[0]?.id;

      await run(`DELETE FROM bms.assets WHERE id = $1`, [assetId]);

      const remaining = await run(`SELECT id FROM bms.dashboards WHERE id = $1`, [dashboardId]);
      expect(remaining.rows.length, "the dashboard must cascade away with its asset").toBe(0);
    });
  });
});
