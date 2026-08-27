import { expect } from "vitest";

import { sql } from "drizzle-orm";

import { ruleNotifications } from "@bms/db";
import type { BmsDb } from "@bms/db";

import { withTenant } from "../database/tenant-context";

/**
 * `E7.1b` (ADR 0043 decision 5/7, plan Task 4 "banked proof") — the two
 * behavioural claims the notifications write-path unit made but could not
 * demonstrate in its own suite.
 *
 * That unit moved every `notification_channels` / `notification_deliveries`
 * read **and** write onto `fleetDb` (BYPASSRLS) *because* a NULL-org channel
 * row — which every E7.1b channel is, org population is E7.1c decision 7 — is
 * invisible from the tenant pool under `FORCE`, and an existing one is
 * unmodifiable there (write-containment is partial — see the create case). But `0047` did
 * not exist yet, so a `fleetDb` CRUD test passed identically before and after
 * the policy landed and proved nothing (plan lines 266-269, 436-445). Now that
 * `0047` is in, this file discriminates: the same reads/writes behave one way
 * on a real `bms_tenant` connection and another on `bms_fleet`.
 *
 * These are policy-level proofs, driven with raw pool SQL rather than through
 * `ChannelsService`, because no service path touches channels on the tenant
 * pool — the service reads and writes them exclusively on `fleetDb`. The honest
 * layer for "the `0047` policy isolates a NULL-org channel" is the policy
 * itself, exercised directly against the real role. `assertPolicyRefusesMismatchedOrg`
 * in `admin/locations/locations.rls.integration.spec.ts` is the same idiom.
 */

/**
 * An EXISTING (fleet-written) NULL-org `notification_channels` row is invisible
 * to any single-tenant GUC and cannot be UPDATEd or DELETEd by a tenant, and is
 * fully visible AND modifiable via `bms_fleet`.
 *
 * The `0047` policy on the four nullable-org tables keeps `USING` strict
 * (`organization_id = current_org`, so `NULL = <org>` is never true) while
 * relaxing only `WITH CHECK` to admit a NULL-org insert. So an existing NULL-org
 * row:
 *   - never satisfies `USING` under any GUC → invisible to `SELECT`, and an
 *     `UPDATE`/`DELETE` matches zero rows **without erroring** (the silent
 *     no-op `FORCE` produces, not a raised policy violation);
 *   - is reached only through BYPASSRLS.
 *
 * This is read-and-modify containment of the EXISTING row, not full write
 * containment: the relaxed `WITH CHECK` also lets a tenant CREATE a fresh
 * NULL-org channel (see `assertTenantCanCreateButNotSeeNullOrgChannel`), which
 * is a separate, partial-containment fact.
 *
 * Before `0047` this same sequence passed on the tenant pool too (no policy),
 * so the discriminating assertions are the tenant-side zeros.
 */
export async function assertNullOrgChannelIsolatedFromTenant(
  tenantDb: BmsDb,
  fleetDb: BmsDb,
  channelId: string,
  tenantOrgId: string,
): Promise<void> {
  // Fail-closed with no context at all: a bare tenant connection (no SET LOCAL)
  // has `app.current_organization` unset, so the policy's `current_org` is NULL
  // and the row is invisible.
  const noContext = await tenantDb.execute(
    sql`SELECT id FROM bms.notification_channels WHERE id = ${channelId}`,
  );
  expect(noContext.rows).toHaveLength(0);

  await withTenant(tenantDb, tenantOrgId, async (tx) => {
    // (a) invisible to SELECT even with a valid, populated tenant GUC.
    const seen = await tx.execute(
      sql`SELECT id FROM bms.notification_channels WHERE id = ${channelId}`,
    );
    expect(seen.rows).toHaveLength(0);

    // (b) unmodifiable — the UPDATE and DELETE find no row to act on and affect
    // zero rows silently, rather than raising. This is the failure mode the
    // notifications unit routes around by writing channels on `fleetDb`.
    const updated = await tx.execute(
      sql`UPDATE bms.notification_channels SET name = 'tenant must not reach this' WHERE id = ${channelId}`,
    );
    expect(updated.rowCount).toBe(0);
    const deleted = await tx.execute(
      sql`DELETE FROM bms.notification_channels WHERE id = ${channelId}`,
    );
    expect(deleted.rowCount).toBe(0);
  });

  // (c) visible AND modifiable via the fleet (BYPASSRLS) connection — the pool
  // the service actually uses. Proves the row survived the tenant UPDATE/DELETE
  // above untouched, then that fleet can change it.
  const fleetSeen = await fleetDb.execute(
    sql`SELECT name FROM bms.notification_channels WHERE id = ${channelId}`,
  );
  expect(fleetSeen.rows).toHaveLength(1);
  expect((fleetSeen.rows[0] as { name: string }).name).not.toBe("tenant must not reach this");

  const fleetUpdated = await fleetDb.execute(
    sql`UPDATE bms.notification_channels SET name = 'fleet may reach this' WHERE id = ${channelId}`,
  );
  expect(fleetUpdated.rowCount).toBe(1);
}

/**
 * A tenant CAN create a NULL-org channel — the `0047` WITH CHECK admits
 * `organization_id IS NULL` regardless of the GUC — which is then invisible to
 * that same tenant (strict USING) and lives only in the fleet-managed global
 * channel namespace. Write-containment is therefore PARTIAL in E7.1b: a tenant
 * cannot read or modify existing NULL-org channels, but can blindly create new
 * ones it cannot see.
 *
 * This is a transitional posture. Channels stay NULL-org and fleet-managed until
 * E7.1c (decision 7) gives them an org, a `SET NOT NULL`, and moves the write to
 * `withTenant`; that is when the create direction closes. Whether `bms_tenant`
 * should hold INSERT on `notification_channels` at all before then is a DB-role
 * containment question for the owner (revoke the grant, or role-scope the
 * `WITH CHECK` NULL disjunct `TO bms_fleet`) — the exposure is bounded to
 * namespace pollution / self-exfiltration: the `rule_notifications` junction
 * keys on the RULE's org (proven below), so a tenant cannot wire another org's
 * rule to a channel it planted, and a victim org cannot see a NULL-org channel
 * to wire one.
 *
 * The INSERT must NOT use RETURNING — RETURNING reads the new row back under the
 * strict USING, which a NULL-org row fails, raising a policy error that would
 * mask the fact that the write itself is admitted.
 */
export async function assertTenantCanCreateButNotSeeNullOrgChannel(
  tenantDb: BmsDb,
  fleetDb: BmsDb,
  tenantOrgId: string,
  code: string,
  kind: string,
): Promise<void> {
  await withTenant(tenantDb, tenantOrgId, async (tx) => {
    // Plain INSERT (no RETURNING): admitted by `organization_id IS NULL`.
    await tx.execute(
      sql`INSERT INTO bms.notification_channels (code, name, kind, enabled)
          VALUES (${code}, 'E7.1b tenant-created null-org', ${kind}, true)`,
    );
    // ...but immediately invisible to its own creator under the strict USING.
    const seen = await tx.execute(
      sql`SELECT id FROM bms.notification_channels WHERE code = ${code}`,
    );
    expect(seen.rows).toHaveLength(0);
  });

  // It really landed — visible only in the fleet-managed namespace.
  const onFleet = await fleetDb.execute(
    sql`SELECT id FROM bms.notification_channels WHERE code = ${code}`,
  );
  expect(onFleet.rows).toHaveLength(1);

  // Clean up the tenant-planted row on the fleet pool.
  await fleetDb.execute(sql`DELETE FROM bms.notification_channels WHERE code = ${code}`);
}

/**
 * The `rule_notifications` junction is isolated by its **rule's** organization,
 * not the channel's — the `0047` policy keys the `EXISTS` subquery on
 * `automation_rules.organization_id` via `rule_id` ALONE (0047:261-272),
 * deliberately ignoring the channel side because a channel carries a nullable,
 * unreliable org this item (0047:220-222).
 *
 * So a junction row for a rule in organization A:
 *   - **cannot** be written under a GUC naming any other organization B —
 *     `WITH CHECK` fails because rule A's org is not B (and A's row is itself
 *     invisible under B's GUC), so the insert raises a policy violation. This
 *     is the security claim: a NULL-org channel does not make the junction
 *     writable from the wrong tenant.
 *   - **can** be written under A's own GUC, and is then visible under A but not
 *     under B.
 *
 * `channelId` is the NULL-org channel from the fixtures; that it takes part in
 * a junction A can write proves the channel's own org never enters the check.
 */
export async function assertRuleNotificationsJunctionKeysOnRuleOrg(
  tenantDb: BmsDb,
  ruleId: string,
  ruleOrgId: string,
  otherOrgId: string,
  channelId: string,
): Promise<void> {
  // Wrong tenant: the rule belongs to A, the GUC names B → refused by WITH CHECK.
  await expect(
    withTenant(tenantDb, otherOrgId, (tx) =>
      tx.insert(ruleNotifications).values({ ruleId, channelId }),
    ),
  ).rejects.toThrow(/row-level security/i);

  // Right tenant: the GUC names the rule's own org A → the insert passes, and
  // the row is then visible under A and invisible under B.
  await withTenant(tenantDb, ruleOrgId, async (tx) => {
    await tx.insert(ruleNotifications).values({ ruleId, channelId });
    const seenByOwner = await tx.execute(
      sql`SELECT rule_id FROM bms.rule_notifications WHERE rule_id = ${ruleId} AND channel_id = ${channelId}`,
    );
    expect(seenByOwner.rows).toHaveLength(1);
  });

  await withTenant(tenantDb, otherOrgId, async (tx) => {
    const seenByOther = await tx.execute(
      sql`SELECT rule_id FROM bms.rule_notifications WHERE rule_id = ${ruleId} AND channel_id = ${channelId}`,
    );
    expect(seenByOther.rows).toHaveLength(0);
  });
}
