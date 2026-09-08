import { Inject, Injectable } from "@nestjs/common";
import { asc } from "drizzle-orm";

import { pointKeys } from "@bms/db";
import type { BmsDb } from "@bms/db";

import { FLEET_DRIZZLE } from "../../database/database.tokens";
// `F4.105` site 6. Same bound the import summary's five lists take, so one
// conversation carries one number and one tail vocabulary.
import { echoedItems, moreTail } from "../spreadsheet-guard";

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

  /**
   * Formats point keys for chat display, bounded to `MAX_ECHOED_ITEMS` bullets
   * with a plain tail line stating what was left out (`F4.105` site 6).
   *
   * **This is the largest of the six list sites, and it is large on a clean
   * seed with no attacker.** Measured on the live seeded database as
   * `bms_fleet`: **613 point keys, 18,006 characters** of `code` + `name`
   * before any markup, which at `- **CODE** (Name, unit)` is roughly **26 KB**
   * in one chat turn — about twice what the other five caps bring the whole
   * worst-case import summary down to. `OnboardingService.chat` persists that
   * turn to `onboarding_sessions.messages`.
   *
   * **The two reasons this row's first pass gave for leaving it uncapped were
   * both false, so they are recorded here rather than repeated.**
   *
   * 1. It is *not* "the organisation's own catalog". `listPointKeys` ignores
   *    its `organizationId`: the catalog went fleet-wide at migration `0057`
   *    (`F3.39`) and the filter is gone with the column. Every organisation
   *    reads every code.
   * 2. Its length *is* influenced from outside, just not by one upload.
   *    `OnboardingCommitService` inserts into the same fleet-wide
   *    `bms.point_keys` at `organization_admin` with no per-organisation quota,
   *    and `F4.103` caps a draft at `MAX_ONBOARDING_POINT_KEYS` = 500 keys
   *    whose `code` and `name` are bounded at 128 and 255. One commit can
   *    therefore add ~213,500 characters (~208 KiB) to this message —
   *    permanently, and for every organisation in the fleet.
   *
   * **The cap bounds the echo, not the growth**, and the growth term is not
   * closed by `F4.105`. An unbounded, unquota'd fleet-wide catalog is still an
   * open residual: after the cap this turn stops growing, but the table it
   * reads does not, and every other reader of `bms.point_keys` still sees it.
   */
  formatPointKeysForChat(keys: OrgPointKeySummary[]): string {
    if (keys.length === 0) {
      return "No point keys exist in this organization yet.";
    }
    const { shown, omitted } = echoedItems(keys);
    return [
      ...shown.map((key) => `- **${key.code}** (${key.name}${key.unit ? `, ${key.unit}` : ""})`),
      // A plain line, not a bullet, so it cannot be read as one more key.
      moreTail(omitted),
    ]
      .filter(Boolean)
      .join("\n");
  }
}
