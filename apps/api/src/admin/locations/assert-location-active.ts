import { NotFoundException } from "@nestjs/common";
import { eq } from "drizzle-orm";

import { locations } from "@bms/db";

import type { BmsTx } from "../../database/tenant-context";
import { refusal } from "./locations-tree-guards";

/**
 * `F2.10` / ADR 0098 ruling 15 and Amendment 1 (A4, A5) — an asset or an RTU
 * may not be placed on an inactive location.
 *
 * Reads the location `FOR SHARE` inside the caller's tenant transaction, so a
 * concurrent `locations.deactivate` (which locks the row `FOR UPDATE` before it
 * counts) either waits for this write to commit and then counts the new row,
 * or commits first and this read sees `active = false`. A plain read would let
 * both pass: the foreign key's own check takes `FOR KEY SHARE`, which an
 * `UPDATE … SET active` does not conflict with.
 *
 * 404 when the row is absent (or invisible under the tenant GUC — the caller
 * has already passed `canManageLocation`); 409 `location_inactive` with the
 * `{ message, reason }` body when it is inactive.
 *
 * Called only where a write puts something **on** the location — create,
 * reactivate and the asset move (A4). A rename of an asset or an RTU that
 * already sits on an inactive node does not call it, and stays allowed.
 */
export async function assertLocationActive(tx: BmsTx, locationId: string): Promise<void> {
  const [row] = await tx
    .select({ active: locations.active })
    .from(locations)
    .where(eq(locations.id, locationId))
    .for("share");
  if (!row) {
    throw new NotFoundException("Location not found");
  }
  if (!row.active) {
    throw refusal("location_inactive");
  }
}
