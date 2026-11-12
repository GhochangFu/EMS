import { eq, sql, type SQL } from "drizzle-orm";

import { alarms, locations } from "@bms/db";
import type { BmsDb } from "@bms/db";

import { expandLocationSubtrees } from "../auth/location-tree";

/**
 * `F4.357` U2 (ADR 0130 decision 15) — the alarm list's and summary's
 * `locationId` filter: the node, and the caller's readable location ids and
 * readable organization ids, each `null` for an unrestricted admin. The shape
 * of `HealthLocationFilter` (`asset-health.service.ts`), so one rule for
 * `locationId` holds across the API: owner ruling P2 (a scoped caller who
 * cannot read the node gets nothing, before any walk) and P3 (the walk starts
 * only in a readable organization).
 */
export type AlarmLocationFilter = {
  readonly id: string;
  readonly readableLocationIds: readonly string[] | null;
  readonly readableOrganizationIds: readonly string[] | null;
};

/**
 * The node and every location under it that the filter allows — `[]` when a
 * scoped caller cannot read the node (P2), or the node is outside the readable
 * organizations or names no row.
 *
 * §4.3 fleet read, by name: this is **pre-tenant scope resolution**. It runs
 * before `withReadScope` picks the tenant or fleet handle, and its answer only
 * narrows the caller's already-intersected asset scope, never widens it. For
 * the unrestricted admin (`readableOrganizationIds` null) the one keyed read
 * of the node's own organization bounds the walk, so no tenant GUC applies.
 */
export async function alarmLocationIds(fleetDb: BmsDb, filter: AlarmLocationFilter): Promise<string[]> {
  if (filter.readableLocationIds !== null && !filter.readableLocationIds.includes(filter.id)) {
    return [];
  }
  const organizationIds = filter.readableOrganizationIds ?? (await organizationOf(fleetDb, filter.id));
  return expandLocationSubtrees(fleetDb, { organizationIds, ids: [filter.id] });
}

/** The node's own organization, or none when the id names no location. */
async function organizationOf(fleetDb: BmsDb, locationId: string): Promise<string[]> {
  const [row] = await fleetDb
    .select({ organizationId: locations.organizationId })
    .from(locations)
    .where(eq(locations.id, locationId))
    .limit(1);
  return row ? [row.organizationId] : [];
}

/**
 * The alarm belongs to one of `locationIds`: a rule alarm by its asset's
 * location, an `rtu_comms` alarm by its RTU's (`bms.rtus.location_id`). An
 * `ingest_host` alarm has no location, so it never matches (decision 15). Two
 * self-contained sub-selects, so the predicate sits in `list`'s `WHERE` and in
 * the summary's `ON` clause alike, and the counts agree with the list. An
 * empty `locationIds` is `= ANY('{}')`: false, so the read is empty.
 */
export function alarmInLocations(locationIds: readonly string[]): SQL {
  const ids = sql.param([...locationIds]);
  return sql`((${alarms.source} = 'rule' AND ${alarms.assetId} IN (SELECT a.id FROM bms.assets a WHERE a.location_id = ANY(${ids}::uuid[])))
    OR (${alarms.source} = 'rtu_comms' AND ${alarms.rtuId} IN (SELECT r.id FROM bms.rtus r WHERE r.location_id = ANY(${ids}::uuid[]))))`;
}
