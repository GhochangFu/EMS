import { Inject, Injectable } from "@nestjs/common";
import { and, eq, inArray, sql, type SQL } from "drizzle-orm";

import { assetGroupMembers, assets } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import { alarmLocationIds, locationFilter } from "../alarms/alarm-location-scope";
import { AccessControlService } from "../auth/access-control.service";
import { FLEET_DRIZZLE } from "../database/database.tokens";
import { assetGroupReadScope, readableAssetGroups } from "./readable-asset-groups";

/** The four scope keys of a list query (ADR 0132 decisions 3 and 4); each optional, each a lower-cased uuid. */
export type AssetScopeFilter = {
  readonly organizationId?: string | undefined;
  readonly locationId?: string | undefined;
  readonly assetGroupId?: string | undefined;
  readonly assetId?: string | undefined;
};

const isEmpty = (filter: AssetScopeFilter): boolean =>
  filter.organizationId === undefined &&
  filter.locationId === undefined &&
  filter.assetGroupId === undefined &&
  filter.assetId === undefined;

/**
 * `F4.361` U2 (ADR 0132 decision 5, plan D1–D3) — the one narrowing rule the
 * alarm list's `assetGroupId` and the rule list's four filters share: a
 * filter is **ANDed onto the caller's readable assets, never used in their
 * place**, so an organization, location, group or asset outside the caller's
 * scope answers `[]` — not 403 and not that scope's rows.
 *
 * The answer is an asset-id scope in `readableAssetIds`' own convention:
 * `null` (unrestricted) only for the admin's **empty** filter; once any key
 * is set it is always a list, a subset of `readableAssetIds(user)`, and
 * `withReadScope` reads `[]` as an empty page.
 */
@Injectable()
export class AssetFilterScopeService {
  constructor(
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    @Inject(AccessControlService)
    private readonly accessControl: Pick<
      AccessControlService,
      "readableAssetIds" | "readableLocationIds" | "readableOrganizationIds" | "currentUser"
    >,
  ) {}

  async narrow(user: JwtPayload, filter: AssetScopeFilter): Promise<string[] | null> {
    const readable = await this.accessControl.readableAssetIds(user);
    // (1) No key: today's read, untouched — no query.
    if (isEmpty(filter)) return readable;
    if (readable !== null && readable.length === 0) return [];
    // (2) An asset outside the readable set: empty, before any read.
    if (filter.assetId !== undefined && readable !== null && !readable.includes(filter.assetId)) return [];
    // (3) Build note 4: a group the caller does not read is empty, even when some of its members are readable.
    if (filter.assetGroupId !== undefined && !(await this.readsGroup(user, readable, filter.assetGroupId))) return [];
    // (4) The alarm list's walk: owner ruling P2 (an unreadable node is empty before any walk), then the subtree.
    let locationIds: string[] | undefined;
    if (filter.locationId !== undefined) {
      const location = await locationFilter(this.accessControl, user, filter.locationId);
      locationIds = location === undefined ? [] : await alarmLocationIds(this.fleetDb, location);
      if (locationIds.length === 0) return [];
    }
    // (5) One read ANDing every set key onto the readable ids.
    const predicates: SQL[] = [
      ...(readable !== null ? [inArray(assets.id, readable)] : []),
      ...(filter.assetId !== undefined ? [eq(assets.id, filter.assetId)] : []),
      ...(filter.organizationId !== undefined ? [eq(assets.organizationId, filter.organizationId)] : []),
      ...(locationIds !== undefined ? [inArray(assets.locationId, locationIds)] : []),
      ...(filter.assetGroupId !== undefined
        ? [
            inArray(
              assets.id,
              sql`(SELECT ${assetGroupMembers.assetId} FROM ${assetGroupMembers} WHERE ${assetGroupMembers.assetGroupId} = ${filter.assetGroupId})`,
            ),
          ]
        : []),
    ];
    // §4.3 fleet read, by name: pre-tenant scope resolution. It runs before
    // `withReadScope` picks the tenant or fleet handle, a caller's readable
    // assets may span organizations, and every row is ANDed onto
    // `readableAssetIds` (the admin's alone is bounded only by the request's
    // own keys, as its `null` scope already is). The answer only narrows.
    const rows = await this.fleetDb.select({ id: assets.id }).from(assets).where(and(...predicates));
    return rows.map((row) => row.id);
  }

  /** Build note 1: the caller's granted groups, or a group at one of its readable locations; the admin reads every group. */
  private async readsGroup(user: JwtPayload, readable: string[] | null, groupId: string): Promise<boolean> {
    const scope =
      readable === null
        ? { grantedGroupIds: [], locationIds: null }
        : assetGroupReadScope((await this.accessControl.currentUser(user)).scope);
    return (await readableAssetGroups(this.fleetDb, scope, groupId)).length > 0;
  }
}
