import { expect } from "vitest";
import pg from "pg";

import type { JwtPayload } from "@bms/shared";

import type { RtusAdminService } from "./rtus.service";

/**
 * `E7.1b` — the write-path coverage `RtusAdminService` never had.
 *
 * `rtus` gains `organization_id` + a `tenant_isolation` policy + `FORCE` in
 * migration `0047`; until then `withTenant` sets a GUC no policy reads. What
 * this proves now is the funnel logic: `create` stamps `organization_id` from
 * the RTU's location, and the wrapped lifecycle survives a real, non-owner
 * `bms_tenant` connection. An RTU never relocates (its `location_id` is not
 * updatable), so there is no cross-org move to test. The `WITH CHECK` refusal
 * proof lands with the policy in Task 4.
 */
type SvcWithFixtures = {
  svc: RtusAdminService;
  ownerPool: pg.Pool;
  organizationId: string;
  locationId: string;
  /** Every RTU this suite created, for the test file's cleanup (`F4.167`). */
  createdIds: string[];
};

export async function assertRtuWriteLifecycleSurvivesRealRls(
  ctx: SvcWithFixtures,
  jwt: JwtPayload,
): Promise<void> {
  const { svc, ownerPool, organizationId, locationId } = ctx;
  const created = await svc.create(jwt, {
    locationId,
    code: `e7.1b-rtu-${Date.now()}`,
    displayName: "E7.1b RLS RTU",
    sourceType: "catalog",
  });
  // Recorded before any later step can throw: an id that only came back at the
  // end left the RTU and its audit rows behind whenever update, deactivate or
  // reactivate failed (`F4.167`).
  ctx.createdIds.push(created.id);
  expect(created.active).toBe(true);

  // The DTO exposes `organizationCode`, not the id — assert the stamped column
  // directly on the owner connection (`rtus` has no policy yet).
  const [ownerRow] = (
    await ownerPool.query<{ organization_id: string | null }>(
      "SELECT organization_id FROM bms.rtus WHERE id = $1",
      [created.id],
    )
  ).rows;
  expect(ownerRow?.organization_id).toBe(organizationId);

  const updated = await svc.update(jwt, created.id, {
    displayName: "E7.1b RLS RTU renamed",
  });
  expect(updated.displayName).toBe("E7.1b RLS RTU renamed");

  const deactivated = await svc.deactivate(jwt, created.id);
  expect(deactivated.active).toBe(false);

  const reactivated = await svc.reactivate(jwt, created.id);
  expect(reactivated.active).toBe(true);
}

/**
 * `F4.167` — the lifecycle above writes one `master.rtu.*` audit row per step.
 * This is the positive half of the cleanup gate: without it, "no audit rows
 * remain" would also pass on a run that never wrote any.
 *
 * `ownerPool` must be `bms_fleet` (BYPASSRLS), which `requireIntegrationDb`
 * gives by default. Under a `bms_owner` pool, FORCE ROW LEVEL SECURITY on
 * `bms.audit_log` returns 0 rows with the rows present, so this check would
 * fail and the absence check below would pass falsely.
 */
export async function assertLifecycleWroteFourAuditRows(
  ownerPool: pg.Pool,
  id: string | undefined,
): Promise<void> {
  if (id === undefined) {
    throw new Error("F4.167: the lifecycle recorded no RTU id — it did not run.");
  }
  const { rows } = await ownerPool.query<{ action: string }>(
    `SELECT action FROM bms.audit_log
      WHERE entity_id = $1 AND action LIKE 'master.rtu.%'
      ORDER BY created_at`,
    [id],
  );
  expect(rows.map((r) => r.action)).toEqual([
    "master.rtu.create",
    "master.rtu.update",
    "master.rtu.deactivate",
    "master.rtu.reactivate",
  ]);
}

/** `F4.167` — the absence half: neither the RTUs nor their audit rows remain. */
export async function assertNoFixtureRowsRemain(
  ownerPool: pg.Pool,
  ids: readonly string[],
): Promise<void> {
  const { rows } = await ownerPool.query<{ audit: number; rtus: number }>(
    `SELECT (SELECT count(*)::int FROM bms.audit_log WHERE entity_id = ANY($1)) AS audit,
            (SELECT count(*)::int FROM bms.rtus WHERE id = ANY($1)) AS rtus`,
    [ids],
  );
  expect(rows[0]).toEqual({ audit: 0, rtus: 0 });
}
