import { InternalServerErrorException } from "@nestjs/common";
import type pg from "pg";
import { expect } from "vitest";

import type { JwtPayload } from "@bms/shared";

import { RTU_ORG_MISMATCH_MESSAGE, type RtusAdminService } from "./rtus.service";

/**
 * `F4.138` — the three RTU write paths refuse a drifted RTU under the real
 * `bms_tenant` policy, and nothing lands. Assertions live here (ADR 0014); the
 * sibling `.test.ts` owns the database lifecycle.
 *
 * **Why the real database.** A drifted RTU carries another organization's id in
 * `rtus.organization_id` while its location belongs to the caller's. Under that
 * foreign GUC the `tenant_isolation` policy (`0047`) *admits* the RTU update,
 * the asset update and the audit insert — every row carries the GUC's org. That
 * is the defect, and a fake transaction cannot show that the writes would have
 * passed. The drift itself cannot be made through the service (`create` stamps
 * the location's org), so the fixture writes it as `bms_fleet`: the state a
 * migration, an import or a future bug could leave.
 *
 * **One RTU per case.** Each case makes its own drifted RTU, calls the path, and
 * reads one fact back, so no case depends on another having run. The refusal
 * cases hold that the call was made and refused; the positive control holds that
 * the same RTU, once repaired, is written — so a service refusing every write
 * cannot pass the file.
 */

export type WritePath = "update" | "deactivate" | "reactivate";

export type TenantAgreementCtx = {
  readonly svc: RtusAdminService;
  readonly jwt: JwtPayload;
  /** `bms_fleet` (BYPASSRLS) — fixture rows and read-back only. */
  readonly fixturePool: pg.Pool;
  /** The caller's organization and one of its active locations. */
  readonly organizationId: string;
  readonly locationId: string;
  /** Another organization, and one of its active locations. */
  readonly foreignOrganizationId: string;
  readonly foreignLocationId: string;
  readonly createdRtuIds: string[];
  readonly createdAssetIds: string[];
};

let fixtureSeq = 0;

function fixtureTag(): string {
  return `f4-138-${Date.now()}-${fixtureSeq++}`;
}

const DRIFTED_DISPLAY_NAME = "F4.138 drifted";

/**
 * An RTU at the caller's location stamped with the **foreign** organization.
 * `source_type` is `mqtt` and ingest is off, so an `update` enabling ingest
 * would move its assets onto `mqtt` if it were let through.
 */
async function insertDriftedRtu(
  ctx: TenantAgreementCtx,
  start: { active: boolean },
): Promise<string> {
  const res = await ctx.fixturePool.query<{ id: string }>(
    `INSERT INTO bms.rtus
       (organization_id, location_id, code, display_name, source_type, ingest_enabled, active)
     VALUES ($1, $2, $3, $4, 'mqtt', false, $5)
     RETURNING id`,
    [ctx.foreignOrganizationId, ctx.locationId, fixtureTag(), DRIFTED_DISPLAY_NAME, start.active],
  );
  const id = res.rows[0]?.id;
  if (id === undefined) {
    throw new Error("F4.138: drifted RTU insert returned no id");
  }
  ctx.createdRtuIds.push(id);
  return id;
}

/**
 * An asset on the drifted RTU, in the **foreign** organization. It must be
 * foreign: without the guard, `update` moves assets `WHERE rtu_id = id AND
 * organization_id = <the GUC's org>`, and the GUC is the foreign one — an asset
 * of the caller's organization would stay put either way, and "unchanged" would
 * pass with the guard deleted.
 */
async function attachForeignOrgAsset(ctx: TenantAgreementCtx, rtuId: string): Promise<string> {
  const tag = fixtureTag();
  // `assets_code_charset_check` (migration 0070) is `^[A-Za-z0-9_-]+$`.
  const res = await ctx.fixturePool.query<{ id: string }>(
    `INSERT INTO bms.assets
       (organization_id, code, name, site_name, location_id, rtu_id, domain, meta)
     VALUES ($1, $2, $3, 'F4.138 site', $4, $5, 'electrical',
             '{"telemetrySource":"catalog"}'::jsonb)
     RETURNING id`,
    [ctx.foreignOrganizationId, `${tag}-asset`, `F4.138 asset ${tag}`, ctx.foreignLocationId, rtuId],
  );
  const id = res.rows[0]?.id;
  if (id === undefined) {
    throw new Error("F4.138: foreign-organization asset insert returned no id");
  }
  ctx.createdAssetIds.push(id);
  return id;
}

/** Calls the path; returns what it rejected with, or `undefined` if it resolved. */
async function attempt(
  ctx: TenantAgreementCtx,
  path: WritePath,
  rtuId: string,
): Promise<unknown> {
  try {
    switch (path) {
      case "update":
        await ctx.svc.update(ctx.jwt, rtuId, {
          displayName: "F4.138 renamed",
          ingestEnabled: true,
        });
        break;
      case "deactivate":
        await ctx.svc.deactivate(ctx.jwt, rtuId);
        break;
      case "reactivate":
        await ctx.svc.reactivate(ctx.jwt, rtuId);
        break;
    }
  } catch (error) {
    return error;
  }
  return undefined;
}

async function readRtu(
  ctx: TenantAgreementCtx,
  rtuId: string,
): Promise<{ display_name: string; ingest_enabled: boolean; active: boolean }> {
  const res = await ctx.fixturePool.query<{
    display_name: string;
    ingest_enabled: boolean;
    active: boolean;
  }>("SELECT display_name, ingest_enabled, active FROM bms.rtus WHERE id = $1", [rtuId]);
  const row = res.rows[0];
  if (row === undefined) {
    throw new Error(`F4.138: no bms.rtus row for ${rtuId}`);
  }
  return row;
}

/** Counted as `bms_fleet`: under FORCE RLS `bms_owner` reads 0 with rows present. */
async function auditRowCount(ctx: TenantAgreementCtx, rtuId: string): Promise<number> {
  const res = await ctx.fixturePool.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM bms.audit_log WHERE entity_id = $1",
    [rtuId],
  );
  return res.rows[0]?.n ?? -1;
}

/** The path refuses a drifted RTU with the ruled 500 and message. */
export async function assertPathRefusesADriftedRtu(
  ctx: TenantAgreementCtx,
  path: WritePath,
): Promise<void> {
  const rtuId = await insertDriftedRtu(ctx, { active: path !== "reactivate" });
  const error = await attempt(ctx, path, rtuId);
  expect(error).toBeInstanceOf(InternalServerErrorException);
  expect((error as InternalServerErrorException).message).toBe(RTU_ORG_MISMATCH_MESSAGE);
}

/** The path writes no audit row for a drifted RTU. */
export async function assertPathWritesNoAuditRow(
  ctx: TenantAgreementCtx,
  path: WritePath,
): Promise<void> {
  const rtuId = await insertDriftedRtu(ctx, { active: path !== "reactivate" });
  await attempt(ctx, path, rtuId);
  expect(await auditRowCount(ctx, rtuId)).toBe(0);
}

/** `update` leaves a drifted RTU's `display_name` as it was. */
export async function assertUpdateLeavesTheDisplayName(ctx: TenantAgreementCtx): Promise<void> {
  const rtuId = await insertDriftedRtu(ctx, { active: true });
  await attempt(ctx, "update", rtuId);
  expect((await readRtu(ctx, rtuId)).display_name).toBe(DRIFTED_DISPLAY_NAME);
}

/** `update` leaves a drifted RTU's ingest switch off. */
export async function assertUpdateLeavesIngestOff(ctx: TenantAgreementCtx): Promise<void> {
  const rtuId = await insertDriftedRtu(ctx, { active: true });
  await attempt(ctx, "update", rtuId);
  expect((await readRtu(ctx, rtuId)).ingest_enabled).toBe(false);
}

/** `update` leaves the drifted RTU's foreign-organization asset on `catalog`. */
export async function assertUpdateLeavesTheAssetOnCatalog(
  ctx: TenantAgreementCtx,
): Promise<void> {
  const rtuId = await insertDriftedRtu(ctx, { active: true });
  const assetId = await attachForeignOrgAsset(ctx, rtuId);
  await attempt(ctx, "update", rtuId);
  const res = await ctx.fixturePool.query<{ source: string | null }>(
    "SELECT meta->>'telemetrySource' AS source FROM bms.assets WHERE id = $1",
    [assetId],
  );
  expect(res.rows[0]?.source).toBe("catalog");
}

/** `deactivate` leaves a drifted RTU active. */
export async function assertDeactivateLeavesTheRtuActive(
  ctx: TenantAgreementCtx,
): Promise<void> {
  const rtuId = await insertDriftedRtu(ctx, { active: true });
  await attempt(ctx, "deactivate", rtuId);
  expect((await readRtu(ctx, rtuId)).active).toBe(true);
}

/** `reactivate` leaves a drifted RTU inactive. */
export async function assertReactivateLeavesTheRtuInactive(
  ctx: TenantAgreementCtx,
): Promise<void> {
  const rtuId = await insertDriftedRtu(ctx, { active: false });
  await attempt(ctx, "reactivate", rtuId);
  expect((await readRtu(ctx, rtuId)).active).toBe(false);
}

/**
 * Positive control: the same shape of RTU, with its column repaired to the
 * location's organization, is updated. Without it, a guard refusing every write
 * would pass every other case in this file.
 */
export async function assertARepairedRtuIsUpdated(ctx: TenantAgreementCtx): Promise<void> {
  const rtuId = await insertDriftedRtu(ctx, { active: true });
  await ctx.fixturePool.query("UPDATE bms.rtus SET organization_id = $1 WHERE id = $2", [
    ctx.organizationId,
    rtuId,
  ]);
  const updated = await ctx.svc.update(ctx.jwt, rtuId, { displayName: "F4.138 repaired" });
  expect(updated.displayName).toBe("F4.138 repaired");
}
