import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";
import type { BmsDb } from "@bms/db";

import { AccessControlService } from "../auth/access-control.service";
import { jwtFor, SEEDED } from "../auth/access-control.integration.spec";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import { ChannelsService } from "./channels.service";
import { EscalationProfilesService } from "./escalation-profiles.service";
import {
  assertAMappedProfileCannotBeDeleted,
  assertDefaultsParentLegRefusesAForeignProfile,
  assertProfileIsolatedFromOtherTenant,
  assertSetDefaultsRefusesAForeignProfileWith400,
  assertStepAndChannelJoinIsolatedFromOtherTenant,
} from "./escalation-profiles.rls.integration.spec";

/**
 * `F3.10` U8 — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the database lifecycle, the per-run fixture codes
 * and the cleanup.
 */
const connectionString = requireIntegrationDb({
  item: "F3.10",
  label: "the 0066 escalation policies against real, non-owner roles",
  because:
    "three of the four escalation tables are junction-shaped and police through a parent, and " +
    "alarm_escalation_defaults carries a parent leg on profile_id because a foreign key is " +
    "checked with row security OFF — so a fleetDb CRUD test passes identically whether the " +
    "legs exist or not. A real bms_tenant connection under a second organization's GUC is the " +
    "only thing that can tell one tenant's ladder from another's, and the only place the " +
    "service's 400 can be shown to arrive before the policy's 42501 does.",
});

const RUN = randomUUID().replace(/-/g, "").slice(0, 12);
const PROFILE_CODE_A = `f310-esc-a-${RUN}`;
const PROFILE_CODE_B = `f310-esc-b-${RUN}`;
const FLEET_CHANNEL_CODE = `f310-escch-${RUN}`;

describe.skipIf(!connectionString)(
  "F3.10 — escalation profiles, steps, step channels and the severity map isolate by tenant",
  () => {
    let ownerPool: pg.Pool;
    let tenantPool: pg.Pool;
    let authPool: pg.Pool;
    let fleetDb: BmsDb;
    let tenantDb: BmsDb;
    let orgAId = "";
    let orgBId = "";
    let profileIdA = "";
    let profileIdB = "";
    let stepIdA = "";
    let fleetChannelId = "";
    let severity = "";

    beforeAll(async () => {
      const url = connectionString as string;
      // The gate hands back the fleet (BYPASSRLS) connection by default — the
      // pool the service reads across organizations on, and the one that must
      // see both tenants' rows.
      ownerPool = await openIntegrationPool(url, "F3.10");
      tenantPool = await openIntegrationPool(
        process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
        "F3.10",
      );
      authPool = await openIntegrationPool(
        process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"),
        "F3.10",
      );
      fleetDb = createDb(ownerPool);
      tenantDb = createDb(tenantPool);

      const orgA = await ownerPool.query<{ id: string }>(
        `SELECT uoa.organization_id AS id
           FROM bms.user_organization_access uoa
           JOIN bms.users u ON u.id = uoa.user_id
          WHERE u.email = $1
          LIMIT 1`,
        [SEEDED.organizationAdmin],
      );
      if (!orgA.rows[0]) {
        throw new Error(`F3.10: ${SEEDED.organizationAdmin} has no organization grant — run pnpm db:seed.`);
      }
      orgAId = orgA.rows[0].id;

      const orgB = await ownerPool.query<{ id: string }>(
        "SELECT id FROM bms.organizations WHERE id <> $1 LIMIT 1",
        [orgAId],
      );
      if (!orgB.rows[0]) {
        throw new Error("F3.10: need a second organization to prove the tenant fence.");
      }
      orgBId = orgB.rows[0].id;

      const severityRow = await ownerPool.query<{ code: string }>(
        "SELECT code FROM bms.alarm_severities ORDER BY code LIMIT 1",
      );
      if (!severityRow.rows[0]) throw new Error("F3.10: no alarm_severities row — run pnpm db:seed.");
      severity = severityRow.rows[0].code;

      const kind = await ownerPool.query<{ code: string }>(
        "SELECT code FROM bms.notification_channel_kinds WHERE active = true LIMIT 1",
      );
      if (!kind.rows[0]) throw new Error("F3.10: no active notification_channel_kind — run pnpm db:seed.");

      // A FLEET-WIDE channel on purpose: the step_channels policy deliberately
      // says nothing about the channel's organization (D6), so a NULL-org
      // channel is the case where a policy written against the channel instead
      // of the step's profile would let another tenant see the join.
      const channel = await ownerPool.query<{ id: string }>(
        `INSERT INTO bms.notification_channels (organization_id, code, name, kind, config, enabled)
         VALUES (NULL, $1, 'F3.10 escalation RLS fixture', $2, '{}'::jsonb, true)
         RETURNING id`,
        [FLEET_CHANNEL_CODE, kind.rows[0].code],
      );
      fleetChannelId = channel.rows[0]?.id as string;

      const profileA = await ownerPool.query<{ id: string }>(
        `INSERT INTO bms.alarm_escalation_profiles (organization_id, code, name)
         VALUES ($1, $2, 'F3.10 org A') RETURNING id`,
        [orgAId, PROFILE_CODE_A],
      );
      profileIdA = profileA.rows[0]?.id as string;
      const profileB = await ownerPool.query<{ id: string }>(
        `INSERT INTO bms.alarm_escalation_profiles (organization_id, code, name)
         VALUES ($1, $2, 'F3.10 org B') RETURNING id`,
        [orgBId, PROFILE_CODE_B],
      );
      profileIdB = profileB.rows[0]?.id as string;

      const step = await ownerPool.query<{ id: string }>(
        `INSERT INTO bms.alarm_escalation_steps (profile_id, step_no, after_minutes)
         VALUES ($1, 1, 5) RETURNING id`,
        [profileIdA],
      );
      stepIdA = step.rows[0]?.id as string;
      await ownerPool.query(
        `INSERT INTO bms.alarm_escalation_step_channels (step_id, channel_id) VALUES ($1, $2)`,
        [stepIdA, fleetChannelId],
      );
    }, 60_000);

    afterAll(async () => {
      if (ownerPool) {
        // Child-first: defaults and step channels reference the profile and the
        // step, and `defaults.profile_id` is NO ACTION by design.
        await ownerPool.query(
          `DELETE FROM bms.alarm_escalation_defaults WHERE organization_id = ANY($1::uuid[])`,
          [[orgAId, orgBId].filter(Boolean)],
        );
        if (stepIdA) {
          await ownerPool.query(
            `DELETE FROM bms.alarm_escalation_step_channels WHERE step_id = $1`,
            [stepIdA],
          );
          await ownerPool.query(`DELETE FROM bms.alarm_escalation_steps WHERE id = $1`, [stepIdA]);
        }
        await ownerPool.query(`DELETE FROM bms.alarm_escalation_profiles WHERE code = ANY($1::text[])`, [
          [PROFILE_CODE_A, PROFILE_CODE_B],
        ]);
        if (fleetChannelId) {
          await ownerPool.query(`DELETE FROM bms.notification_channels WHERE id = $1`, [
            fleetChannelId,
          ]);
        }
        // Narrowed by ACTION as well as by entity: `entity_id` for a severity
        // map is the ORGANIZATION id (the map has no id of its own), so an
        // entity-only delete would reap unrelated rows for that organization.
        await ownerPool.query(
          `DELETE FROM bms.audit_log
            WHERE action LIKE 'alarm_escalation_%' AND entity_id = ANY($1::uuid[])`,
          [[orgAId, orgBId, profileIdA, profileIdB].filter(Boolean)],
        );
      }
      await Promise.all([ownerPool, tenantPool, authPool].filter(Boolean).map((p) => p.end()));
    }, 60_000);

    it("fences profiles, steps and step channels by tenant, and refuses a foreign profile on the severity map", async () => {
      await assertProfileIsolatedFromOtherTenant(tenantDb, fleetDb, profileIdA, profileIdB, orgBId);
      await assertStepAndChannelJoinIsolatedFromOtherTenant(
        tenantDb,
        fleetDb,
        stepIdA,
        fleetChannelId,
        orgAId,
        orgBId,
      );
      await assertDefaultsParentLegRefusesAForeignProfile(
        tenantDb,
        fleetDb,
        orgBId,
        profileIdA,
        profileIdB,
        severity,
      );

      const accessControl = new AccessControlService(createDb(authPool), fleetDb);
      const channels = new ChannelsService(
        fleetDb,
        tenantDb,
        {
          encrypt: () => ({ ciphertext: Buffer.alloc(0), iv: Buffer.alloc(0), keyVersion: 1 }),
        } as unknown as ConstructorParameters<typeof ChannelsService>[2],
        accessControl,
      );
      const service = new EscalationProfilesService(fleetDb, tenantDb, channels, accessControl);
      const adminJwt = jwtFor(SEEDED.globalAdmin, "admin");
      await assertSetDefaultsRefusesAForeignProfileWith400(
        service,
        adminJwt,
        orgBId,
        profileIdA,
        severity,
      );
      await assertAMappedProfileCannotBeDeleted(
        service,
        fleetDb,
        adminJwt,
        orgBId,
        profileIdB,
        severity,
      );
    }, 60_000);
  },
);
