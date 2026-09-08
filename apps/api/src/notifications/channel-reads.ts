import { and, eq, inArray } from "drizzle-orm";

import type { BmsDb } from "@bms/db";
import { notificationChannels } from "@bms/db";

import type { ChannelsService } from "./channels.service";

/**
 * `F3.10` — the one channel read the alarm lifecycle sweep needs that
 * `ChannelsService` does not already have (ADR 0057 decision 9).
 *
 * **Why this is not a method on `ChannelsService`.** That file stands at 986
 * of AGENTS.md §4.5's 1000 lines, and it gains nothing (plan D10). The row
 * shape is `ChannelsService.toChannelRow`'s parameter — the same projection
 * `loadForRule` selects — so the caller maps with the already-public method
 * and decryption stays in the one place ADR 0041 decision 8 put it.
 *
 * **`fleetDb`, with its reason (ADR 0043 Amendment 3, §4.3).** The caller is
 * a system sweep with no JWT that spans every tenant — the same reason
 * `AlarmEngineService` and `HealthRollupService` give — and the ids it passes
 * were read from the tenant's own escalation profile under that tenant's
 * policy. A fleet-wide (`NULL`-org) channel is a legitimate target here for
 * the same reason it is on `rule_notifications` (plan D6), so no organization
 * predicate is added: the profile's policy already decided who may name the
 * channel; this read only decides whether it is still enabled.
 */

/** A stored channel row, ciphertext and all: what `ChannelsService.toChannelRow` takes. */
export type StoredChannelRow = Parameters<ChannelsService["toChannelRow"]>[0];

/**
 * The enabled channels among `ids`, in channel-code order — the order
 * `loadForRule` gives, so a step's deliveries land in the same order a raise's
 * do. A disabled channel is silently absent: an operator who disabled it asked
 * for exactly that. Empty `ids` returns `[]` without a query.
 */
export async function loadEnabledChannelsByIds(
  db: BmsDb,
  ids: readonly string[],
): Promise<StoredChannelRow[]> {
  if (ids.length === 0) {
    return [];
  }
  return db
    .select({
      id: notificationChannels.id,
      organizationId: notificationChannels.organizationId,
      code: notificationChannels.code,
      name: notificationChannels.name,
      kind: notificationChannels.kind,
      config: notificationChannels.config,
      enabled: notificationChannels.enabled,
      secretCiphertext: notificationChannels.secretCiphertext,
      secretIv: notificationChannels.secretIv,
      updatedAt: notificationChannels.updatedAt,
    })
    .from(notificationChannels)
    .where(and(inArray(notificationChannels.id, [...ids]), eq(notificationChannels.enabled, true)))
    .orderBy(notificationChannels.code);
}
