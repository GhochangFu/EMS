import { Inject, Injectable } from "@nestjs/common";
import { asc } from "drizzle-orm";

import { pointKeys } from "@bms/db";
import type { BmsDb } from "@bms/db";

import { FLEET_DRIZZLE } from "../../database/database.tokens";

export type OrgPointKeySummary = {
  code: string;
  name: string;
  unit: string | null;
  domain: string | null;
};

/**
 * Loads organization catalog data for onboarding chat.
 *
 * `F4.16` / ADR 0043 — `point_keys` carries `ENABLE ROW LEVEL SECURITY`
 * (migration `0040`), so this read runs on `fleetDb`. `organizationId` is
 * always a value the caller has already been authorized against (session or
 * request-scoped, checked upstream in `OnboardingService`), so this is a
 * pool change, not a new authorization surface.
 */
@Injectable()
export class OnboardingCatalogService {
  constructor(@Inject(FLEET_DRIZZLE) private readonly db: BmsDb) {}

  /**
   * Returns the point keys the onboarding chat may offer.
   *
   * `F3.39`: the catalog is fleet-wide after migration `0057`, so this is no
   * longer per-organization. `organizationId` is kept in the signature because
   * every other method on this service takes it and the chat passes one session
   * scope around; the filter it used to drive is gone with the column.
   */
  async listPointKeys(_organizationId: string): Promise<OrgPointKeySummary[]> {
    const rows = await this.db
      .select({
        code: pointKeys.code,
        name: pointKeys.name,
        unit: pointKeys.unit,
        domain: pointKeys.domain,
      })
      .from(pointKeys)
      .orderBy(asc(pointKeys.code));
    return rows.filter((row) => row.code.length > 0);
  }

  /** Formats org point keys for chat display. */
  formatPointKeysForChat(keys: OrgPointKeySummary[]): string {
    if (keys.length === 0) {
      return "No point keys exist in this organization yet.";
    }
    return keys
      .map((key) => `- **${key.code}** (${key.name}${key.unit ? `, ${key.unit}` : ""})`)
      .join("\n");
  }
}
