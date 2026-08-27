import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";
import type { BmsDb } from "@bms/db";

import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import {
  assertNullOrgChannelIsolatedFromTenant,
  assertNullOrgDeliveryIsRefusedForEveryRole,
  assertNullOrgUserInsertIsRefusedForTenant,
  assertRuleNotificationsJunctionKeysOnRuleOrg,
  assertTenantCannotCreateNullOrgChannel,
} from "./channels.rls.integration.spec";

/**
 * `E7.1b` — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the database lifecycle. It seeds a NULL-org
 * `notification_channels` row (every E7.1b channel is org-less) and an
 * `automation_rules` row in a real organization, both on the fleet (BYPASSRLS)
 * pool the gate hands back, then drives the `0047` channel and
 * `rule_notifications` policies with a real `bms_tenant`/`bms_fleet` pair.
 *
 * This is the proof the notifications write-path unit banked for Task 4: before
 * `0047` a fleetDb CRUD test on a channel passed either way, so the claim that a
 * NULL-org channel is invisible and unmodifiable from the tenant pool could not
 * be shown in that unit's own suite.
 */
const connectionString = requireIntegrationDb({
  item: "E7.1b",
  label: "notification_channels + rule_notifications 0047 policies against real, non-owner roles",
  because:
    "The notifications unit moved every channel/delivery read and write onto fleetDb because a " +
    "NULL-org channel is invisible and unmodifiable from the tenant pool under FORCE — but 0047 " +
    "did not exist then, so a fleetDb CRUD test proved nothing. A real bms_tenant connection is " +
    "the only proof the channel policy hides a NULL-org row from every tenant, and that the " +
    "rule_notifications junction isolates by the rule's org rather than the channel's NULL one.",
});

const ORGANIZATION_ADMIN_EMAIL = "phe-admin@bms.local";

// Per-run fixture codes. Both target tables carry a global UNIQUE `code`, and
// cleanup is by id (below), not a `code LIKE` sweep — so randomUUID here is
// collision-avoidance for concurrent runs, not the isolation invariant's
// per-run-prefix rule (which only governs family `DELETE ... WHERE code LIKE`).
const RUN = randomUUID().replace(/-/g, "").slice(0, 12);
const CHANNEL_CODE = `E71B-NCH-${RUN}`;
const RULE_CODE = `E71B-NRULE-${RUN}`;
// The NULL-org channel a tenant attempts to plant directly — E7.1c: refused
// outright once 0048 lands (self-cleaning in the fleet-pool branch of the
// assertion, which still succeeds).
const TENANT_CREATED_CODE = `E71B-NCHTC-${RUN}`;
// E7.1c — the positive-control code for an org-scoped insert on the tenant
// pool. Self-cleaning inside the same transaction as its own assertion.
const TENANT_ORG_SCOPED_CODE = `E71C-NCHOS-${RUN}`;
// E7.1c — the NULL-org bms.users probe email. Never lands (0039:106 revokes
// the grant), so there is nothing to clean up.
const NULL_ORG_USER_EMAIL = `e71c-null-org-user-${RUN}@bms.local`;

describe.skipIf(!connectionString)("E7.1b — notification channel + junction isolation under real RLS", () => {
  let ownerPool: pg.Pool;
  let tenantPool: pg.Pool;
  let tenantDb: BmsDb;
  let fleetDb: BmsDb;
  let ruleOrgId = "";
  let otherOrgId = "";
  let channelId = "";
  let ruleId = "";
  let channelKind = "";

  beforeAll(async () => {
    const url = connectionString as string;
    // The gate hands back the fleet (BYPASSRLS) connection by default — the pool
    // the service uses for channels, and the one that must see the NULL-org row.
    ownerPool = await openIntegrationPool(url, "E7.1b");
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "E7.1b",
    );
    fleetDb = createDb(ownerPool);
    tenantDb = createDb(tenantPool);

    const org = await ownerPool.query<{ id: string }>(
      `SELECT uoa.organization_id AS id
         FROM bms.user_organization_access uoa
         JOIN bms.users u ON u.id = uoa.user_id
        WHERE u.email = $1
        LIMIT 1`,
      [ORGANIZATION_ADMIN_EMAIL],
    );
    if (!org.rows[0]) {
      throw new Error(`E7.1b: ${ORGANIZATION_ADMIN_EMAIL} has no organization grant — run pnpm db:seed.`);
    }
    ruleOrgId = org.rows[0].id;

    const other = await ownerPool.query<{ id: string }>(
      "SELECT id FROM bms.organizations WHERE id <> $1 LIMIT 1",
      [ruleOrgId],
    );
    if (!other.rows[0]) {
      throw new Error("E7.1b: need a second organization to prove the junction keys on the rule's org.");
    }
    otherOrgId = other.rows[0].id;

    const kind = await ownerPool.query<{ code: string }>(
      "SELECT code FROM bms.notification_channel_kinds WHERE active = true LIMIT 1",
    );
    if (!kind.rows[0]) {
      throw new Error("E7.1b: no active notification_channel_kind — run pnpm db:seed.");
    }
    channelKind = kind.rows[0].code;

    const category = await ownerPool.query<{ code: string }>(
      "SELECT code FROM bms.rule_categories LIMIT 1",
    );
    if (!category.rows[0]) {
      throw new Error("E7.1b: no rule_categories — run pnpm db:seed.");
    }

    // NULL-org channel — `organization_id` is left to its nullable default.
    // Seeded on the fleet pool because a global (fleet-managed) channel is
    // decision 7's `bms_fleet`-only write, not because a tenant connection is
    // unable to write one here: under the still-landed `0047` a tenant CAN
    // write a NULL-org channel (that is the pre-`0048` defect
    // `assertTenantCannotCreateNullOrgChannel`'s first assertion documents). A
    // tenant connection cannot write a NULL-org row only once `0048` lands and
    // role-scopes the WITH CHECK NULL disjunct `TO bms_fleet` — that is the
    // expected **post-0048** state, not the current one.
    const chan = await ownerPool.query<{ id: string }>(
      `INSERT INTO bms.notification_channels (code, name, kind, enabled)
         VALUES ($1, $2, $3, true) RETURNING id`,
      [CHANNEL_CODE, "E7.1b RLS null-org channel", kind.rows[0].code],
    );
    channelId = chan.rows[0]!.id;

    // A rule in organization A — the junction's isolation key.
    const rule = await ownerPool.query<{ id: string }>(
      `INSERT INTO bms.automation_rules (organization_id, code, name, rule_type, category)
         VALUES ($1, $2, $3, 'time_window', $4) RETURNING id`,
      [ruleOrgId, RULE_CODE, "E7.1b RLS junction rule", category.rows[0].code],
    );
    ruleId = rule.rows[0]!.id;
  });

  afterAll(async () => {
    // children first, on the BYPASSRLS fleet connection. rule_notifications.channel_id
    // has no cascade, so clear the junction before the channel; the rule cascade
    // would also clear it, but the explicit delete keeps the order self-evident.
    if (ownerPool) {
      if (channelId) {
        await ownerPool.query("DELETE FROM bms.rule_notifications WHERE channel_id = $1", [channelId]);
      }
      if (ruleId) {
        await ownerPool.query("DELETE FROM bms.automation_rules WHERE id = $1", [ruleId]);
      }
      if (channelId) {
        await ownerPool.query("DELETE FROM bms.notification_channels WHERE id = $1", [channelId]);
      }
      // Defensive: the tenant-created channel and the positive-control channel
      // both self-clean in their assertions, but clear them here too in case
      // either assertion threw before reaching its own cleanup.
      await ownerPool.query("DELETE FROM bms.notification_channels WHERE code = $1", [
        TENANT_CREATED_CODE,
      ]);
      await ownerPool.query("DELETE FROM bms.notification_channels WHERE code = $1", [
        TENANT_ORG_SCOPED_CODE,
      ]);
      // No defensive cleanup for NULL_ORG_USER_EMAIL: 0039:106 revokes INSERT
      // *and* DELETE on bms.users from both bms_tenant and bms_fleet, so
      // `ownerPool` here (the fleet/BYPASSRLS connection this gate hands back
      // by default) could not run the delete even if the insert ever landed.
      // That the row can never be inserted is exactly what the assertion pins.
    }
    await Promise.all([ownerPool, tenantPool].filter(Boolean).map((p) => p.end()));
  });

  it("hides and refuses to modify a NULL-org channel from a tenant, reachable only via fleet", async () => {
    await assertNullOrgChannelIsolatedFromTenant(tenantDb, fleetDb, channelId, ruleOrgId);
  });

  it("isolates the rule_notifications junction by the rule's org, not the NULL-org channel", async () => {
    await assertRuleNotificationsJunctionKeysOnRuleOrg(
      tenantDb,
      ruleId,
      ruleOrgId,
      otherOrgId,
      channelId,
    );
  });

  it("refuses a tenant-created NULL-org channel outright, with an org-scoped positive control", async () => {
    await assertTenantCannotCreateNullOrgChannel(
      tenantDb,
      fleetDb,
      ruleOrgId,
      TENANT_CREATED_CODE,
      TENANT_ORG_SCOPED_CODE,
      channelKind,
    );
  });

  it("refuses a NULL-org delivery for both bms_tenant and bms_fleet", async () => {
    await assertNullOrgDeliveryIsRefusedForEveryRole(tenantDb, fleetDb, ruleOrgId, channelId);
  });

  it("refuses a NULL-org bms.users insert for bms_tenant (the grant, not the policy)", async () => {
    await assertNullOrgUserInsertIsRefusedForTenant(tenantDb, ruleOrgId, NULL_ORG_USER_EMAIL);
  });
});
