import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { assets, locations, rtus } from "@bms/db";
import type { BmsDb } from "@bms/db";

import { FLEET_DRIZZLE } from "../database/database.tokens";

/**
 * `F4.16` / ADR 0043 — this query joins `locations` (`ENABLE ROW LEVEL
 * SECURITY`, migration `0040`), so it runs on `fleetDb`. `listAll`'s two
 * callers already scope by `assetIds`/`organizationId` before or after this
 * read; there is no caller-widening here, only a change of which pool serves
 * an unchanged, already-scoped query.
 *
 * `F3.31` / ADR 0068 decision 2 adds a `LEFT JOIN bms.rtus` and six columns
 * for the operator `/asset-browser` route. The pool stays `fleetDb` for the same
 * reason: the controller narrows by `readableAssetIds` first, and the join
 * adds columns to rows the caller already reads, never rows.
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
   *
   * `F3.31` / ADR 0068 decision 2 — the row also carries `locationName`,
   * `rtuId`, `rtuDisplayName`, `active`, `templateId` and `telemetrySource`:
   *
   * - `locations` stays INNER: an asset always has a location. `rtus` is LEFT:
   *   an asset need not be wired (ADR 0018), and an INNER join would drop every
   *   unwired asset from the browser.
   * - `telemetrySource` is `meta->>'telemetrySource'` in SQL — the stored text,
   *   reported and never derived (the `storedSource` rule of
   *   `admin/assets/assets.service.ts`), so the rows still go out unmapped. A
   *   row written before `F4.139` has no such key and reports `null`; the
   *   browser shows "—", not a guess.
   * - The pool is unchanged (`fleetDb`, see the class docblock): the caller
   *   scopes by `assetIds` first, so the join cannot widen what it reads.
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
        locationName: locations.name,
        rtuId: assets.rtuId,
        rtuDisplayName: rtus.displayName,
        active: assets.active,
        templateId: assets.templateId,
        telemetrySource: sql<string | null>`${assets.meta}->>'telemetrySource'`,
      })
      .from(assets)
      .innerJoin(locations, eq(assets.locationId, locations.id))
      // The organization predicate rides on the join, not only the FK: this
      // reads on the fleet pool (BYPASSRLS), and `assets_rtu_id_fk` is a plain
      // FK to `rtus(id)` — only `assertRtuLocation` at write time keeps an
      // asset's RTU inside its organization. A mis-stamped `rtu_id` therefore
      // reports `null`, never a foreign organization's display name. The same
      // shape as `dashboards.service.ts`'s `assets` join (ADR 0043).
      .leftJoin(rtus, and(eq(assets.rtuId, rtus.id), eq(rtus.organizationId, assets.organizationId)));

    return conditions.length > 0
      ? base.where(and(...conditions)).orderBy(asc(assets.siteName), asc(assets.code))
      : base.orderBy(asc(assets.siteName), asc(assets.code));
  }
}
