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
  assertAnEditRepairsALegacyEmptyMqttTopic,
  assertClearingMqttTopicOnTwoRtusDoesNotCollide,
  assertClearingRtuCodeOnTwoRtusDoesNotCollide,
  assertCreateRefusesATakenCodeAtTheSameLocation,
  assertCreateRefusesATakenExternalRtuId,
  assertCreateRefusesATakenMqttTopic,
  assertCreateRefusesATakenRtuCode,
  assertCreatingTwoRtusWithAnEmptyMqttTopicDoesNotCollide,
  assertUpdateDoesNotSelfCollideOnAnUnchangedRtuCode,
  assertUpdateRefusesATakenCodeAtTheSameLocation,
  assertUpdateRefusesATakenExternalRtuId,
  assertUpdateRefusesATakenMqttTopic,
  assertUpdateRefusesATakenRtuCode,
  type RtuUniqueConflictCtx,
} from "./rtus.unique-conflict.integration.spec";
import { jwtFor, primeSeededSubjects } from "../../testing/seeded-subjects";

/**
 * `F4.60` / `F4.141` — Vitest entry point. Assertions live in the sibling
 * `.spec` (ADR 0014); this file owns the database lifecycle. Same shape as
 * `rtus.telemetry-source.integration.test.ts`, which covers the other half of
 * this service's write path.
 */
const connectionString = requireIntegrationDb({
  item: "F4.60 / F4.141 / F4.223",
  label: "RtusAdminService answering a duplicate on any rtus unique constraint with 409",
  because:
    "the claim is that the database raises 23505 naming rtus_rtu_code_idx, " +
    "rtus_external_rtu_idx, rtus_mqtt_topic_idx or rtus_location_code_unique, " +
    "that Drizzle's rollback re-throws the driver's own object with that field " +
    "intact, and that an update restating an unchanged rtu_code does not " +
    "collide with itself, and that an empty mqttTopic is stored as NULL, which " +
    "the index's IS NOT NULL predicate needs for two cleared RTUs to coexist. " +
    "None of these can be seen from a fake tx, and all fail silently: a 500 " +
    "on a value the operator chose, or every edit of an ingest-bound RTU " +
    "refused.",
});

const ORGANIZATION_ADMIN_EMAIL = "phe-admin@bms.local";

describe.skipIf(!connectionString)(
  "F4.60 / F4.141 / F4.223 — a duplicate on an rtus unique constraint is 409",
  () => {
    let fixturePool: pg.Pool;
    let authPool: pg.Pool;
    let tenantPool: pg.Pool;
    let ctx: RtuUniqueConflictCtx;

    let jwt: JwtPayload;
    const createdRtuIds: string[] = [];

    beforeAll(async () => {
      const url = connectionString as string;
      // `requireIntegrationDb` defaults to `bms_fleet`, which is `BYPASSRLS`
      // (migration 0039). The read-back and the fleet-wide row counts need to see
      // across the tenant policy — under `FORCE ROW LEVEL SECURITY` a count as
      // `bms_owner` returns 0 with the rows present.
      fixturePool = await openIntegrationPool(url, "F4.60");
      // F3.78: jwtFor carries the real bms.users.id as sub (ADR 0089 decision 4).
      await primeSeededSubjects(fixturePool);
      jwt = jwtFor(ORGANIZATION_ADMIN_EMAIL, "organization_admin");
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

    it("refuses a create whose externalRtuId is already held", async () => {
      await assertCreateRefusesATakenExternalRtuId(ctx, jwt);
    }, 30_000);

    it("refuses an update whose externalRtuId is already held, and writes no part of it", async () => {
      await assertUpdateRefusesATakenExternalRtuId(ctx, jwt);
    }, 30_000);

    it("refuses a create whose mqttTopic is already held", async () => {
      await assertCreateRefusesATakenMqttTopic(ctx, jwt);
    }, 30_000);

    it("refuses an update whose mqttTopic is already held, and writes no part of it", async () => {
      await assertUpdateRefusesATakenMqttTopic(ctx, jwt);
    }, 30_000);

    it("lets two RTUs be created with an empty mqttTopic, stored as NULL", async () => {
      await assertCreatingTwoRtusWithAnEmptyMqttTopicDoesNotCollide(ctx, jwt);
    }, 30_000);

    it("lets two RTUs clear their mqttTopic, stored as NULL", async () => {
      await assertClearingMqttTopicOnTwoRtusDoesNotCollide(ctx, jwt);
    }, 30_000);

    it("repairs a legacy '' mqttTopic on the next edit", async () => {
      await assertAnEditRepairsALegacyEmptyMqttTopic(ctx, jwt);
    }, 30_000);

    it("refuses a create whose code is already used at the same location", async () => {
      await assertCreateRefusesATakenCodeAtTheSameLocation(ctx, jwt);
    }, 30_000);

    it("refuses an update whose code is already used at the same location, and writes no part of it", async () => {
      await assertUpdateRefusesATakenCodeAtTheSameLocation(ctx, jwt);
    }, 30_000);
  },
);
