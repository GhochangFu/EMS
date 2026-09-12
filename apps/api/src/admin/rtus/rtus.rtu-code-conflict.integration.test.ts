import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { openIntegrationPool, requireIntegrationDb } from "../../testing/integration-db-gate";
import { asRole } from "../../testing/role-urls";
import { MasterDataAuditService } from "../master-data-audit.service";
import { RtusAdminService } from "./rtus.service";
import {
  assertClearingRtuCodeOnTwoRtusDoesNotCollide,
  assertCreateRefusesATakenRtuCode,
  assertUpdateDoesNotSelfCollideOnAnUnchangedRtuCode,
  assertUpdateRefusesATakenRtuCode,
  type RtuCodeConflictCtx,
} from "./rtus.rtu-code-conflict.integration.spec";

/**
 * `F4.60` — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the database lifecycle. Same shape as
 * `rtus.telemetry-source.integration.test.ts`, which covers the other half of
 * this service's write path.
 */
const connectionString = requireIntegrationDb({
  item: "F4.60",
  label: "RtusAdminService answering a duplicate rtu_code with 409",
  because:
    "the claim is that the database raises 23505 naming rtus_rtu_code_idx, that " +
    "Drizzle's rollback re-throws the driver's own object with that field " +
    "intact, and that an update restating an unchanged rtu_code does not " +
    "collide with itself. None of the three can be seen from a fake tx, and all " +
    "three fail silently: a 500 on a value the operator chose, or every edit of " +
    "an ingest-bound RTU refused.",
});

const ORGANIZATION_ADMIN_EMAIL = "phe-admin@bms.local";
const SYNTHETIC_SUB = "00000000-0000-4000-8000-000000000004";

function jwtFor(email: string, role: JwtPayload["role"]): JwtPayload {
  return { sub: SYNTHETIC_SUB, email, name: `integration:${email}`, role };
}

describe.skipIf(!connectionString)("F4.60 — a duplicate rtu_code is 409", () => {
  let fixturePool: pg.Pool;
  let authPool: pg.Pool;
  let tenantPool: pg.Pool;
  let ctx: RtuCodeConflictCtx;

  const jwt = jwtFor(ORGANIZATION_ADMIN_EMAIL, "organization_admin");
  const createdRtuIds: string[] = [];

  beforeAll(async () => {
    const url = connectionString as string;
    // `requireIntegrationDb` defaults to `bms_fleet`, which is `BYPASSRLS`
    // (migration 0039). The read-back and the fleet-wide row counts need to see
    // across the tenant policy — under `FORCE ROW LEVEL SECURITY` a count as
    // `bms_owner` returns 0 with the rows present.
    fixturePool = await openIntegrationPool(url, "F4.60");
    authPool = await openIntegrationPool(
      process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"),
      "F4.60",
    );
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F4.60",
    );

    const org = await fixturePool.query<{ id: string }>(
      `SELECT uoa.organization_id AS id
         FROM bms.user_organization_access uoa
         JOIN bms.users u ON u.id = uoa.user_id
        WHERE u.email = $1
        LIMIT 1`,
      [ORGANIZATION_ADMIN_EMAIL],
    );
    if (!org.rows[0]) {
      throw new Error(
        `F4.60: ${ORGANIZATION_ADMIN_EMAIL} has no organization grant — run pnpm db:seed.`,
      );
    }

    const loc = await fixturePool.query<{ id: string }>(
      `SELECT id FROM bms.locations
         WHERE organization_id = $1 AND active = true ORDER BY created_at, code LIMIT 1`,
      [org.rows[0].id],
    );
    if (!loc.rows[0]) {
      throw new Error(
        `F4.60: ${ORGANIZATION_ADMIN_EMAIL}'s organization has no active location — run pnpm db:seed.`,
      );
    }

    const tenantDb = createDb(tenantPool);
    const fleetDb = createDb(fixturePool);
    const accessControl = new AccessControlService(createDb(authPool), fleetDb);
    ctx = {
      svc: new RtusAdminService(
        fleetDb,
        tenantDb,
        accessControl,
        new MasterDataAuditService(tenantDb, fleetDb),
      ),
      fixturePool,
      organizationId: org.rows[0].id,
      locationId: loc.rows[0].id,
      createdRtuIds,
    };
  }, 60_000);

  afterAll(async () => {
    // This database is shared with other suites and other worktrees — every
    // fixture row carries an `f4.60-` code so a leak names its author. The audit
    // rows these cases wrote go too: they are this suite's own exhaust, not
    // history anyone wants.
    if (createdRtuIds.length > 0) {
      await fixturePool.query("DELETE FROM bms.audit_log WHERE entity_id = ANY($1)", [
        createdRtuIds,
      ]);
      await fixturePool.query("DELETE FROM bms.rtus WHERE id = ANY($1)", [createdRtuIds]);
    }
    await Promise.all([fixturePool?.end(), authPool?.end(), tenantPool?.end()]);
  }, 60_000);

  // One claim per `it`: `expect` throws, so two claims in one block would hide
  // the second whenever the first fails.
  it("refuses a create whose rtuCode is already held", async () => {
    await assertCreateRefusesATakenRtuCode(ctx, jwt);
  }, 30_000);

  it("refuses an update whose rtuCode is already held, and writes no part of it", async () => {
    await assertUpdateRefusesATakenRtuCode(ctx, jwt);
  }, 30_000);

  it("lets an update restate an unchanged rtuCode without self-colliding", async () => {
    await assertUpdateDoesNotSelfCollideOnAnUnchangedRtuCode(ctx, jwt);
  }, 30_000);

  it("lets two RTUs clear their rtuCode to the empty string", async () => {
    await assertClearingRtuCodeOnTwoRtusDoesNotCollide(ctx, jwt);
  }, 30_000);
});
