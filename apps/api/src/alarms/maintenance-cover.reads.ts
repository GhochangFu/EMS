import { and, asc, eq, inArray } from "drizzle-orm";

import { assets, maintenanceWindows, maintenanceWindowTargets, rtus } from "@bms/db";
import type { BmsDb } from "@bms/db";

import { locationAncestorChains, locationAncestors } from "../auth/location-tree";
import type { BmsTx } from "../database/tenant-context";
import { windowInState } from "../maintenance-windows/maintenance-window-scope";
import { type ActiveWindow, type CoverSubject, firstCoveringWindow } from "./maintenance-cover";

/**
 * `F4.359` U6 (ADR 0131 decisions 4, 5 and 9; plan D2, D6, D7) — the reads that
 * feed {@link firstCoveringWindow}: the active windows, and for each alarm the
 * ancestor-or-self locations and the bound assets it is judged on.
 *
 * **Cost (plan §8.8).** Both entry points return after one read when no window
 * is active, which is the steady state. The location walk runs only while an
 * active window has a location target, and the bound-asset read only while one
 * has an asset target and an `rtu_comms` alarm is being judged. Every walk goes
 * through `auth/location-tree.ts`; this file writes no recursive CTE of its own
 * (`tests/f2.10-recursive-cte-invariants.test.ts`).
 *
 * **Handles.** `coverForAlarm` takes the raiser's tenant transaction — the reads
 * are tenant tables under FORCE, and the `bms_tenant` integration suite is the
 * proof it needs no fleet handle. `coverForAlarms` takes `fleetDb` for the
 * lifecycle sweep, which judges every organization in one pass; it keeps each
 * alarm to its own organization's windows through `firstCoveringWindow`'s
 * organization test, not through the connection.
 *
 * Imported by `AlarmRaiser`, so this file and its imports are in the worker's
 * import closure and must reach no loop host
 * (`tests/f4.24-worker-imports-no-api-loop.test.ts`).
 */

/** A pool database or a transaction — both run the drizzle builders and `execute`. */
export type CoverExecutor = BmsDb | BmsTx;

/** One alarm, as the cover needs it — the shape of `alarms_source_shape_check` (migration `0151`). */
export type CoverAlarm =
  | { readonly source: "rule"; readonly organizationId: string; readonly assetId: string; readonly ruleId: string | null }
  | { readonly source: "rtu_comms"; readonly organizationId: string; readonly rtuId: string }
  | { readonly source: "ingest_host"; readonly organizationId: string };

/**
 * D2: every window that is active on the database clock (`ended_at IS NULL AND
 * starts_at <= now() AND ends_at > now()`, the predicate the routes and the list
 * share), with its targets split by kind — of one organization when one is
 * named, of every organization otherwise. Ordered by start, then id.
 */
export async function readActiveWindows(
  db: CoverExecutor,
  opts: { readonly organizationId?: string } = {},
): Promise<ActiveWindow[]> {
  const rows = await db
    .select({
      id: maintenanceWindows.id,
      organizationId: maintenanceWindows.organizationId,
      startsAt: maintenanceWindows.startsAt,
      assetId: maintenanceWindowTargets.assetId,
      locationId: maintenanceWindowTargets.locationId,
      ruleId: maintenanceWindowTargets.ruleId,
    })
    .from(maintenanceWindows)
    .innerJoin(
      maintenanceWindowTargets,
      and(
        eq(maintenanceWindowTargets.windowId, maintenanceWindows.id),
        eq(maintenanceWindowTargets.organizationId, maintenanceWindows.organizationId),
      ),
    )
    .where(
      opts.organizationId === undefined
        ? windowInState("active")
        : and(windowInState("active"), eq(maintenanceWindows.organizationId, opts.organizationId)),
    )
    .orderBy(asc(maintenanceWindows.startsAt), asc(maintenanceWindows.id));

  const byId = new Map<string, { id: string; organizationId: string; startsAt: Date; assetIds: string[]; locationIds: string[]; ruleIds: string[] }>();
  for (const row of rows) {
    let window = byId.get(row.id);
    if (window === undefined) {
      window = { id: row.id, organizationId: row.organizationId, startsAt: row.startsAt, assetIds: [], locationIds: [], ruleIds: [] };
      byId.set(row.id, window);
    }
    if (row.assetId !== null) window.assetIds.push(row.assetId);
    if (row.locationId !== null) window.locationIds.push(row.locationId);
    if (row.ruleId !== null) window.ruleIds.push(row.ruleId);
  }
  return [...byId.values()];
}

const anyLocationTarget = (windows: readonly ActiveWindow[]): boolean => windows.some((w) => w.locationIds.length > 0);
const anyAssetTarget = (windows: readonly ActiveWindow[]): boolean => windows.some((w) => w.assetIds.length > 0);

/** The ancestor-or-self ids of one node, bounded to its organization; `[]` when it names no row there. */
async function ancestorOrSelf(db: CoverExecutor, organizationId: string, locationId: string | undefined): Promise<string[]> {
  if (locationId === undefined) return [];
  return (await locationAncestors(db, { organizationIds: [organizationId], id: locationId })).map((row) => row.id);
}

/**
 * The window that covers one alarm, or `null` — the raiser's read, inside its
 * raise transaction (Q1 (a), D8). `ingest_host` is never covered and reads
 * nothing.
 */
export async function coverForAlarm(tx: CoverExecutor, alarm: CoverAlarm): Promise<string | null> {
  if (alarm.source === "ingest_host") return null;
  const { organizationId } = alarm;
  const windows = await readActiveWindows(tx, { organizationId });
  if (windows.length === 0) return null;
  const needLocations = anyLocationTarget(windows);

  if (alarm.source === "rule") {
    let locationAncestorIds: string[] = [];
    if (needLocations) {
      const [asset] = await tx
        .select({ locationId: assets.locationId })
        .from(assets)
        .where(and(eq(assets.id, alarm.assetId), eq(assets.organizationId, organizationId)))
        .limit(1);
      locationAncestorIds = await ancestorOrSelf(tx, organizationId, asset?.locationId);
    }
    const subject: CoverSubject = { source: "rule", organizationId, assetId: alarm.assetId, ruleId: alarm.ruleId, locationAncestorIds };
    return firstCoveringWindow(windows, subject);
  }

  let locationAncestorIds: string[] = [];
  if (needLocations) {
    const [rtu] = await tx
      .select({ locationId: rtus.locationId })
      .from(rtus)
      .where(and(eq(rtus.id, alarm.rtuId), eq(rtus.organizationId, organizationId)))
      .limit(1);
    locationAncestorIds = await ancestorOrSelf(tx, organizationId, rtu?.locationId);
  }
  let boundAssetIds: string[] = [];
  if (anyAssetTarget(windows)) {
    boundAssetIds = (
      await tx
        .select({ id: assets.id })
        .from(assets)
        .where(and(eq(assets.rtuId, alarm.rtuId), eq(assets.organizationId, organizationId)))
    ).map((row) => row.id);
  }
  return firstCoveringWindow(windows, { source: "rtu_comms", organizationId, locationAncestorIds, boundAssetIds });
}

/**
 * The covering window of each alarm, for the lifecycle sweep (D5): a map from
 * alarm id to window id, holding only the covered alarms. One window read for
 * every organization; then, only as the active windows require, one asset read,
 * one RTU read, one batched ancestor walk and one bound-asset read for the
 * whole batch.
 */
export async function coverForAlarms(
  fleetDb: CoverExecutor,
  alarms: ReadonlyArray<CoverAlarm & { readonly id: string }>,
): Promise<Map<string, string>> {
  const covers = new Map<string, string>();
  if (alarms.length === 0) return covers;
  const windows = await readActiveWindows(fleetDb);
  if (windows.length === 0) return covers;

  // `ingest_host` is never covered, and an organization with no active window covers nothing.
  const withWindows = new Set(windows.map((w) => w.organizationId));
  const inScope = alarms.filter((alarm) => withWindows.has(alarm.organizationId));
  const ruleAlarms = inScope.flatMap((alarm) => (alarm.source === "rule" ? [alarm] : []));
  const rtuAlarms = inScope.flatMap((alarm) => (alarm.source === "rtu_comms" ? [alarm] : []));
  const candidates = [...ruleAlarms, ...rtuAlarms];
  if (candidates.length === 0) return covers;
  const rtuIds = [...new Set(rtuAlarms.map((alarm) => alarm.rtuId))];

  // Each asset's and each RTU's node, then every node's ancestor-or-self set.
  const assetNode = new Map<string, string>();
  const rtuNode = new Map<string, string>();
  const chains = new Map<string, string[]>();
  if (anyLocationTarget(windows)) {
    const assetIds = [...new Set(ruleAlarms.map((alarm) => alarm.assetId))];
    if (assetIds.length > 0) {
      for (const row of await fleetDb
        .select({ id: assets.id, locationId: assets.locationId })
        .from(assets)
        .where(inArray(assets.id, assetIds))) {
        assetNode.set(row.id, row.locationId);
      }
    }
    if (rtuIds.length > 0) {
      for (const row of await fleetDb
        .select({ id: rtus.id, locationId: rtus.locationId })
        .from(rtus)
        .where(inArray(rtus.id, rtuIds))) {
        rtuNode.set(row.id, row.locationId);
      }
    }
    const nodes = [...new Set([...assetNode.values(), ...rtuNode.values()])];
    const organizationIds = [...new Set(windows.filter((w) => w.locationIds.length > 0).map((w) => w.organizationId))];
    for (const row of await locationAncestorChains(fleetDb, { organizationIds, ids: nodes })) {
      const chain = chains.get(row.nodeId) ?? [];
      chain.push(row.ancestorId);
      chains.set(row.nodeId, chain);
    }
  }

  const bound = new Map<string, string[]>();
  if (rtuIds.length > 0 && anyAssetTarget(windows)) {
    for (const row of await fleetDb
      .select({ id: assets.id, rtuId: assets.rtuId, organizationId: assets.organizationId })
      .from(assets)
      .where(inArray(assets.rtuId, rtuIds))) {
      if (row.rtuId === null) continue;
      const list = bound.get(row.rtuId) ?? [];
      list.push(row.id);
      bound.set(row.rtuId, list);
    }
  }

  const ancestorsOf = (node: string | undefined): string[] => (node === undefined ? [] : (chains.get(node) ?? []));
  for (const alarm of candidates) {
    const subject: CoverSubject =
      alarm.source === "rule"
        ? {
            source: "rule",
            organizationId: alarm.organizationId,
            assetId: alarm.assetId,
            ruleId: alarm.ruleId,
            locationAncestorIds: ancestorsOf(assetNode.get(alarm.assetId)),
          }
        : {
            source: "rtu_comms",
            organizationId: alarm.organizationId,
            locationAncestorIds: ancestorsOf(rtuNode.get(alarm.rtuId)),
            boundAssetIds: bound.get(alarm.rtuId) ?? [],
          };
    const windowId = firstCoveringWindow(windows, subject);
    if (windowId !== null) covers.set(alarm.id, windowId);
  }
  return covers;
}
