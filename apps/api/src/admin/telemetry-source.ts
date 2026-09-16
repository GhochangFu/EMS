import { eq, sql } from "drizzle-orm";

import { rtuConnectionConfigs } from "@bms/db";
import { INGEST_PROTOCOLS } from "@bms/shared";

import type { BmsTx } from "../database/tenant-context";

/**
 * `F4.139` / `F4.140` — the one `assets.meta.telemetrySource` predicate.
 *
 * Extracted verbatim from `RtusAdminService.update` (`F4.59`), which was the
 * only writer of this key under `apps/api/src` until now. It moved here because
 * `AssetsAdminService.create/update` (`F4.139`) and `OnboardingCommitService`
 * (`F4.140`) and `AssetTemplateInstantiationService` attach `assets.rtu_id`
 * too, and three more copies of the reasoning below would have gone stale one
 * at a time.
 *
 * ## The invariant
 *
 * An RTU is `mqtt` on both its own columns and its assets'
 * `meta.telemetrySource`, or on neither, because `apps/sim/src/index.js` skips
 * exactly the assets marked `mqtt`
 * (`coalesce(meta->>'telemetrySource','sim') <> 'mqtt'`). A split row is
 * silently wrong in both directions: an enabled RTU whose assets still read
 * `catalog` has the simulator and the ingest host writing the same
 * `(time, asset, point_key)`, resolved by whichever upsert lands second; a
 * disabled one whose assets are still `mqtt` has neither writing them, and the
 * points just stop.
 *
 * **`assets.rtu_id`, not `asset_points.rtu_id`.** That is the edge the seed
 * sets, the one `RtusAdminService.deactivate` counts, and the one
 * `tests/f1.7-seed-ownership.integration.test.ts` asserts the invariant over.
 *
 * ## Positive membership, not a list of exclusions
 *
 * The admin vocabulary (`rtus/rtus.schema.ts:3`) has three values and only one
 * of them has an adapter today. An earlier draft of this predicate tested
 * `!== 'catalog'` and so handed every `simulator` RTU's assets to a host that
 * will never bind them — 99 of the 147 RTU-attached assets in the seeded fleet,
 * and precisely the dead-points failure above. `INGEST_PROTOCOLS` is the
 * vocabulary that says which sources have an adapter at all, and
 * `packages/shared/src/ingest.ts` records why `simulator` and `catalog` are not
 * in it: a protocol appears there only when an adapter could plausibly be
 * written for it, and `simulator`/`catalog` are onboarding *sources* with no
 * adapter — which is why that module's drift guard is an assignment and not an
 * equality. A fourth source type that gains an adapter is then handled here
 * with no edit. Today only `mqtt` qualifies on the first disjunct; a
 * `modbus_tcp` RTU reaches the second one through its connection-config row.
 *
 * ## The predicate is deliberately coarser than the host's own check
 *
 * "The operator has said what this RTU speaks", not "the host can bind it
 * today". Restating `isIngestProtocol` or the adapter registry here would put
 * the ingest host's protocol vocabulary in the API, where it would go stale the
 * day an adapter lands: a Modbus RTU would keep its assets on the simulator
 * because this file had not heard of Modbus. A declared protocol is a stable
 * fact the API legitimately owns; whether an adapter exists for it is the
 * host's business, and its `no-adapter` skip is the honest place for that
 * answer.
 *
 * ## The move onto `mqtt` is conditional; the move back is not
 *
 * Handing an asset to the ingest host is only safe if a host will take it.
 * `planEndpoints` resolves an RTU's protocol as
 * `rtu_connection_configs.protocol ?? rtus.source_type` and skips `catalog` as
 * `unsupported-protocol` — so an operator who switches `ingest_enabled` on
 * while the RTU still says `catalog` and has no connection config would, with
 * an unconditional move, take those assets off the simulator and get nothing in
 * return. Simulated became **dead**, which is a worse failure than the
 * double-write this closes. In doubt, alive beats dead. The disable direction
 * carries no such risk and is therefore **unconditional**: `ingestEnabled`
 * false is `catalog` whatever the RTU declares, with no read and no exception.
 *
 * Callers apply the answer unconditionally too (`F4.59`,
 * `rtus.service.ts`): the invariant is a postcondition of every write that
 * touches `assets.rtu_id`, not a delta rule, so a row already split is repaired
 * by the next edit.
 */
export type TelemetrySource = "mqtt" | "catalog";

/**
 * The `F4.59` predicate: does this RTU hand its assets to the ingest host?
 *
 * Row-shaped rather than id-shaped because the callers hold the row already —
 * `RtusAdminService.update` holds the next `ingest_enabled` and the declared
 * source, onboarding holds the `.returning()` row, and `assertRtuLocation` reads
 * one anyway. Nothing here re-reads `bms.rtus`; a caller that does not hold the
 * row on its own transaction reads it there itself, which is what
 * `AssetTemplateInstantiationService.deriveTelemetrySource` exists for — a row
 * read on `fleetDb` before `withTenant` is a second snapshot, and the whole
 * predicate belongs to one.
 *
 * `tx` is the **caller's** transaction, never `fleetDb`: in onboarding the
 * connection-config row is inserted in the same uncommitted transaction, and a
 * separate connection would not see it. The read is short-circuited by `&&` and
 * `||` — it happens only when `ingestEnabled` is true and the declared source
 * is not itself an ingest protocol.
 */
export async function resolveTelemetrySource(
  tx: BmsTx,
  rtu: { id: string; ingestEnabled: boolean; sourceType: string },
): Promise<TelemetrySource> {
  const { id, ingestEnabled, sourceType: declaredSource } = rtu;
  const handsOverToIngest =
    ingestEnabled &&
    ((INGEST_PROTOCOLS as readonly string[]).includes(declaredSource) ||
      (
        await tx
          .select({ present: sql<number>`1` })
          .from(rtuConnectionConfigs)
          .where(eq(rtuConnectionConfigs.rtuId, id))
          .limit(1)
      ).length > 0);
  return handsOverToIngest ? "mqtt" : "catalog";
}

/**
 * Merges the derived `telemetrySource` over a caller's `meta` bag. Pure.
 *
 * **Merged, not replaced.** `bms.assets.meta` is a shared bag and one of its
 * other keys is load-bearing: `apps/sim` reads `meta->>'telemetryEnabled'` in
 * the same query, so replacing the object would re-enable simulation on an
 * asset an operator had switched off.
 *
 * **The derived value wins**, so `telemetrySource` is last in the spread: the
 * RTU is authoritative for this key, and a caller that sends its own is
 * overridden rather than trusted.
 *
 * **The input is never mutated.** `RtusAdminService` keeps its own SQL merge
 * (`coalesce(meta,'{}') || jsonb_build_object(...)`) because it updates N rows
 * it has not read; this serves the two single-row writers, which hold the bag
 * in memory and may be holding a row object another statement still reads.
 */
export function withTelemetrySource(
  meta: Record<string, unknown> | null | undefined,
  source: TelemetrySource,
): Record<string, unknown> {
  return { ...(meta ?? {}), telemetrySource: source };
}

/**
 * Strips `telemetrySource` from a caller's `meta` bag. Pure.
 *
 * The counterpart of `withTelemetrySource`, for the paths where there is no RTU
 * to derive from. `withTelemetrySource` protects an *attached* asset by letting
 * the derived value win the merge; an **unattached** one had no such protection,
 * because the write simply stored `body.meta` as sent. A caller could therefore
 * post `meta: { telemetrySource: "mqtt" }` with `rtuId: null` and hand its
 * points to the ingest host — which has no binding for an RTU-less asset — while
 * `apps/sim` skips exactly the rows marked `mqtt`. The points just stop, and no
 * RTU edit repairs it: `RtusAdminService.update` only touches `rtu_id = $1`.
 *
 * Only this key is removed. `bms.assets.meta` is a shared bag and the rest of it
 * — `telemetryEnabled` among others — is the caller's to set.
 *
 * **`null` in, `null` out, and `undefined` in, `null` out.** The callers store
 * the return value straight into a nullable column, and "no bag" is not "an
 * empty bag": returning `{}` would rewrite every unattached asset's NULL on the
 * first edit that touched it.
 *
 * **The input is never mutated** — a `delete meta.telemetrySource` would edit a
 * bag the caller may still be reading (`existing.meta` is one such row object).
 */
export function omitTelemetrySource(
  meta: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (meta === null || meta === undefined) {
    return null;
  }
  const { telemetrySource: _dropped, ...rest } = meta;
  return rest;
}
