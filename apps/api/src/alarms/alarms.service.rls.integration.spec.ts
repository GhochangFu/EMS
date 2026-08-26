import { expect } from "vitest";
import pg from "pg";

import type { BmsDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import { countingDb } from "../testing/counting-db";
import type { AlarmsService } from "./alarms.service";

/**
 * `E7.1b` (ADR 0043 decisions 1+3) — the read-path isolation proof
 * `AlarmsService` never had. `list` reads `alarms` (a decision-1 table) through
 * `withReadScope`: a single-organization actor is served inside `withTenant`
 * (the 0047 FORCE policy scopes the read — decision 1), an admin or
 * multi-organization actor falls back to `fleetDb` at run time (decisions 2/3),
 * where the `assetIds` `WHERE` filter is the isolation control. That routing was
 * asserted by a comment and by nothing else before this pair.
 *
 * Four things this proves against real, non-owner roles that the owner
 * connection would pass regardless:
 *
 *  1. `assertAlarmListScopedByAssetIds` — a single-org caller scoped to org A's
 *     asset sees org A's alarm and not org B's; the same read scoped to org B's
 *     asset returns org B's alarm. Each runs under its own org's GUC.
 *  2. `assertAlarmListReturnsBothOrgsForTwoOrgActor` — decision 3: ONE list call
 *     whose `assetIds` span two organizations returns BOTH orgs' alarms. A
 *     wrongful `withTenant(one org)` would silently drop the other org's rows —
 *     which is why the per-org loop was rejected and the fallback is fleet.
 *  3. `assertSingleOrgListRunsOnTenantTransaction` — the mechanism seam: a
 *     single-org list opens exactly one **tenant** transaction and zero fleet
 *     transactions (`withReadScope` → `withTenant`; org resolution uses
 *     `fleetDb.select`, not `.transaction`). A revert to `this.fleetDb.select`
 *     in `list` drops the tenant count to zero. This is what gates the read pool
 *     — `database/fleet-read-wiring.test.ts` no longer does, now that `list`
 *     injects both tokens.
 *  4. `assertAcknowledgeRefusesForeignAlarmButAllowsInScope` — `resolveAlarmOrg`
 *     refuses a foreign alarm behind the caller's scope with the same
 *     non-disclosure wording a nonexistent id gets, and the in-scope
 *     acknowledge runs under org A's GUC, resolves the actor on `fleetDb`
 *     (`acknowledged_by`, not NULL), and leaves the org intact.
 */
export type AlarmsRlsFixtures = {
  /** Fleet-backed service: `db` = `bms_tenant`, `fleetDb` = `bms_fleet`. */
  svc: AlarmsService;
  /** The real `bms_tenant` handle — for building a counting-wrapped service. */
  tenantDb: BmsDb;
  /** The real `bms_fleet` handle — for building a counting-wrapped service. */
  fleetDb: BmsDb;
  /** Rebuilds the service under test with swapped db handles (counter probe). */
  makeService: (tenantDb: BmsDb, fleetDb: BmsDb) => AlarmsService;
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
 * Decision 3: a single list call whose `assetIds` span two organizations returns
 * BOTH orgs' alarms — the run-time fleet fallback resolves across organizations.
 * The mandated test: a `withTenant(one org)` regression would drop the other
 * org's rows, so this fails exactly when the multi-org fallback is wrong.
 */
export async function assertAlarmListReturnsBothOrgsForTwoOrgActor(
  ctx: AlarmsRlsFixtures,
): Promise<void> {
  const { svc, inScopeAssetId, inScopeAlarmId, foreignAssetId, foreignAlarmId } = ctx;
  const both = await svc.list({ limit: 100, assetIds: [inScopeAssetId, foreignAssetId] });
  const ids = both.items.map((i) => i.id);
  expect(ids, "org A's alarm is returned on the two-org path").toContain(inScopeAlarmId);
  expect(ids, "org B's alarm is returned on the same read (fleet fallback)").toContain(
    foreignAlarmId,
  );
}

/**
 * The mechanism seam. A single-organization list runs through `withReadScope` →
 * `withTenant`, so it opens exactly one **tenant** transaction and zero fleet
 * transactions (org resolution uses `fleetDb.select`, not `.transaction`). A
 * revert of `list` back to `this.fleetDb.select(...)` drops the tenant count to
 * zero — this is what now gates the read pool.
 */
export async function assertSingleOrgListRunsOnTenantTransaction(
  ctx: AlarmsRlsFixtures,
): Promise<void> {
  const tenant = countingDb(ctx.tenantDb);
  const fleet = countingDb(ctx.fleetDb);
  const svc = ctx.makeService(tenant.db, fleet.db);
  await svc.list({ limit: 100, assetIds: [ctx.inScopeAssetId] });
  expect(tenant.transactions(), "a single-org list opens one tenant transaction").toBe(1);
  expect(fleet.transactions(), "a single-org list opens no fleet transaction").toBe(0);
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
