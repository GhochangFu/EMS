import { and, desc, eq, inArray, ne } from "drizzle-orm";

import { alarms, alarmSkills, assets, maintenanceHistory, maintenanceSchedules, maintenanceTaskTemplates, users, workOrders } from "@bms/db";

import type { BmsDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import type { AccessControlService } from "../auth/access-control.service";
import { type BmsTx, withTenant } from "../database/tenant-context";

/**
 * `F4.284` (ADR 0106 decision 6; ADR 0099 Amendment 8 D2) — the row reads behind the
 * resolver's `alarm`, `workOrder`, `workOrderBatch` and `maintenanceScheduleConvert`
 * targets, kept out of `copilot-target-resolver.ts` for the AGENTS.md §4.5 line cap.
 *
 * Pure functions over a tenant transaction (`withTenant`, run by the resolver), each
 * with an explicit organization filter, so a row of another organization is never
 * found. The gates (`operational` role class, read scope) stay in the resolver.
 */

/** The alarm a card names: its text, severity, asset and raised time, and whether it is acknowledged (DC6). */
export type OperationsAlarm = {
  readonly message: string;
  readonly severity: string;
  readonly assetName: string;
  readonly raisedAt: string;
  readonly acknowledgedAt: string | null;
};

/** A work order a card names: its title, its status now, and its asset. */
export type OperationsWorkOrder = { readonly title: string; readonly status: string; readonly assetName: string };

/** One work order of a reorder, as it is now (the card's "old" position). */
export type OperationsBatchRow = {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly sortOrder: number;
  readonly assetId: string;
};

/** A maintenance schedule a convert names, the work order it makes, and whether the route would convert it now (DC6). */
export type OperationsConvertible = {
  readonly title: string;
  readonly assetId: string;
  readonly workOrder: OperationsWorkOrder;
  readonly convertible: {
    /** The schedule and its template are both active (the route's 404 otherwise). */
    readonly active: boolean;
    /** A not-closed work order already made from the schedule (the route's 400 otherwise). */
    readonly hasActiveWorkOrder: boolean;
  };
};

/**
 * The alarm and work-order routes' gate (ADR 0106 decision 6, owner ruling DC5):
 * `assertOperationsWriteRole(user, "operational")` (a throw, as for a viewer, is the resolver's
 * refusal through `safely`), then every asset in the caller's **read** scope (`readableAssetIds`).
 */
export async function mayWriteOperationalAssets(
  access: Pick<AccessControlService, "assertOperationsWriteRole" | "readableAssetIds">,
  user: JwtPayload,
  assetIds: readonly (string | null)[],
): Promise<boolean> {
  await access.assertOperationsWriteRole(user, "operational");
  const readable = await access.readableAssetIds(user);
  if (readable === null) return true;
  return assetIds.every((assetId) => assetId !== null && readable.includes(assetId));
}

/**
 * ADR 0106 decision 2: a reorder's work orders, all in one allowed organization. A list with a
 * duplicate id, an id in no allowed organization, or ids in two organizations is refused (`null`).
 */
export async function findWorkOrderBatch(
  tenantDb: BmsDb,
  items: unknown,
  allowed: readonly string[],
): Promise<{ organizationId: string; rows: OperationsBatchRow[] } | null> {
  if (!Array.isArray(items) || items.length === 0) return null;
  const ids = items.map((item) => (typeof item === "object" && item !== null ? (item as { id?: unknown }).id : undefined));
  if (ids.some((id) => typeof id !== "string") || new Set(ids).size !== ids.length) return null;
  for (const organizationId of allowed) {
    const rows = await withTenant(tenantDb, organizationId, (tx) => readWorkOrderBatch(tx, ids as string[], organizationId));
    if (rows.length === 0) continue;
    return rows.length === ids.length ? { organizationId, rows } : null;
  }
  return null;
}

/** The alarm `id` of `organizationId` (the card's text and its asset), or `null`. */
export async function readAlarmRow(
  tx: BmsTx,
  id: string,
  organizationId: string,
): Promise<{ assetId: string; alarm: OperationsAlarm } | null> {
  const [row] = await tx
    .select({
      message: alarms.message,
      severity: alarms.severity,
      raisedAt: alarms.raisedAt,
      acknowledgedAt: alarms.acknowledgedAt,
      assetId: alarms.assetId,
      assetName: assets.name,
    })
    .from(alarms)
    .innerJoin(assets, eq(assets.id, alarms.assetId))
    .where(and(eq(alarms.id, id), eq(alarms.organizationId, organizationId)))
    .limit(1);
  if (!row) return null;
  return {
    assetId: row.assetId,
    alarm: {
      message: row.message,
      severity: row.severity,
      assetName: row.assetName,
      raisedAt: row.raisedAt.toISOString(),
      acknowledgedAt: row.acknowledgedAt ? row.acknowledgedAt.toISOString() : null,
    },
  };
}

/** The work order `id` of `organizationId` (its title, status and asset), or `null`. */
export async function readWorkOrderRow(
  tx: BmsTx,
  id: string,
  organizationId: string,
): Promise<{ assetId: string; workOrder: OperationsWorkOrder } | null> {
  const [row] = await tx
    .select({ title: workOrders.title, status: workOrders.status, assetId: workOrders.assetId, assetName: assets.name })
    .from(workOrders)
    .innerJoin(assets, eq(assets.id, workOrders.assetId))
    .where(and(eq(workOrders.id, id), eq(workOrders.organizationId, organizationId)))
    .limit(1);
  if (!row) return null;
  return { assetId: row.assetId, workOrder: { title: row.title, status: row.status, assetName: row.assetName } };
}

/**
 * Owner ruling DC1 — an assignee (`assignedTo`) of `organizationId`: its display name, for the
 * card's "assigned to", or `null`. `bms.users` carries FORCE ROW LEVEL SECURITY (`0047`), so the
 * read runs under the change's tenant; a global admin (no organization) is never found.
 */
export async function readOrganizationUserName(tenantDb: BmsDb, id: string, organizationId: string): Promise<string | null> {
  const [row] = await withTenant(tenantDb, organizationId, (tx) =>
    tx
      .select({ id: users.id, displayName: users.displayName })
      .from(users)
      .where(and(eq(users.id, id), eq(users.organizationId, organizationId)))
      .limit(1),
  );
  return row ? row.displayName : null;
}

/**
 * `F4.284` owner ruling 2026-10-25 (Q4): whether `code` is an active `bms.alarm_skills` row — the
 * enrichment route's `VocabulariesService.assertAlarmSkill` (absent or retired is its 400). A fleet
 * vocabulary with no row-level security (the `pointKeyCode` precedent), read on the tenant pool.
 */
export async function isActiveAlarmSkill(tenantDb: BmsDb, code: string): Promise<boolean> {
  const [row] = await tenantDb.select({ active: alarmSkills.active }).from(alarmSkills).where(eq(alarmSkills.code, code)).limit(1);
  return row?.active === true;
}

/** The refusal of an unknown or retired skill code; it names the read tool that lists the live ones. */
export function unknownAlarmSkillMessage(code: string): string {
  return `"${code}" is not an active alarm skill code. Read list_alarm_skills and use a listed code, or leave skillCode out.`;
}

/** The work orders of `ids` that are this organization's (any not found is simply absent). */
export async function readWorkOrderBatch(tx: BmsTx, ids: readonly string[], organizationId: string): Promise<OperationsBatchRow[]> {
  if (ids.length === 0) return [];
  return tx
    .select({
      id: workOrders.id,
      title: workOrders.title,
      status: workOrders.status,
      sortOrder: workOrders.sortOrder,
      assetId: workOrders.assetId,
    })
    .from(workOrders)
    .where(and(inArray(workOrders.id, [...ids]), eq(workOrders.organizationId, organizationId)));
}

/** The maintenance schedule `id` of `organizationId`, the work order a convert makes, and its state (DC6), or `null`. */
export async function readConvertibleSchedule(tx: BmsTx, id: string, organizationId: string): Promise<OperationsConvertible | null> {
  const [row] = await tx
    .select({
      title: maintenanceTaskTemplates.title,
      assetId: maintenanceTaskTemplates.assetId,
      assetName: assets.name,
      scheduleActive: maintenanceSchedules.active,
      templateActive: maintenanceTaskTemplates.active,
    })
    .from(maintenanceSchedules)
    .innerJoin(maintenanceTaskTemplates, eq(maintenanceSchedules.templateId, maintenanceTaskTemplates.id))
    .innerJoin(assets, eq(assets.id, maintenanceTaskTemplates.assetId))
    .where(and(eq(maintenanceSchedules.id, id), eq(maintenanceSchedules.organizationId, organizationId)))
    .limit(1);
  if (!row) return null;
  // `MaintenanceService.getActiveWorkOrdersBySchedule`'s read, for this schedule alone.
  const open = await tx
    .select({ workOrderId: maintenanceHistory.workOrderId })
    .from(maintenanceHistory)
    .innerJoin(workOrders, eq(maintenanceHistory.workOrderId, workOrders.id))
    .where(and(eq(maintenanceHistory.scheduleId, id), ne(workOrders.status, "closed")))
    .orderBy(desc(maintenanceHistory.createdAt))
    .limit(1);
  return {
    title: row.title,
    assetId: row.assetId,
    // `MaintenanceService.convertToWorkOrder`'s title for the work order it inserts.
    workOrder: { title: `Maintenance: ${row.title}`, status: "open", assetName: row.assetName },
    convertible: { active: row.scheduleActive && row.templateActive, hasActiveWorkOrder: open.length > 0 },
  };
}
