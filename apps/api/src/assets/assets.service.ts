import { Inject, Injectable } from "@nestjs/common";
import { asc } from "drizzle-orm";

import { assets } from "@bms/db";
import type { BmsDb } from "@bms/db";

import { DRIZZLE } from "../database/database.tokens";

@Injectable()
export class AssetsService {
  constructor(@Inject(DRIZZLE) private readonly db: BmsDb) {}

  /** Returns all assets ordered by site and code. */
  async listAll() {
    return this.db
      .select({
        id: assets.id,
        code: assets.code,
        name: assets.name,
        siteName: assets.siteName,
        domain: assets.domain,
      })
      .from(assets)
      .orderBy(asc(assets.siteName), asc(assets.code));
  }
}
