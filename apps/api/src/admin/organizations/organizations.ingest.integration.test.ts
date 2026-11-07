import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { AccessControlService } from "../../auth/access-control.service";
import { MasterDataAuditService } from "../master-data-audit.service";
import { RtusAdminService } from "../rtus/rtus.service";
import { openIntegrationPool, requireIntegrationDb } from "../../testing/integration-db-gate";
import { asRole } from "../../testing/role-urls";
import { jwtFor, primeSeededSubjects, SEEDED } from "../../testing/seeded-subjects";
import { OrganizationsAdminService } from "./organizations.service";
import {
  aNewOrganizationIngests,
  everyoneButTheGlobalAdminIs403,
  theGlobalAdminSwitchesItBackOn,
  theGlobalAdminSwitchesItOff,
  theListAndTheSummaryCarryTheSwitch,
  theRtuDtoFollowsTheOrganization,
  theSameValueAgainWritesNothing,
  type IngestSwitchCtx,
} from "./organizations.ingest.integration.spec";

/**
 * `F4.330` — Vitest entry point. Assertions live in the sibling `.spec` (ADR 0014); this file owns
 * the pools, the fixture organization (with one location and one RTU) and its cleanup, on the
 * `organizations.colour-profile` harness: every row is deleted in `afterAll`, and a stale sweep
 * reaps a run that died before it. Fixture rows are written as `bms_fleet` (BYPASSRLS).
 */
const connectionString = requireIntegrationDb({
  item: "F4.330",
  label: "bms.organizations.ingest_enabled on the ingest route and the RTU DTO",
  because:
    "the column default is Postgres's, the gate reads the caller's real role, the audit row is a real " +
    "bms.audit_log insert, and the RTU DTO reads the organizations join.",
});

const FAMILY = `F4330-IG-${Date.now()}`;
const FAMILY_PATTERN = "F4330-IG-%";

/** Deletes one fixture family's rows, children first. `orgFilter` selects the organizations. */
async function deleteFamily(pool: pg.Pool, orgFilter: string, params: unknown[]): Promise<void> {
  const orgs = `SELECT id FROM bms.organizations WHERE ${orgFilter}`;
  const rtusOf = `SELECT id FROM bms.rtus WHERE organization_id IN (${orgs})`;
  await pool.query(
    `DELETE FROM bms.audit_log
      WHERE organization_id IN (${orgs})
         OR (entity_type = 'organization' AND entity_id IN (${orgs}))
         OR (entity_type = 'rtu' AND entity_id IN (${rtusOf}))`,
    params,
  );
  await pool.query(`DELETE FROM bms.rtus WHERE organization_id IN (${orgs})`, params);
  await pool.query(`DELETE FROM bms.locations WHERE organization_id IN (${orgs})`, params);
  await pool.query(`DELETE FROM bms.organizations WHERE ${orgFilter}`, params);
}

async function sweepStaleRuns(pool: pg.Pool): Promise<void> {
  try {
    await deleteFamily(pool, "code LIKE $1 AND created_at < now() - interval '30 minutes'", [FAMILY_PATTERN]);
  } catch (err) {
    process.stderr.write(`[F4.330] could not sweep stale fixture rows: ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

describe.skipIf(!connectionString)("F4.330 — organization ingest switch (ADR 0115)", () => {
  let fleetPool: pg.Pool;
  let authPool: pg.Pool;
  let tenantPool: pg.Pool;
  let ctx: IngestSwitchCtx;

  beforeAll(async () => {
    const url = connectionString as string;
    fleetPool = await openIntegrationPool(process.env.DATABASE_URL_FLEET ?? asRole(url, "bms_fleet", "bms_fleet_dev"), "F4.330");
    await primeSeededSubjects(fleetPool);
    authPool = await openIntegrationPool(process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"), "F4.330");
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F4.330",
    );
    await sweepStaleRuns(fleetPool);

    const fleetDb = createDb(fleetPool);
    const tenantDb = createDb(tenantPool);
    const access = new AccessControlService(createDb(authPool), fleetDb);
    const audit = new MasterDataAuditService(tenantDb, fleetDb);
    const svc = new OrganizationsAdminService(fleetDb, tenantDb, access, audit);
    const rtuSvc = new RtusAdminService(fleetDb, tenantDb, access, audit);
    const globalAdmin = jwtFor(SEEDED.globalAdmin, "admin");
    const fixture = await svc.create(globalAdmin, { code: `${FAMILY}-A`, name: "F4.330 ingest fixture", currency: "INR" });

    const slug = `${FAMILY}-loc`.toLowerCase();
    const loc = await fleetPool.query<{ id: string }>(
      `INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude)
       VALUES ($1, $2, $3, 'F4.330 ingest fixture site', (SELECT code FROM bms.location_types ORDER BY code LIMIT 1), 0, 0)
       RETURNING id`,
      [fixture.id, `${FAMILY}-LOC`, slug],
    );
    const locationId = loc.rows[0]?.id;
    if (!locationId) throw new Error("F4.330: the fixture location was not created");

    const rtu = await fleetPool.query<{ id: string }>(
      `INSERT INTO bms.rtus (organization_id, location_id, code, display_name, source_type, ingest_enabled, active)
       VALUES ($1, $2, $3, 'F4.330 ingest fixture RTU', 'mqtt', true, true)
       RETURNING id`,
      [fixture.id, locationId, `${FAMILY}-RTU`],
    );
    const rtuId = rtu.rows[0]?.id;
    if (!rtuId) throw new Error("F4.330: the fixture RTU was not created");

    ctx = {
      svc,
      rtuSvc,
      fleetPool,
      globalAdmin,
      organizationAdmin: jwtFor(SEEDED.organizationAdmin, "organization_admin"),
      locationAdmin: jwtFor(SEEDED.locationAdmin, "location_admin"),
      fixtureId: fixture.id,
      locationId,
      rtuId,
    };
  });

  afterAll(async () => {
    if (ctx) await deleteFamily(fleetPool, "id = $1", [ctx.fixtureId]);
    await Promise.all([fleetPool?.end(), authPool?.end(), tenantPool?.end()]);
  });

  it("I0 a new organization reads ingest_enabled = true", async () => {
    await aNewOrganizationIngests(ctx);
  });

  it("I1 the global admin switches it off, with one platform audit row", async () => {
    await theGlobalAdminSwitchesItOff(ctx);
  });

  it("I2 the same value again writes nothing", async () => {
    await theSameValueAgainWritesNothing(ctx);
  });

  it("I3 switching back on writes one enable row", async () => {
    await theGlobalAdminSwitchesItBackOn(ctx);
  });

  it("I4 an organization admin and a location admin are each a 403, with no audit row", async () => {
    await everyoneButTheGlobalAdminIs403(ctx);
  });

  it("I5 list and getById carry ingestEnabled", async () => {
    await theListAndTheSummaryCarryTheSwitch(ctx);
  });

  it("I6 the RTU DTO follows the organization; the RTU's own box is unchanged", async () => {
    await theRtuDtoFollowsTheOrganization(ctx);
  });
});
