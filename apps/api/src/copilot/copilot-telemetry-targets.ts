import { and, eq, inArray } from "drizzle-orm";

import { assets, type BmsDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import { ASSET_NOT_FOUND_REASON, outsideOrganizationMessage, rowList } from "../admin/telemetry-import/telemetry-import.service";
import type { AccessControlService } from "../auth/access-control.service";
import { withTenant } from "../database/tenant-context";

/**
 * A target refusal whose sentence reaches the model — the propose tool returns its message
 * and stores no card. Every other resolver refusal stays the one `null` (`PROPOSE_TARGET_ERROR`).
 */
export class CopilotTargetRefusal extends Error {}

/**
 * `F4.283` (Amendment 8 D2): the telemetry import and manual-reading routes' gate,
 * `requireMasterDataUser` — a throw (an `asset_group_admin`, a viewer) is the refusal, through
 * the resolver's `safely`.
 */
export async function mayWriteTelemetry(access: Pick<AccessControlService, "requireMasterDataUser">, user: JwtPayload): Promise<boolean> {
  await access.requireMasterDataUser(user);
  return true;
}

/**
 * `F4.283` (owner ruling 2026-10-25, Q2) — a `telemetry` target checks every row's asset
 * before the card, as an `asset` target does: the asset must exist in one of the turn's
 * allowed organizations (read under `withTenant`, FORCE RLS on `bms.assets`), pass the
 * routes' own `canManageAsset` (`TelemetryWriteService.validateRow`), and be of the
 * conversation's bound organization.
 *
 * Returns the refusal sentence, with the row numbers (1-based, `validateRows`'s numbering),
 * or `null` when every row passes. Not found and not manageable share one sentence
 * (`ASSET_NOT_FOUND_REASON`, the route's disclosure-safe text) and are reported first; an
 * asset of another allowed organization is `outsideOrganizationMessage`.
 *
 * A body with no `rows` (the import: its rows are in the attached file) has nothing to
 * check here; the proposal check (`previewForProposal`) reads the file's rows.
 */
export async function telemetryRowRefusal(
  db: BmsDb,
  access: Pick<AccessControlService, "canManageAsset">,
  user: JwtPayload,
  body: Readonly<Record<string, unknown>>,
  allowedOrganizationIds: readonly string[],
  boundOrganizationId: string,
): Promise<string | null> {
  if (body.rows === undefined) return null;
  const rows: readonly unknown[] = Array.isArray(body.rows) ? body.rows : [body.rows];
  const ids = rows.map((row) => {
    const assetId = typeof row === "object" && row !== null ? (row as Record<string, unknown>).assetId : undefined;
    return typeof assetId === "string" && UUID.test(assetId) ? assetId : null;
  });
  const unique = [...new Set(ids.filter((id): id is string => id !== null))];
  const organizationOf = new Map<string, string>();
  for (const organizationId of allowedOrganizationIds) {
    if (unique.length === 0) break;
    const found = await withTenant(db, organizationId, (tx) =>
      tx
        .select({ id: assets.id })
        .from(assets)
        .where(and(inArray(assets.id, unique), eq(assets.organizationId, organizationId))),
    );
    for (const row of found) organizationOf.set(row.id, organizationId);
  }
  const manageable = new Set<string>();
  for (const assetId of organizationOf.keys()) {
    if (await access.canManageAsset(user, assetId).catch(() => false)) manageable.add(assetId);
  }
  const unknown: number[] = [];
  const outside: number[] = [];
  ids.forEach((assetId, index) => {
    if (assetId === null || !manageable.has(assetId)) unknown.push(index + 1);
    else if (organizationOf.get(assetId) !== boundOrganizationId) outside.push(index + 1);
  });
  if (unknown.length > 0) return `${rowList(unknown)}: ${ASSET_NOT_FOUND_REASON}.`;
  if (outside.length > 0) return outsideOrganizationMessage(outside);
  return null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
