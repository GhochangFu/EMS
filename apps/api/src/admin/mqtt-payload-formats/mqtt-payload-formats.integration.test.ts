import type pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { openIntegrationPool, requireIntegrationDb } from "../../testing/integration-db-gate";
import { asRole } from "../../testing/role-urls";
import { jwtFor, primeSeededSubjects, SEEDED } from "../../testing/seeded-subjects";
import { MasterDataAuditService } from "../master-data-audit.service";
import { RtusAdminService } from "../rtus/rtus.service";
import {
  assertCreateIsTheGlobalAdminsAndAudited,
  assertInUseFormatsCannotBeDeleted,
  assertTheRtuRouteRefusals,
  assertTheSeededRowsAreReadable,
  assertTheTestRouteWritesNothing,
  assertUpdateAndTheBuiltinRow,
  type MpfFixtures,
} from "./mqtt-payload-formats.integration.spec";
import { MqttPayloadFormatsAdminService } from "./mqtt-payload-formats.service";

/**
 * `F4.334` (plan T3.1, T3.5) — Vitest entry point. Assertions live in the
 * sibling `.spec` (ADR 0014); this file owns the database lifecycle: the
 * service reads and writes on `bms_fleet`, the audit service holds both pools,
 * access control reads `bms.users` on `bms_auth`, and the RTU route writes the
 * connection row on `bms_tenant` under the RTU's organization.
 */
const connectionString = requireIntegrationDb({
  item: "F4.334",
  label: "the MQTT payload format catalog and the RTU format route",
  because:
    "the global-admin gate, the 409s on the built-in row and on a format in use (listing the RTUs " +
    "and drafts), the org-less audit rows and the RTU config key written and removed are all claims " +
    "about rows Postgres holds; a green run without a database asserts none of them.",
});

describe.skipIf(!connectionString)("F4.334 — the payload format catalog service and the RTU route", () => {
  let observer: pg.Pool;
  let authPool: pg.Pool;
  let tenantPool: pg.Pool;
  let ctx: MpfFixtures;
  let admin: JwtPayload;
  let tenantAdmin: JwtPayload;
  const stamp = String(Date.now());
  const rtuIds: string[] = [];

  beforeAll(async () => {
    const url = connectionString as string;
    observer = await openIntegrationPool(url, "F4.334");
    authPool = await openIntegrationPool(process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"), "F4.334");
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F4.334",
    );
    await primeSeededSubjects(observer);
    admin = jwtFor(SEEDED.globalAdmin, "admin");
    tenantAdmin = jwtFor(SEEDED.organizationAdmin, "organization_admin");

    const { rows: org } = await observer.query<{ id: string; code: string }>(
      `SELECT o.id, o.code FROM bms.user_organization_access uoa
         JOIN bms.users u ON u.id = uoa.user_id
         JOIN bms.organizations o ON o.id = uoa.organization_id
        WHERE u.email = $1 LIMIT 1`,
      [SEEDED.organizationAdmin],
    );
    if (!org[0]) throw new Error(`F4.334: ${SEEDED.organizationAdmin} has no organization grant — run pnpm db:seed.`);
    const { rows: loc } = await observer.query<{ id: string }>(
      "SELECT id FROM bms.locations WHERE organization_id = $1 AND active = true ORDER BY created_at, code LIMIT 1",
      [org[0].id],
    );
    if (!loc[0]) throw new Error("F4.334: the organization has no active location — run pnpm db:seed.");

    const rtu = async (suffix: string, protocol: string | null): Promise<{ id: string; code: string }> => {
      const code = `f4334-${stamp}-${suffix}`;
      const { rows } = await observer.query<{ id: string }>(
        `INSERT INTO bms.rtus (organization_id, location_id, code, display_name, source_type, ingest_enabled, active)
         VALUES ($1, $2, $3, $3, 'catalog', false, true) RETURNING id`,
        [org[0]!.id, loc[0]!.id, code],
      );
      const id = rows[0]!.id;
      rtuIds.push(id);
      if (protocol !== null) {
        await observer.query(
          `INSERT INTO bms.rtu_connection_configs (organization_id, rtu_id, protocol, config) VALUES ($1, $2, $3, '{}'::jsonb)`,
          [org[0]!.id, id, protocol],
        );
      }
      return { id, code };
    };
    const mqtt = await rtu("mqtt", "mqtt");
    const modbus = await rtu("modbus", "modbus_tcp");
    const bare = await rtu("bare", null);

    const fleetDb = createDb(observer);
    const tenantDb = createDb(tenantPool);
    const accessControl = new AccessControlService(createDb(authPool), fleetDb);
    const audit = new MasterDataAuditService(tenantDb, fleetDb);
    ctx = {
      svc: new MqttPayloadFormatsAdminService(fleetDb, accessControl, audit),
      rtus: new RtusAdminService(fleetDb, tenantDb, accessControl, audit),
      observer,
      stamp,
      mqttRtuId: mqtt.id,
      mqttRtuCode: mqtt.code,
      modbusRtuId: modbus.id,
      bareRtuId: bare.id,
      organizationId: org[0].id,
      organizationCode: org[0].code,
      formatIds: [],
      sessionIds: [],
    };
  }, 60_000);

  afterAll(async () => {
    if (observer) {
      const ids = [...(ctx?.formatIds ?? []), ...rtuIds];
      await observer.query("DELETE FROM bms.audit_log WHERE entity_id = ANY($1::uuid[])", [ids]);
      await observer.query("DELETE FROM bms.onboarding_sessions WHERE id = ANY($1::uuid[])", [ctx?.sessionIds ?? []]);
      await observer.query("DELETE FROM bms.rtus WHERE id = ANY($1::uuid[])", [rtuIds]);
      await observer.query("DELETE FROM bms.mqtt_payload_formats WHERE code LIKE $1", [`f4334-${stamp}-%`]);
    }
    await Promise.all([observer?.end(), authPool?.end(), tenantPool?.end()]);
  }, 60_000);

  it("I0 lets a master-data user read the seeded rows, the built-in flagged", async () => {
    await assertTheSeededRowsAreReadable(ctx, tenantAdmin);
  });

  it("I1/I2 lets only the global admin create, with one org-less audit row, and answers 409/400", async () => {
    await assertCreateIsTheGlobalAdminsAndAudited(ctx, admin, tenantAdmin);
  });

  it("I3 audits an edit and refuses to edit or delete the built-in row", async () => {
    await assertUpdateAndTheBuiltinRow(ctx, admin);
  });

  it("I4 sets and clears an RTU's format and refuses to delete a format in use, listing it", async () => {
    await assertInUseFormatsCannotBeDeleted(ctx, admin, tenantAdmin);
  });

  it("refuses an unknown code (409), a non-MQTT RTU (400) and an RTU with no config (404)", async () => {
    await assertTheRtuRouteRefusals(ctx, tenantAdmin);
  });

  it("I5 decodes a sample on the test route and writes no audit row", async () => {
    await assertTheTestRouteWritesNothing(ctx, admin);
  });
});
