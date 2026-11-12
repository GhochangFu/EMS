import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { CredentialCryptoService } from "../../security/credential-crypto.service";
import { openIntegrationPool, requireIntegrationDb } from "../../testing/integration-db-gate";
import { asRole } from "../../testing/role-urls";
import { jwtFor, primeSeededSubjects } from "../../testing/seeded-subjects";
import { MasterDataAuditService } from "../master-data-audit.service";
import { RtusCredentialsService } from "./rtus-credentials.service";
import {
  assertCrossTenantSiblingIsRefused,
  assertReplaceWritesUnderRls,
  assertSharedBrokerIsRefused,
  type CredentialsCtx,
} from "./rtus-credentials.integration.spec";
import { RtusAdminService } from "./rtus.service";

/**
 * `F4.333` (ADR 0129 decision 2, plan T3.3) — Vitest entry point. Assertions
 * live in the sibling `.spec` (ADR 0014); this file owns the database
 * lifecycle, in the shape of `rtus.topic-release.integration.test.ts`.
 */
const connectionString = requireIntegrationDb({
  item: "F4.333",
  label: "replacing a committed RTU's credential under FORCE RLS",
  because:
    "the write runs under the tenant GUC on a FORCE RLS table, and the cross-tenant sibling and " +
    "shared-broker refusals read other organizations' rows; only a real database shows the blob " +
    "stored, another tenant's row untouched and the audit rows.",
});

const ORGANIZATION_ADMIN_EMAIL = "phe-admin@bms.local";
/** 32 bytes, base64 — the suite's own key, restored in `afterAll`. */
const TEST_KEY = Buffer.alloc(32, 9).toString("base64");

describe.skipIf(!connectionString)("F4.333 — PUT /admin/rtus/:id/credentials under FORCE RLS", () => {
  let fixturePool: pg.Pool;
  let authPool: pg.Pool;
  let tenantPool: pg.Pool;
  let ctx: CredentialsCtx;
  let jwt: JwtPayload;
  const createdRtuIds: string[] = [];
  const previousKey = process.env.CREDENTIAL_ENCRYPTION_KEY;

  beforeAll(async () => {
    process.env.CREDENTIAL_ENCRYPTION_KEY = TEST_KEY;
    const url = connectionString as string;
    fixturePool = await openIntegrationPool(url, "F4.333");
    await primeSeededSubjects(fixturePool);
    jwt = jwtFor(ORGANIZATION_ADMIN_EMAIL, "organization_admin");
    authPool = await openIntegrationPool(process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"), "F4.333");
    tenantPool = await openIntegrationPool(process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"), "F4.333");

    const org = await fixturePool.query<{ id: string }>(
      `SELECT uoa.organization_id AS id
         FROM bms.user_organization_access uoa
         JOIN bms.users u ON u.id = uoa.user_id
        WHERE u.email = $1
        LIMIT 1`,
      [ORGANIZATION_ADMIN_EMAIL],
    );
    if (!org.rows[0]) {
      throw new Error(`F4.333: ${ORGANIZATION_ADMIN_EMAIL} has no organization grant — run pnpm db:seed.`);
    }
    const loc = await fixturePool.query<{ id: string }>(
      `SELECT id FROM bms.locations WHERE organization_id = $1 AND active = true ORDER BY created_at, code LIMIT 1`,
      [org.rows[0].id],
    );
    const other = await fixturePool.query<{ id: string; organization_id: string }>(
      `SELECT id, organization_id FROM bms.locations WHERE organization_id <> $1 ORDER BY created_at, code LIMIT 1`,
      [org.rows[0].id],
    );
    if (!loc.rows[0] || !other.rows[0]) {
      throw new Error("F4.333: the seed needs a location in the admin's organization and one in another — run pnpm db:seed.");
    }

    const tenantDb = createDb(tenantPool);
    const fleetDb = createDb(fixturePool);
    const accessControl = new AccessControlService(createDb(authPool), fleetDb);
    const audit = new MasterDataAuditService(tenantDb, fleetDb);
    ctx = {
      svc: new RtusCredentialsService(
        fleetDb,
        tenantDb,
        accessControl,
        audit,
        new CredentialCryptoService(),
        new RtusAdminService(fleetDb, tenantDb, accessControl, audit),
      ),
      fixturePool,
      organizationId: org.rows[0].id,
      locationId: loc.rows[0].id,
      otherOrganizationId: other.rows[0].organization_id,
      otherLocationId: other.rows[0].id,
      createdRtuIds,
    };
  }, 60_000);

  afterAll(async () => {
    if (previousKey === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY;
    else process.env.CREDENTIAL_ENCRYPTION_KEY = previousKey;
    if (fixturePool && createdRtuIds.length > 0) {
      await fixturePool.query("DELETE FROM bms.audit_log WHERE entity_id = ANY($1)", [createdRtuIds]);
      await fixturePool.query("DELETE FROM bms.rtu_connection_configs WHERE rtu_id = ANY($1)", [createdRtuIds]);
      await fixturePool.query("DELETE FROM bms.rtus WHERE id = ANY($1)", [createdRtuIds]);
    }
    await Promise.all([fixturePool?.end(), authPool?.end(), tenantPool?.end()]);
  }, 60_000);

  it("I1 writes one blob to the target and its sibling under the tenant GUC, audited without values", async () => {
    await assertReplaceWritesUnderRls(ctx, jwt);
  }, 30_000);

  it("I2 refuses an organization admin on a broker another organization uses, touching neither row", async () => {
    await assertSharedBrokerIsRefused(ctx, jwt);
  }, 30_000);

  it("I3 refuses another organization's RTU as a sibling and leaves it untouched", async () => {
    await assertCrossTenantSiblingIsRefused(ctx, jwt);
  }, 30_000);
});
