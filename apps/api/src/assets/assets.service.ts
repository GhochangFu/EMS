import { Inject, Injectable } from "@nestjs/common";
import { asc, inArray } from "drizzle-orm";

import { assets } from "@bms/db";
import type { BmsDb } from "@bms/db";

import { DRIZZLE } from "../database/database.tokens";

@Injectable()
export class AssetsService {
  constructor(@Inject(DRIZZLE) private readonly db: BmsDb) {}

  /** Returns all assets ordered by site and code. */
  async listAll(assetIds?: string[] | null) {
    const base = this.db
      .select({
        id: assets.id,
        code: assets.code,
        name: assets.name,
        siteName: assets.siteName,
        locationId: assets.locationId,
        domain: assets.domain,
      })
      .from(assets);
    if (assetIds === null || assetIds === undefined) {
      return base.orderBy(asc(assets.siteName), asc(assets.code));
    }
    if (assetIds.length === 0) {
      return [];
    }
    return base
      .where(inArray(assets.id, assetIds))
      .orderBy(asc(assets.siteName), asc(assets.code));
  }
}
