import { ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";

import type { BmsDb } from "@bms/db";
import type { DeviceHealthResponse, JwtPayload, RtuDropHistoryResponse, RtuHealthDto } from "@bms/shared";

import { AccessControlService } from "../auth/access-control.service";
import { FLEET_DRIZZLE } from "../database/database.tokens";
import { hostSummaryFor } from "./device-state";
import {
  readDropHistory,
  readIngestHosts,
  readRecentDrops,
  readRtuHealthRows,
  readRtuLocation,
  readUnattributedDrops,
  stateOf,
  type RtuScope,
} from "./device-health.reads";

/**
 * `F3.16` / ADR 0127 decisions 4, 11, 14, 17 and 18 — the admin device-health
 * reads behind the RTUs page.
 *
 * **Gate (§4.7, decision 14)** — exactly `RtusAdminService.list`'s:
 * `requireMasterDataUser`, then `canManageLocation` for an explicit
 * `locationId` (403 outside scope) or `writableLocationIds` (`null` = every
 * RTU, `[]` = none). The drop history answers 404 for an RTU outside scope, so
 * it does not confirm another tenant's RTU id exists.
 *
 * **Pool** — every read runs on `fleetDb`: `ingest_hosts` and
 * `ingest_endpoint_drop_hours` are platform tables `bms_tenant` cannot read
 * (decision 7), and a writable scope spans organizations. The scope predicate
 * computed above is the isolation control at each call (ADR 0043 Amendment 2/3).
 * `unattributed` is filled for the global admin only (decision 17): a device
 * key can belong to any customer.
 *
 * The response types are `z.infer`red from `contracts/device-health.ts` (ADR 0030).
 */
@Injectable()
export class DeviceHealthService {
  constructor(
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    private readonly accessControl: AccessControlService,
  ) {}

  async list(jwt: JwtPayload, locationId?: string): Promise<DeviceHealthResponse> {
    await this.accessControl.requireMasterDataUser(jwt);
    const scope = await this.scopeOf(jwt, locationId);
    const global = await this.accessControl.isGlobalAdmin(jwt);

    const [rows, drops, { hosts, dbNowMs }, unattributed] = await Promise.all([
      // fleetDb: bounded by the writable-location scope resolved above (decision 14).
      scope === null ? Promise.resolve([]) : readRtuHealthRows(this.fleetDb, scope),
      // fleetDb: the same scope predicate bounds the drop buckets.
      scope === null ? Promise.resolve(new Map()) : readRecentDrops(this.fleetDb, scope),
      // fleetDb: ingest_hosts is a platform table with no tenant column (decision 7).
      readIngestHosts(this.fleetDb),
      // fleetDb: platform table; read for the global admin only (decision 17).
      global ? readUnattributedDrops(this.fleetDb) : Promise.resolve([]),
    ]);

    const hostsByKey = new Map(hosts.map((h) => [h.hostKey, h]));
    const items: RtuHealthDto[] = rows.map((row) => ({
      rtuId: row.rtuId,
      state: stateOf(row, hostsByKey),
      lastSeenAt: row.lastSeenMs === null ? null : new Date(row.lastSeenMs).toISOString(),
      windowSeconds: row.windowSeconds,
      clockSkewSeconds: row.clockSkewSeconds,
      clockSkewAt: row.clockSkewAtMs === null ? null : new Date(row.clockSkewAtMs).toISOString(),
      edgeServed: row.edgeServed,
      drops24h: drops.get(row.rtuId) ?? [],
    }));
    const serving = rows.flatMap((row) => (row.monitoredSinceMs !== null && row.hostKey !== null ? [row.hostKey] : []));
    const summary = hostSummaryFor(hosts, serving, dbNowMs);
    return {
      ingestHost: {
        state: summary.state,
        lastBeatAt: summary.lastBeatMs === null ? null : new Date(summary.lastBeatMs).toISOString(),
      },
      items,
      unattributed,
    };
  }

  /** 30 days of one RTU's hour buckets. 404 when the RTU does not exist or is outside the caller's writable scope. */
  async dropHistory(jwt: JwtPayload, rtuId: string): Promise<RtuDropHistoryResponse> {
    await this.accessControl.requireMasterDataUser(jwt);
    // fleetDb: an id lookup whose answer is gated by canManageLocation before anything is returned.
    const locationId = await readRtuLocation(this.fleetDb, rtuId);
    if (locationId === undefined || !(await this.accessControl.canManageLocation(jwt, locationId))) {
      throw new NotFoundException("RTU not found");
    }
    // fleetDb: the RTU was just proven inside the caller's scope.
    return { items: await readDropHistory(this.fleetDb, rtuId) };
  }

  /** `null` is a real caller with no writable location: they see nothing (§4.7). */
  private async scopeOf(jwt: JwtPayload, locationId: string | undefined): Promise<RtuScope | null> {
    if (locationId !== undefined) {
      if (!(await this.accessControl.canManageLocation(jwt, locationId))) {
        throw new ForbiddenException("Location is outside your access scope");
      }
      return { kind: "location", locationId };
    }
    const writableIds = await this.accessControl.writableLocationIds(jwt);
    if (writableIds === null) return { kind: "all" };
    return writableIds.length === 0 ? null : { kind: "locations", locationIds: writableIds };
  }
}
