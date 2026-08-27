import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";
import type { BmsDb } from "@bms/db";

import { AccessControlService } from "../auth/access-control.service";
import { jwtFor, SEEDED } from "../auth/access-control.integration.spec";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import { countingDb } from "../testing/counting-db";
import { ChannelsService } from "./channels.service";
import {
  assertChannelAuditStampsOrgCorrectly,
  assertChannelRemoveRoutesByOrgScope,
  assertChannelWritesRouteByOrgScope,
} from "./channels.service.rls.integration.spec";

/**
 * `E7.1c` (Task 7) — Vitest entry point. Assertions live in the sibling
 * `.spec` (ADR 0014); this file owns the database lifecycle, per-run fixture
 * codes, and cleanup.
 */
const connectionString = requireIntegrationDb({
  item: "E7.1c",
  label: "ChannelsService.create/update/remove org-scope routing and the audit hazard",
  because:
    "whether an org-scoped channel write opens a tenant transaction (and a global one opens " +
    "none) is a fact about which real connection Postgres saw, and countingDb only means " +
    "anything wrapped around a real BmsDb — a fake db proves nothing about the withTenant/" +
    "fleetDb fork. The audit organizationId stamp is the same: bms_fleet is BYPASSRLS, so a " +
    "wrong value is silently admitted, not refused, and only a real read-back catches it.",
});

const RUN = randomUUID().replace(/-/g, "").slice(0, 12);
const ORG_SCOPED_SCOPE_CODE = `E71C-CHSC-${RUN}`;
const GLOBAL_SCOPE_CODE = `E71C-CHGL-${RUN}`;
const ORG_SCOPED_AUDIT_CODE = `E71C-CHAO-${RUN}`;
const GLOBAL_AUDIT_CODE = `E71C-CHAG-${RUN}`;

describe.skipIf(!connectionString)(
  "E7.1c — ChannelsService writes route by org scope, and audit() stamps the right org",
  () => {
    let ownerPool: pg.Pool;
    let tenantPool: pg.Pool;
    let authPool: pg.Pool;
    let fleetDb: BmsDb;
    let channelIds: string[] = [];

    beforeAll(async () => {
      const url = connectionString as string;
      ownerPool = await openIntegrationPool(url, "E7.1c");
      tenantPool = await openIntegrationPool(
        process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
        "E7.1c",
      );
      authPool = await openIntegrationPool(
        process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"),
        "E7.1c",
      );
      fleetDb = createDb(ownerPool);
    }, 60_000);

    afterAll(async () => {
      if (channelIds.length > 0) {
        await ownerPool.query(
          `DELETE FROM bms.notification_deliveries WHERE channel_id = ANY($1::uuid[])`,
          [channelIds],
        );
        await ownerPool.query(`DELETE FROM bms.audit_log WHERE entity_id = ANY($1::uuid[])`, [
          channelIds,
        ]);
        await ownerPool.query(`DELETE FROM bms.notification_channels WHERE id = ANY($1::uuid[])`, [
          channelIds,
        ]);
      }
      await Promise.all([ownerPool, tenantPool, authPool].filter(Boolean).map((p) => p.end()));
    }, 60_000);

    it("routes create/update/remove onto withTenant for an org-scoped channel, and fleetDb for a global one; audit() stamps the right org", async () => {
      const org = await ownerPool.query<{ id: string }>(
        `SELECT uoa.organization_id AS id
           FROM bms.user_organization_access uoa
           JOIN bms.users u ON u.id = uoa.user_id
          WHERE u.email = $1
          LIMIT 1`,
        [SEEDED.organizationAdmin],
      );
      const orgAdminOrgId = org.rows[0]?.id;
      if (!orgAdminOrgId) {
        throw new Error(`E7.1c: ${SEEDED.organizationAdmin} has no organization grant — run pnpm db:seed.`);
      }

      const kindRow = await ownerPool.query<{ code: string }>(
        "SELECT code FROM bms.notification_channel_kinds WHERE active = true LIMIT 1",
      );
      const kind = kindRow.rows[0]?.code;
      if (!kind) throw new Error("E7.1c: no active notification_channel_kind — run pnpm db:seed.");

      const countedTenant = countingDb(createDb(tenantPool));
      const countedFleet = countingDb(fleetDb);
      const accessControl = new AccessControlService(createDb(authPool), fleetDb);
      const channels = new ChannelsService(
        countedFleet.db,
        countedTenant.db,
        { encrypt: () => ({ ciphertext: Buffer.alloc(0), iv: Buffer.alloc(0), keyVersion: 1 }) } as unknown as ConstructorParameters<
          typeof ChannelsService
        >[2],
        accessControl,
      );

      const orgAdminJwt = jwtFor(SEEDED.organizationAdmin, "organization_admin");
      const globalAdminJwt = jwtFor(SEEDED.globalAdmin, "admin");

      const scoped = await assertChannelWritesRouteByOrgScope(
        channels,
        countedTenant,
        countedFleet,
        orgAdminJwt,
        globalAdminJwt,
        kind,
        ORG_SCOPED_SCOPE_CODE,
        GLOBAL_SCOPE_CODE,
      );
      channelIds.push(scoped.orgScopedChannelId, scoped.globalChannelId);
      await assertChannelRemoveRoutesByOrgScope(
        channels,
        countedTenant,
        countedFleet,
        orgAdminJwt,
        globalAdminJwt,
        scoped.orgScopedChannelId,
        scoped.globalChannelId,
      );

      const audited = await assertChannelAuditStampsOrgCorrectly(
        channels,
        fleetDb,
        orgAdminJwt,
        globalAdminJwt,
        orgAdminOrgId,
        kind,
        ORG_SCOPED_AUDIT_CODE,
        GLOBAL_AUDIT_CODE,
      );
      channelIds.push(audited.orgScopedChannelId, audited.globalChannelId);
    }, 60_000);
  },
);
