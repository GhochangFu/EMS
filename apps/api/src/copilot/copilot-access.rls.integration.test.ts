import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import {
  aRoleWithNoSwitchIsRefused,
  aTenantCannotWriteAnotherOrganizationsRow,
  aTenantWritesItsOwnRows,
  type CopilotAccessCtx,
  deletingTheOrganizationCascades,
  noOtherSessionSeesAnOrganizationsRows,
  theAccessServiceWritesAndReadsBack,
  theAvailabilityServiceReadsTheRealSwitches,
} from "./copilot-access.rls.integration.spec";

const connectionString = requireIntegrationDb({
  item: "F3.85",
  label: "the copilot availability tables' row-level security, CHECK and cascades",
  because:
    "the switches decide who may use an LLM on an organization's data; only a real database can " +
    "show that FORCE + the tenant policy keep one organization from reading or writing another's " +
    "switches, and that the services' conflict targets update rather than duplicate.",
  connection: "owner",
});

const superuserConnectionString = requireIntegrationDb({
  item: "F3.85",
  label: "the copilot fixture user under FORCE",
  because:
    "The exception names a bms.users row, which only the superuser can insert and delete under FORCE. " +
    "Setup and teardown alone use it; every assertion runs on bms_tenant, bms_fleet or bms_owner.",
  connection: "superuser",
});

const FAMILY = `F385-COPILOT-${Date.now()}`;
const FAMILY_PATTERN = "F385-COPILOT-%";

async function sweepStaleRuns(pool: pg.Pool): Promise<void> {
  try {
    await pool.query(
      `DELETE FROM bms.users WHERE organization_id IN (SELECT id FROM bms.organizations WHERE code LIKE $1 AND created_at < now() - interval '30 minutes')`,
      [FAMILY_PATTERN],
    );
    await pool.query(
      `DELETE FROM bms.organizations WHERE code LIKE $1 AND created_at < now() - interval '30 minutes'`,
      [FAMILY_PATTERN],
    );
  } catch (err) {
    process.stderr.write(
      `[F3.85] could not sweep stale fixture rows: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  }
}

describe.skipIf(!connectionString)("F3.85 — the copilot availability tables (migration 0104)", () => {
  let ownerPool: pg.Pool;
  let fleetPool: pg.Pool;
  let tenantPool: pg.Pool;
  let superPool: pg.Pool;
  let ctx: CopilotAccessCtx;
  const createdIds: string[] = [];

  async function createOrganization(suffix: string): Promise<string> {
    const { rows } = await fleetPool.query<{ id: string }>(
      "INSERT INTO bms.organizations (code, name, currency) VALUES ($1, $2, 'INR') RETURNING id",
      [`${FAMILY}-${suffix}`, `F3.85 copilot ${suffix}`],
    );
    const id = rows[0]?.id;
    if (!id) throw new Error(`F3.85: fixture organization ${suffix} was not created`);
    createdIds.push(id);
    return id;
  }

  beforeAll(async () => {
    const url = connectionString as string;
    ownerPool = await openIntegrationPool(url, "F3.85");
    fleetPool = await openIntegrationPool(
      process.env.DATABASE_URL_FLEET ?? asRole(url, "bms_fleet", "bms_fleet_dev"),
      "F3.85",
    );
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F3.85",
    );
    superPool = await openIntegrationPool(superuserConnectionString as string, "F3.85");
    await sweepStaleRuns(superPool);
    const orgA = await createOrganization("A");
    const orgB = await createOrganization("B");
    const { rows } = await superPool.query<{ id: string }>(
      "INSERT INTO bms.users (organization_id, email, display_name, role) VALUES ($1, $2, 'F3.85 A', 'location_admin') RETURNING id",
      [orgA, `${FAMILY.toLowerCase()}-a@example.test`],
    );
    const userA = rows[0]?.id;
    if (!userA) throw new Error("F3.85: fixture user was not created");
    const actor = await superPool.query<{ id: string }>(
      "INSERT INTO bms.users (organization_id, email, display_name, role) VALUES (NULL, $1, 'F3.85 admin', 'admin') RETURNING id",
      [`${FAMILY.toLowerCase()}-admin@example.test`],
    );
    const actorId = actor.rows[0]?.id;
    if (!actorId) throw new Error("F3.85: fixture admin was not created");
    ctx = { tenantDb: createDb(tenantPool), fleetPool, ownerPool, superPool, orgA, orgB, userA, actorId };
  });

  afterAll(async () => {
    if (createdIds.length > 0) {
      await superPool.query("DELETE FROM bms.users WHERE organization_id = ANY($1)", [createdIds]);
      await superPool.query("DELETE FROM bms.organizations WHERE id = ANY($1)", [createdIds]);
    }
    if (ctx?.actorId) {
      await superPool.query("DELETE FROM bms.users WHERE id = $1", [ctx.actorId]);
    }
    await Promise.all([ownerPool?.end(), fleetPool?.end(), tenantPool?.end(), superPool?.end()]);
  });

  it("aTenantWritesItsOwnRows", async () => {
    await aTenantWritesItsOwnRows(ctx);
  });
  it("noOtherSessionSeesAnOrganizationsRows", async () => {
    await noOtherSessionSeesAnOrganizationsRows(ctx);
  });
  it("aTenantCannotWriteAnotherOrganizationsRow", async () => {
    await aTenantCannotWriteAnotherOrganizationsRow(ctx);
  });
  it("aRoleWithNoSwitchIsRefused", async () => {
    await aRoleWithNoSwitchIsRefused(ctx);
  });
  it("theAvailabilityServiceReadsTheRealSwitches", async () => {
    await theAvailabilityServiceReadsTheRealSwitches(ctx);
  });
  it("theAccessServiceWritesAndReadsBack", async () => {
    await theAccessServiceWritesAndReadsBack(ctx);
  });
  it("deletingTheOrganizationCascades", async () => {
    await deletingTheOrganizationCascades(ctx);
  });
});
