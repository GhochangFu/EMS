import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, inArray } from "drizzle-orm";

import { assets, locations } from "@bms/db";
import type { BmsDb } from "@bms/db";

import { FLEET_DRIZZLE } from "../database/database.tokens";

/**
 * `F4.16` / ADR 0043 — this query joins `locations` (`ENABLE ROW LEVEL
 * SECURITY`, migration `0040`), so it runs on `fleetDb`. `listAll`'s two
 * callers already scope by `assetIds`/`organizationId` before or after this
 * read; there is no caller-widening here, only a change of which pool serves
 * an unchanged, already-scoped query.
 */
@Injectable()
export class AssetsService {
  constructor(@Inject(FLEET_DRIZZLE) private readonly db: BmsDb) {}

  /**
   * Returns assets ordered by site and code, optionally narrowed to one
   * `organizationId` — found missing in review of the `E2.1` affected-asset
   * picker, where an unscoped list mixed assets from every seeded
   * organization together. `assetIds` (the caller's readable-asset scope)
   * and `organizationId` compose as AND: an id outside the given
   * organization returns nothing, not the asset anyway.
   */
  async listAll(assetIds?: string[] | null, organizationId?: string) {
    if (assetIds !== null && assetIds !== undefined && assetIds.length === 0) {
      return [];
    }

    const conditions = [
      ...(assetIds ? [inArray(assets.id, assetIds)] : []),
      ...(organizationId ? [eq(locations.organizationId, organizationId)] : []),
    ];

    const base = this.db
      .select({
        id: assets.id,
        code: assets.code,
        name: assets.name,
        siteName: assets.siteName,
        locationId: assets.locationId,
        domain: assets.domain,
      })
      .from(assets)
      .innerJoin(locations, eq(assets.locationId, locations.id));

    return conditions.length > 0
      ? base.where(and(...conditions)).orderBy(asc(assets.siteName), asc(assets.code))
      : base.orderBy(asc(assets.siteName), asc(assets.code));
  }
}
