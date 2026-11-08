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
  assertALaterReactivateNeverOverwritesASetTopic,
  assertDeactivateReleasesTheTopic,
  assertDeactivateWithoutATopicReleasesNothing,
  assertReactivateKeepsAHeldTopicReleased,
  assertReactivateRestoresAFreeTopic,
  type TopicReleaseCtx,
} from "./rtus.topic-release.integration.spec";
import { jwtFor, primeSeededSubjects } from "../../testing/seeded-subjects";

/**
 * `F4.339` / ADR 0117 decision 8 — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the database lifecycle, in the shape of
 * `rtus.unique-conflict.integration.test.ts`.
 */
const connectionString = requireIntegrationDb({
  item: "F4.339",
  label: "RtusAdminService releasing an RTU's MQTT topic on deactivate and restoring it when free",
  because:
    "the release and the restore are one UPDATE each against the global rtus_mqtt_topic_idx, and " +
    "the holder may be another tenant's row; only a real database shows the topic freed, the " +
    "cross-tenant holder kept out of the response, and the audit payloads.",
});

const ORGANIZATION_ADMIN_EMAIL = "phe-admin@bms.local";

describe.skipIf(!connectionString)("F4.339 — deactivating an RTU releases its MQTT topic", () => {
  let fixturePool: pg.Pool;
  let authPool: pg.Pool;
  let tenantPool: pg.Pool;
  let ctx: TopicReleaseCtx;
  let jwt: JwtPayload;
  const createdRtuIds: string[] = [];

  beforeAll(async () => {
    const url = connectionString as string;
    fixturePool = await openIntegrationPool(url, "F4.339");
    await primeSeededSubjects(fixturePool);
    jwt = jwtFor(ORGANIZATION_ADMIN_EMAIL, "organization_admin");
    authPool = await openIntegrationPool(process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"), "F4.339");
    tenantPool = await openIntegrationPool(process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"), "F4.339");

    const org = await fixturePool.query<{ id: string }>(
      `SELECT uoa.organization_id AS id
         FROM bms.user_organization_access uoa
         JOIN bms.users u ON u.id = uoa.user_id
        WHERE u.email = $1
        LIMIT 1`,
      [ORGANIZATION_ADMIN_EMAIL],
    );
    if (!org.rows[0]) {
      throw new Error(`F4.339: ${ORGANIZATION_ADMIN_EMAIL} has no organization grant — run pnpm db:seed.`);
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
      throw new Error("F4.339: the seed needs a location in the admin's organization and one in another — run pnpm db:seed.");
    }

    const tenantDb = createDb(tenantPool);
    const fleetDb = createDb(fixturePool);
    ctx = {
      svc: new RtusAdminService(fleetDb, tenantDb, new AccessControlService(createDb(authPool), fleetDb), new MasterDataAuditService(tenantDb, fleetDb)),
      fixturePool,
      locationId: loc.rows[0].id,
      otherLocationId: other.rows[0].id,
      otherOrganizationId: other.rows[0].organization_id,
      createdRtuIds,
    };
  }, 60_000);

  afterAll(async () => {
    if (createdRtuIds.length > 0) {
      await fixturePool.query("DELETE FROM bms.audit_log WHERE entity_id = ANY($1)", [createdRtuIds]);
      await fixturePool.query("DELETE FROM bms.rtus WHERE id = ANY($1)", [createdRtuIds]);
    }
    await Promise.all([fixturePool?.end(), authPool?.end(), tenantPool?.end()]);
  }, 60_000);

  it("TR1 deactivate releases the topic, audits it as a boolean, and frees it", async () => {
    await assertDeactivateReleasesTheTopic(ctx, jwt);
  }, 30_000);

  it("TR2 reactivate restores a free topic", async () => {
    await assertReactivateRestoresAFreeTopic(ctx, jwt);
  }, 30_000);

  it("TR3 reactivate keeps a topic another organization holds released, naming no other row", async () => {
    await assertReactivateKeepsAHeldTopicReleased(ctx, jwt);
  }, 30_000);

  it("TR4 deactivate with no topic releases nothing", async () => {
    await assertDeactivateWithoutATopicReleasesNothing(ctx, jwt);
  }, 30_000);

  it("TR5 a later reactivate never overwrites a topic the operator set (security review M1)", async () => {
    await assertALaterReactivateNeverOverwritesASetTopic(ctx, jwt);
  }, 30_000);
});
