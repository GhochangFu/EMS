import { expect } from "vitest";
import pg from "pg";

import type { JwtPayload } from "@bms/shared";

import type { AlarmsService } from "./alarms.service";

/**
 * `E7.1b` — the read-path isolation proof `AlarmsService` never had. The service
 * routes its `list`/`resolveAlarmOrg` reads onto `fleetDb` and trusts the
 * caller's `assetIds` `WHERE` filter as the isolation control (ADR 0043
 * Amendment 3 decision 3 — `readableAssetIds` is a cross-org union, so a single
 * tenant GUC cannot serve the read and the per-org loop was rejected). That
 * control was asserted by a comment and by nothing else: `codegraph` reported
 * `AlarmsService` with no covering tests, while `work-orders`/`maintenance`
 * each carry their own `.rls.integration` pair.
 *
 * Three things this proves against real, non-owner roles that the owner
 * connection would pass regardless:
 *
 *  1. `assertAlarmListScopedByAssetIds` — the `assetIds` filter, not a GUC, is
 *     what isolates: a caller scoped to org A's asset sees org A's alarm and not
 *     org B's, and the SAME fleet read scoped to org B's asset returns org B's
 *     alarm — the cross-org resolution a single-org GUC could not do.
 *  2. `assertAlarmListGoesDarkOnBareTenantPool` — why the read must be on fleet:
 *     on the bare tenant pool with no `SET LOCAL`, the 0047 FORCE policy returns
 *     zero rows, so the list would be silently empty for every caller. This is a
 *     necessity proof; the `@Inject` token itself is gated by
 *     `database/fleet-read-wiring.test.ts` (this file injects its pools).
 *  3. `assertAcknowledgeRefusesForeignAlarmButAllowsInScope` — `resolveAlarmOrg`
 *     refuses a foreign alarm behind the caller's scope with the same
 *     non-disclosure wording a nonexistent id gets, and the in-scope
 *     acknowledge runs under org A's GUC, resolves the actor on `fleetDb`
 *     (`acknowledged_by`, not NULL), and leaves the org intact.
 */
export type AlarmsRlsFixtures = {
  /** Fleet-backed service: `db` = `bms_tenant`, `fleetDb` = `bms_fleet`. */
  svc: AlarmsService;
  /** `bms_fleet` (BYPASSRLS) — verification reads that must span both orgs. */
  ownerPool: pg.Pool;
  /** Org A — the acting user's organization. */
  organizationId: string;
  /** An asset in org A; the caller's `assetIds` scope. */
  inScopeAssetId: string;
  /** An alarm on `inScopeAssetId`. */
  inScopeAlarmId: string;
  /** An asset in org B, outside the caller's scope. */
  foreignAssetId: string;
  /** An alarm on `foreignAssetId`. */
  foreignAlarmId: string;
  /** The acting user's `bms.users.id` — `acknowledged_by` must resolve to it. */
  actorUserId: string;
};

async function alarmRow(
  pool: pg.Pool,
  id: string,
): Promise<
  { organization_id: string; acknowledged_at: Date | null; acknowledged_by: string | null } | undefined
> {
  const { rows } = await pool.query<{
    organization_id: string;
    acknowledged_at: Date | null;
    acknowledged_by: string | null;
  }>(
    "SELECT organization_id, acknowledged_at, acknowledged_by FROM bms.alarms WHERE id = $1",
    [id],
  );
  return rows[0];
}

/**
 * The `assetIds` filter isolates, and it isolates by resolving across
 * organizations — not by a tenant GUC. Org A's caller sees only org A's alarm;
 * the same fleet read scoped to org B's asset returns org B's alarm.
 */
export async function assertAlarmListScopedByAssetIds(ctx: AlarmsRlsFixtures): Promise<void> {
  const { svc, inScopeAssetId, inScopeAlarmId, foreignAssetId, foreignAlarmId } = ctx;

  const scoped = await svc.list({ limit: 100, assetIds: [inScopeAssetId] });
  const scopedIds = scoped.items.map((i) => i.id);
  expect(scopedIds, "the in-scope alarm is listed").toContain(inScopeAlarmId);
  expect(
    scopedIds,
    "a foreign-org alarm is filtered out by the assetIds WHERE clause",
  ).not.toContain(foreignAlarmId);

  const foreignScoped = await svc.list({ limit: 100, assetIds: [foreignAssetId] });
  const foreignIds = foreignScoped.items.map((i) => i.id);
  expect(
    foreignIds,
    "the fleet read resolves the other org's alarm behind its own assetIds",
  ).toContain(foreignAlarmId);
  expect(foreignIds).not.toContain(inScopeAlarmId);
}

/**
 * Why the read must be on fleet. Had `list` stayed on the bare tenant pool (no
 * `SET LOCAL app.current_organization`), the 0047 FORCE policy on
 * `alarms`/`assets` would return zero rows and the alarm list would be silently
 * empty for every caller — the "engine goes dark" failure the `fleetDb` routing
 * prevents. A tenant-pool-backed service must see nothing here.
 *
 * This is a necessity proof, not a wiring guard: it injects its own pools, so it
 * cannot catch a revert of the `@Inject(FLEET_DRIZZLE)` token — that is gated by
 * `database/fleet-read-wiring.test.ts`.
 */
export async function assertAlarmListGoesDarkOnBareTenantPool(
  tenantBackedSvc: AlarmsService,
  inScopeAssetId: string,
): Promise<void> {
  const dark = await tenantBackedSvc.list({ limit: 100, assetIds: [inScopeAssetId] });
  expect(
    dark.items,
    "a bare tenant pool with no GUC sees no alarms under 0047 FORCE",
  ).toHaveLength(0);
}

/**
 * `resolveAlarmOrg` refuses a foreign alarm behind the caller's scope, and the
 * in-scope acknowledge writes under org A's GUC with the fleet-resolved actor.
 */
export async function assertAcknowledgeRefusesForeignAlarmButAllowsInScope(
  ctx: AlarmsRlsFixtures,
  actor: Pick<JwtPayload, "sub" | "email">,
): Promise<void> {
  const { svc, ownerPool, organizationId, inScopeAlarmId, foreignAlarmId, inScopeAssetId, actorUserId } =
    ctx;

  await expect(
    svc.acknowledge(foreignAlarmId, actor, "must not acknowledge across orgs", [inScopeAssetId]),
  ).rejects.toThrow(/not found or outside your access scope/i);
  const foreign = await alarmRow(ownerPool, foreignAlarmId);
  expect(foreign?.acknowledged_at, "the foreign alarm stays unacknowledged").toBeNull();

  const acked = await svc.acknowledge(inScopeAlarmId, actor, "acknowledged in scope", [
    inScopeAssetId,
  ]);
  expect(acked.acknowledgedAt).not.toBeNull();

  const row = await alarmRow(ownerPool, inScopeAlarmId);
  expect(row?.acknowledged_at, "the in-scope alarm is acknowledged").not.toBeNull();
  expect(row?.acknowledged_by, "the actor resolves under bms_fleet, not NULL").toBe(actorUserId);
  expect(row?.organization_id, "acknowledge leaves the org untouched").toBe(organizationId);
}
