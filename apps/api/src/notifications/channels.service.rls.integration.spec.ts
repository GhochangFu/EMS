import { expect } from "vitest";

import { sql } from "drizzle-orm";

import type { BmsDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import type { CountingDb } from "../testing/counting-db";
import type { ChannelsService } from "./channels.service";
import type { CreateNotificationChannelBody } from "./notifications.schema";

/**
 * `E7.1c` (ADR 0043 Amendment 5, decision 7, Task 7) — the per-service RLS
 * proof slice 1 established for the notifications write path
 * (`channels.rls.integration.spec.ts` pins the *policy*; this file pins what
 * `ChannelsService` actually does with it).
 *
 * Two claims a unit spec with a fake `BmsDb` cannot make, because both are
 * about which REAL connection a write reaches:
 *
 * 1. **`create`/`update`/`remove` route by the target channel's org scope.**
 *    An org-scoped write opens exactly one `withTenant` transaction on the
 *    tenant pool and none on the fleet pool; a global (fleet-managed) write is
 *    the opposite — `fleetDb.insert/update/delete` are plain statements, never
 *    `.transaction()`, so **both** counters must stay flat for a global write,
 *    and the only way to see the fleet pool did it is to read the row back on
 *    it. `countingDb` (`../testing/counting-db.ts`) is not blind here: unlike
 *    the read-side seam it was built for, nothing here folds a read into an
 *    existing `withTenant` — these are the transactions themselves.
 * 2. **`ChannelsService.audit()` stamps the right organization_id, not `null`
 *    by default.** This is the HAZARD Task 7 was handed: `bms_fleet` is
 *    BYPASSRLS, so a wrong (or missing) `organizationId` argument is silently
 *    admitted rather than refused by any policy — the only way to catch a
 *    regression here is to read the row back and check the value, which is
 *    exactly what this file does for both an org-scoped and a global create.
 */
export async function assertChannelWritesRouteByOrgScope(
  channels: ChannelsService,
  countedTenant: CountingDb,
  countedFleet: CountingDb,
  orgAdminJwt: JwtPayload,
  globalAdminJwt: JwtPayload,
  kind: string,
  orgScopedCode: string,
  globalCode: string,
): Promise<{ orgScopedChannelId: string; globalChannelId: string }> {
  const body = (code: string): CreateNotificationChannelBody =>
    ({ code, name: "E7.1c RLS scope proof", kind, config: {}, enabled: true }) as CreateNotificationChannelBody;

  // --- create: org-scoped opens one tenant transaction, zero fleet ---------
  const tenantBeforeCreate = countedTenant.transactions();
  const fleetBeforeCreate = countedFleet.transactions();
  const orgScoped = await channels.create(orgAdminJwt, body(orgScopedCode));
  expect(countedTenant.transactions()).toBe(tenantBeforeCreate + 1);
  expect(countedFleet.transactions()).toBe(fleetBeforeCreate);
  expect(orgScoped.id).toBeTruthy();

  // --- create: global stays off BOTH counters — fleetDb.insert is a plain
  // statement, never a .transaction(). The proof it happened at all is the
  // row landing on the fleet (BYPASSRLS) connection with a NULL org.
  const tenantBeforeGlobal = countedTenant.transactions();
  const fleetBeforeGlobal = countedFleet.transactions();
  const global = await channels.create(globalAdminJwt, body(globalCode));
  expect(countedTenant.transactions()).toBe(tenantBeforeGlobal);
  expect(countedFleet.transactions()).toBe(fleetBeforeGlobal);
  const onFleet = await countedFleet.db.execute(
    sql`SELECT organization_id FROM bms.notification_channels WHERE id = ${global.id}`,
  );
  expect((onFleet.rows[0] as { organization_id: string | null }).organization_id).toBeNull();

  // --- update mirrors create's fork -----------------------------------------
  const tenantBeforeUpdate = countedTenant.transactions();
  const updatedOrgScoped = await channels.update(orgAdminJwt, orgScoped.id, {
    name: "E7.1c RLS scope proof (renamed)",
  });
  expect(countedTenant.transactions()).toBe(tenantBeforeUpdate + 1);
  expect(updatedOrgScoped).not.toBeNull();
  expect(updatedOrgScoped?.name).toBe("E7.1c RLS scope proof (renamed)");

  // A flat FLEET counter alone proves nothing here: `fleetDb.update()` is a
  // plain statement, never `.transaction()`, so it stays flat for ANY
  // implementation, including one that routes the global branch onto the
  // tenant pool and writes nothing. The TENANT counter staying flat, plus a
  // non-null, freshly-named row read back off the return value, is what
  // actually proves the global branch reached `fleetDb`: routing it to
  // `this.db.update(...)` instead would match zero rows under FORCE (no
  // `current_org` GUC on this connection), returning `null` — an admin
  // renaming a global channel would 404 while a fleet-counter-only assertion
  // stayed green.
  const tenantBeforeGlobalUpdate = countedTenant.transactions();
  const fleetBeforeUpdate = countedFleet.transactions();
  const updatedGlobal = await channels.update(globalAdminJwt, global.id, {
    name: "E7.1c RLS scope proof (renamed, global)",
  });
  expect(countedFleet.transactions()).toBe(fleetBeforeUpdate);
  expect(countedTenant.transactions()).toBe(tenantBeforeGlobalUpdate);
  expect(updatedGlobal).not.toBeNull();
  expect(updatedGlobal?.name).toBe("E7.1c RLS scope proof (renamed, global)");

  return { orgScopedChannelId: orgScoped.id, globalChannelId: global.id };
}

/** `remove`'s half of the same fork — separated so the caller controls order
 * against its own cleanup. */
export async function assertChannelRemoveRoutesByOrgScope(
  channels: ChannelsService,
  countedTenant: CountingDb,
  countedFleet: CountingDb,
  orgAdminJwt: JwtPayload,
  globalAdminJwt: JwtPayload,
  orgScopedChannelId: string,
  globalChannelId: string,
): Promise<void> {
  const tenantBefore = countedTenant.transactions();
  const removedOrgScoped = await channels.remove(orgAdminJwt, orgScopedChannelId);
  expect(removedOrgScoped).toBe(true);
  expect(countedTenant.transactions()).toBe(tenantBefore + 1);

  const fleetBefore = countedFleet.transactions();
  const removedGlobal = await channels.remove(globalAdminJwt, globalChannelId);
  expect(removedGlobal).toBe(true);
  expect(countedFleet.transactions()).toBe(fleetBefore);
}

/**
 * The item-D hazard, closed: `ChannelsService.audit()` stamps the channel's
 * own org for an org-scoped create, and `null` **only** for a genuinely
 * fleet-managed global one. `bms-schema.ts`'s own comment on
 * `audit_log.organization_id` is the rule this proves: "a NULL on [a
 * tenant-scoped row] is a defect, not a platform event." Both directions are
 * asserted — a test that only checks the org-scoped branch would pass just as
 * well if the code hard-coded `null`.
 */
export async function assertChannelAuditStampsOrgCorrectly(
  channels: ChannelsService,
  fleetDb: BmsDb,
  orgAdminJwt: JwtPayload,
  globalAdminJwt: JwtPayload,
  orgAdminOrgId: string,
  kind: string,
  orgScopedCode: string,
  globalCode: string,
): Promise<{ orgScopedChannelId: string; globalChannelId: string }> {
  const orgScoped = await channels.create(orgAdminJwt, {
    code: orgScopedCode,
    name: "E7.1c RLS audit proof",
    kind,
    config: {},
    enabled: true,
  } as CreateNotificationChannelBody);
  const orgAudit = await fleetDb.execute(
    sql`SELECT organization_id FROM bms.audit_log
         WHERE entity_type = 'notification_channel' AND entity_id = ${orgScoped.id}
           AND action = 'notification_channel_create'`,
  );
  expect((orgAudit.rows[0] as { organization_id: string | null } | undefined)?.organization_id).toBe(
    orgAdminOrgId,
  );

  const global = await channels.create(globalAdminJwt, {
    code: globalCode,
    name: "E7.1c RLS audit proof (global)",
    kind,
    config: {},
    enabled: true,
  } as CreateNotificationChannelBody);
  const globalAudit = await fleetDb.execute(
    sql`SELECT organization_id FROM bms.audit_log
         WHERE entity_type = 'notification_channel' AND entity_id = ${global.id}
           AND action = 'notification_channel_create'`,
  );
  expect(
    (globalAudit.rows[0] as { organization_id: string | null } | undefined)?.organization_id,
  ).toBeNull();

  return { orgScopedChannelId: orgScoped.id, globalChannelId: global.id };
}

/**
 * REAL BUG, closed: `setRuleChannels` resolves the RULE's org and opens
 * `withTenant` on it, then used to insert `{ruleId, channelId}` for every
 * supplied id with no check that each channel belongs to that org.
 * `rule_notifications`'s own policy (`0047`) tests
 * `automation_rules.organization_id` alone — deliberate when it was written,
 * because channel org was nullable then — so nothing in the database catches
 * a cross-org wire-up; `0048` made channel org a real key and nothing was
 * updated to enforce the pairing until this fix.
 *
 * Both directions are asserted — a hard-coded `throw` would pass only the
 * refusal, and the pre-fix code would pass only the acceptance.
 */
export async function assertSetRuleChannelsRefusesCrossOrgChannel(
  channels: ChannelsService,
  ruleIdInOrgA: string,
  channelIdInOrgB: string,
  globalChannelId: string,
  actor: Pick<JwtPayload, "sub" | "email">,
): Promise<void> {
  await expect(
    channels.setRuleChannels(ruleIdInOrgA, [channelIdInOrgB], actor),
  ).rejects.toThrow(/different organization/i);

  // Decision 7: a fleet-managed global channel stays shareable — the refusal
  // above is about ANOTHER organization's channel, not about a NULL-org one.
  const wired = await channels.setRuleChannels(ruleIdInOrgA, [globalChannelId], actor);
  expect(wired).toEqual([globalChannelId]);
}

/**
 * OWNER RULING (2026-08-27), closed: `list()`'s and `listDeliveries()`'s read
 * gate must equal `canManageNotificationChannel`'s write gate. Before this
 * fix, `writableOrganizationIds` resolved a `location_admin` to its whole
 * home organization (`locationDerivedOrganizationIds`), so both reads
 * disclosed channel `config` and delivery/error metadata that `loadById` then
 * refused with a 403 on the very same row — a read that already leaked,
 * gated by a check that came too late.
 *
 * Neither read had ANY coverage before this: not a unit test, not an RLS
 * integration test, no HTTP request (`notifications.controller.spec.ts`
 * stubs `listDeliveries` and never varies the organization). Seeds a channel
 * and a delivery in each of two REAL organizations and asserts a strict
 * subset for `organization_admin` — never merely non-empty — everything for
 * `admin`, and exactly nothing for `location_admin`, which is the ruling's
 * own proof.
 */
export async function assertChannelAndDeliveryReadsAreOrgScoped(
  channels: ChannelsService,
  orgAdminJwt: JwtPayload,
  globalAdminJwt: JwtPayload,
  locationAdminJwt: JwtPayload,
  channelAId: string,
  channelBId: string,
): Promise<void> {
  const orgAdminChannelIds = (await channels.list(orgAdminJwt)).map((c) => c.id);
  expect(orgAdminChannelIds, "organization_admin sees its own org's channel").toContain(
    channelAId,
  );
  expect(
    orgAdminChannelIds,
    "organization_admin does NOT see the other org's channel — a strict subset, not merely non-empty",
  ).not.toContain(channelBId);

  const adminChannelIds = (await channels.list(globalAdminJwt)).map((c) => c.id);
  expect(adminChannelIds, "admin sees both organizations' channels").toEqual(
    expect.arrayContaining([channelAId, channelBId]),
  );

  expect(
    await channels.list(locationAdminJwt),
    "location_admin gets [] from list() — not a location-filtered view, the read gate is the write gate",
  ).toEqual([]);

  const orgAdminDeliveryChannelIds = (
    await channels.listDeliveries(orgAdminJwt, { limit: 500 })
  ).items.map((d) => d.channelId);
  expect(orgAdminDeliveryChannelIds, "organization_admin sees its own org's delivery").toContain(
    channelAId,
  );
  expect(
    orgAdminDeliveryChannelIds,
    "organization_admin does NOT see the other org's delivery",
  ).not.toContain(channelBId);

  const adminDeliveryChannelIds = (
    await channels.listDeliveries(globalAdminJwt, { limit: 500 })
  ).items.map((d) => d.channelId);
  expect(adminDeliveryChannelIds, "admin sees both organizations' deliveries").toEqual(
    expect.arrayContaining([channelAId, channelBId]),
  );

  expect(
    await channels.listDeliveries(locationAdminJwt, { limit: 500 }),
    "location_admin gets { items: [] } from listDeliveries() — same ruling",
  ).toEqual({ items: [] });
}

/**
 * `E7.1g` (ADR 0043 Amendment 6) — a fleet-managed channel's failure detail is
 * redacted in a tenant's ledger; its code is not.
 *
 * `listDeliveries` filters on `notification_deliveries.organization_id` alone.
 * The joined channel's OWN organization was never tested, so a delivery that
 * decision 7 legitimately routes through a `NULL`-org channel — a global admin
 * wires org A's rule to fleet channel `ops-pager`, `record()` stamps the
 * RULE's organization — came back to org A's `organization_admin` carrying
 * whatever `webhook-guard.ts` wrote into `error`, including a resolved
 * internal hostname.
 *
 * All four assertions are load-bearing, and the two positive ones are what
 * make this a gate rather than a smoke test:
 *
 * 1. the tenant's view of the FLEET row has `error === null`;
 * 2. the tenant's view of the fleet row still has `channelCode` — Amendment 6
 *    rejected withholding both, because ADR 0041 decision 10 requires a failed
 *    delivery to stay identifiable;
 * 3. the tenant's view of its OWN channel's row has `error` intact — this is
 *    what fails an over-broad redaction that blanks every non-admin row;
 * 4. `admin`'s view of the fleet row has `error` intact — "a global admin's
 *    view is unchanged".
 *
 * Both fixture deliveries carry a NON-NULL `error` on purpose. A delivery
 * seeded with `status: 'sent'` and a NULL error passes assertion 1 vacuously
 * and passes the unfixed code too.
 */
export async function assertFleetChannelErrorIsRedactedForATenant(
  channels: ChannelsService,
  orgAdminJwt: JwtPayload,
  globalAdminJwt: JwtPayload,
  fleetDelivery: { readonly id: string; readonly channelCode: string; readonly error: string },
  orgScopedDelivery: { readonly id: string; readonly error: string },
): Promise<void> {
  const tenantItems = (await channels.listDeliveries(orgAdminJwt, { limit: 500 })).items;

  const tenantFleetRow = tenantItems.find((d) => d.id === fleetDelivery.id);
  expect(
    tenantFleetRow,
    "organization_admin sees the delivery its own rule made through the fleet channel — decision 7 keeps a global shareable, so the ROW is in scope",
  ).toBeDefined();
  expect(
    tenantFleetRow?.error,
    "the fleet channel's failure detail is blanked for a tenant — null, not '' and not a dropped column",
  ).toBeNull();
  expect(
    tenantFleetRow?.channelCode,
    "the fleet channel's CODE survives — withholding both was considered and rejected (ADR 0041 decision 10)",
  ).toBe(fleetDelivery.channelCode);

  const tenantOwnRow = tenantItems.find((d) => d.id === orgScopedDelivery.id);
  expect(tenantOwnRow, "organization_admin sees its own org-scoped channel's delivery").toBeDefined();
  expect(
    tenantOwnRow?.error,
    "a tenant's own channel's failure detail is UNTOUCHED — only a NULL-org channel is redacted",
  ).toBe(orgScopedDelivery.error);

  const adminFleetRow = (await channels.listDeliveries(globalAdminJwt, { limit: 500 })).items.find(
    (d) => d.id === fleetDelivery.id,
  );
  expect(adminFleetRow, "admin sees the fleet channel's delivery").toBeDefined();
  expect(
    adminFleetRow?.error,
    "a global admin's view is unchanged — the redaction is keyed on the CALLER's role, not on the row",
  ).toBe(fleetDelivery.error);
}
