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
 * `E7.1c` (ADR 0043 Amendment 5, ruled 2026-08-27) — this function used to be
 * `assertTenantCanCreateButNotSeeNullOrgChannel` and documented a defect: the
 * `0047` `WITH CHECK` admitted `organization_id IS NULL` for **every** role, so
 * a tenant connection could plant a NULL-org channel it then could not see
 * (partial write-containment — read/modify of an *existing* NULL-org row was
 * closed, but *creating* a fresh one was not). That was measured, not assumed:
 * a plain INSERT with no `organization_id` succeeded on the tenant pool, and an
 * immediate `SELECT` on the same connection returned zero rows.
 *
 * **Migration `0048` closes that gap** by splitting the shared policy: a
 * strict `tenant_isolation` (every role, no NULL disjunct) plus a second,
 * permissive `tenant_isolation_fleet_null` policy scoped `TO bms_fleet` alone.
 * Permissive policies OR together, so only `bms_fleet` may still write a
 * NULL-org row; `bms_tenant` is refused outright by `WITH CHECK`. This
 * function is renamed to match: it now pins the **refusal**, not the create-
 * then-hide sequence. Until `0048` lands the INSERT below still succeeds (the
 * pre-`0048` behaviour above), so the first assertion is red on purpose — see
 * the plan's `docs/plans/e7.1c-slice-2-channel-org-scope.md` §6 Task 2.
 *
 * The positive control (organization-scoped insert, visible to its own
 * creator) is new in this rewrite: without it a broken grant — `bms_tenant`
 * refused for *any* insert, not specifically a NULL-org one — would make the
 * refusal assertion pass for the wrong reason.
 *
 * **No RETURNING, on any of the three probes.** RETURNING reads the new row
 * back under the strict USING, which a NULL-org row fails regardless of
 * whether the INSERT itself was admitted or refused — so a RETURNING probe
 * cannot distinguish "the write was refused" from "the write succeeded but the
 * read-back failed", and the test would pass for the wrong reason either way.
 * This is the standing lesson recorded in Amendment 5's consequences; every
 * probe here stays write-only (or, for the positive control, reads back with a
 * separate plain SELECT rather than a RETURNING clause).
 */
export async function assertTenantCannotCreateNullOrgChannel(
  tenantDb: BmsDb,
  fleetDb: BmsDb,
  tenantOrgId: string,
  nullOrgCode: string,
  orgScopedCode: string,
  kind: string,
): Promise<void> {
  // (1) A plain NULL-org INSERT now rejects outright — no RETURNING, so the
  // rejection can only be the WITH CHECK refusal, not a read-back failure.
  // Isolated in its own withTenant/transaction: once 0048 lands this statement
  // aborts the transaction, so it must not share one with the positive control.
  try {
    await expect(
      withTenant(tenantDb, tenantOrgId, (tx) =>
        tx.execute(
          sql`INSERT INTO bms.notification_channels (code, name, kind, enabled)
              VALUES (${nullOrgCode}, 'E7.1c tenant null-org attempt', ${kind}, true)`,
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  } finally {
    // Best-effort, unconditional cleanup — not a second read of the probe's
    // own row. Pre-0048 this insert currently succeeds (the defect this
    // assertion pins), and the row is invisible even to its own tenant
    // creator under the strict USING, so only bms_fleet (BYPASSRLS) can see
    // and remove it. A plain filtered DELETE afterward is not the RETURNING
    // read-back the "no RETURNING" rule forbids — it asserts nothing about
    // admission vs refusal, it only prevents an orphaned row.
    await fleetDb.execute(sql`DELETE FROM bms.notification_channels WHERE code = ${nullOrgCode}`);
  }

  // (2) Positive control, on a fresh transaction: an org-scoped insert from the
  // same tenant succeeds and is visible to its own creator. Without this, a
  // broken/over-narrow grant would make (1) pass vacuously (refused for every
  // insert, not specifically the NULL-org one).
  await withTenant(tenantDb, tenantOrgId, async (tx) => {
    await tx.execute(
      sql`INSERT INTO bms.notification_channels (code, name, kind, enabled, organization_id)
          VALUES (${orgScopedCode}, 'E7.1c tenant org-scoped control', ${kind}, true, ${tenantOrgId})`,
    );
    const seen = await tx.execute(
      sql`SELECT id FROM bms.notification_channels WHERE code = ${orgScopedCode}`,
    );
    expect(seen.rows).toHaveLength(1);
    // Cleanup inside the same transaction — no row escapes to afterAll.
    await tx.execute(sql`DELETE FROM bms.notification_channels WHERE code = ${orgScopedCode}`);
  });

  // (3) `bms_fleet` (decision 7's fleet-managed global) may still insert a
  // NULL-org channel, and the row is visible on the fleet connection.
  await fleetDb.execute(
    sql`INSERT INTO bms.notification_channels (code, name, kind, enabled)
        VALUES (${nullOrgCode}, 'E7.1c fleet null-org channel', ${kind}, true)`,
  );
  const onFleet = await fleetDb.execute(
    sql`SELECT id FROM bms.notification_channels WHERE code = ${nullOrgCode}`,
  );
  expect(onFleet.rows).toHaveLength(1);

  // Clean up the fleet-planted row.
  await fleetDb.execute(sql`DELETE FROM bms.notification_channels WHERE code = ${nullOrgCode}`);
}

/**
 * `E7.1c` (ADR 0043 Amendment 5) — the `notification_deliveries` half of the
 * ruling: the `0048` migration removes the `organization_id IS NULL` branch
 * outright (no second, fleet-scoped policy — unlike `users`/
 * `notification_channels`) **and** adds `SET NOT NULL` to the column. Both
 * roles must be shown refused, but for different reasons:
 *
 * - `bms_tenant` is refused by `WITH CHECK` (the NULL disjunct is gone).
 * - `bms_fleet` carries BYPASSRLS, so no policy ever applies to it — its
 *   refusal can only be the `NOT NULL` column constraint. This is the trap the
 *   plan calls out explicitly: do not read `bms_fleet`'s refusal as proof the
 *   policy narrowed, because the policy never bound it in the first place.
 *
 * Until `0048` lands the column stays nullable and the shared `WITH CHECK`
 * still admits `organization_id IS NULL` for both roles, so both inserts
 * below currently succeed — this assertion is red on purpose.
 *
 * No RETURNING: same reasoning as `assertTenantCannotCreateNullOrgChannel`.
 */
export async function assertNullOrgDeliveryIsRefusedForEveryRole(
  tenantDb: BmsDb,
  fleetDb: BmsDb,
  tenantOrgId: string,
  channelId: string,
): Promise<void> {
  // Scoped by channel_id, not a code the probe just inserted and read back —
  // this is best-effort cleanup, not the RETURNING read-back the "no
  // RETURNING" rule forbids. `channelId` is this run's own fixture channel, so
  // no other test's rows can be caught by the filter.
  try {
    await expect(
      withTenant(tenantDb, tenantOrgId, (tx) =>
        tx.execute(
          sql`INSERT INTO bms.notification_deliveries (channel_id, status)
              VALUES (${channelId}, 'sent')`,
        ),
      ),
      "bms_tenant must not be able to write a NULL-org delivery",
    ).rejects.toThrow(/row-level security|not-null constraint/i);
  } finally {
    await fleetDb.execute(
      sql`DELETE FROM bms.notification_deliveries WHERE channel_id = ${channelId} AND organization_id IS NULL`,
    );
  }

  try {
    await expect(
      fleetDb.execute(
        sql`INSERT INTO bms.notification_deliveries (channel_id, status)
            VALUES (${channelId}, 'sent')`,
      ),
      "bms_fleet carries BYPASSRLS, so its refusal can only be the NOT NULL column, never the policy",
    ).rejects.toThrow(/not-null constraint/i);
  } finally {
    await fleetDb.execute(
      sql`DELETE FROM bms.notification_deliveries WHERE channel_id = ${channelId} AND organization_id IS NULL`,
    );
  }
}

/**
 * `E7.1c` (ADR 0043 Amendment 5) — the `bms.users` half of Blocker-adjacent
 * ground truth: **this assertion does not depend on `0048` at all.**
 * `0039:106` (`REVOKE INSERT, DELETE ON bms.users FROM bms_tenant, bms_fleet`)
 * already removed `INSERT` from both pool roles, unconditionally, before
 * `E7.1b` even existed. So a `bms_tenant` insert of a NULL-org `bms.users` row
 * is refused **by the grant**, not by `tenant_isolation`'s `WITH CHECK` — the
 * policy never gets a chance to run. This is pinned here anyway because
 * Amendment 5 is what makes `bms.users`' NULL branch `TO bms_fleet`-scoped in
 * `0048`, and a reader of that migration could otherwise assume the grant *and*
 * the policy jointly guard this path; only the grant does. No RETURNING: same
 * reasoning as the channel probe above.
 */
export async function assertNullOrgUserInsertIsRefusedForTenant(
  tenantDb: BmsDb,
  tenantOrgId: string,
  email: string,
): Promise<void> {
  await expect(
    withTenant(tenantDb, tenantOrgId, (tx) =>
      tx.execute(
        sql`INSERT INTO bms.users (email, password_hash, display_name, role)
            VALUES (${email}, 'x', 'E7.1c null-org user probe', 'viewer')`,
      ),
    ),
    "bms_tenant has no INSERT grant on bms.users at all (0039:106) — this is not a policy check",
  ).rejects.toThrow(/permission denied/i);
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
