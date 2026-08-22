/**
 * Which PHE RTUs the seed enables for live ingest, and who owns that column
 * afterwards (`F1.7`).
 *
 * Pure and database-free on purpose. `phe-pilot-seed.ts` runs against a live
 * Postgres and nothing tests it; the decision this file makes is the part worth
 * constraining, so it lives here and is tested in
 * `tests/f1.7-ingest-enabled-set.test.ts` with no database at all.
 */

import { createHash } from "node:crypto";

/**
 * The five RTUs enabled for live ingest, measured 2026-08-22.
 *
 * **Two filters, applied in order.** A read-only probe of all twelve topics in
 * `phe-catalog.json` ran for 600 s — ten publish cycles at the fleet's ~60 s
 * cadence. Nine sent 9–10 messages each and three sent nothing in any cycle.
 * Of those nine, four are held back for the reasons below. The full record is
 * `docs/f1.7-fleet-probe.md`.
 *
 * **The criterion is one sentence: an enabled RTU must be better than the
 * simulator it replaces.** Enabling an RTU sets `meta.telemetrySource = 'mqtt'`
 * on its assets and `apps/sim` skips exactly those (ADR 0007 decision 5), so a
 * station that cannot deliver a readable value goes from simulated to **dead**.
 *
 * **Silent — 3.** Nothing on the wire in any of ten cycles:
 * `861736076133666` Banchukamari I, `861736076133757` Banchukamari II,
 * `861736076133609` Bilsi II.
 *
 * **Publishing but not readable — 4.** These pass the first filter and fail the
 * criterion, which the first draft of this list missed:
 *
 * - `861736076081915` Salkumarhat I and `861736076128260` Salkumarhat II —
 *   publish all 27 keys, but 17 carry no reading (`null`, `""` or non-numeric),
 *   and those 17 are the whole Modbus register block. They land 5 of 21 points,
 *   and the missing block includes `s09_r01` → `kw`, which is what
 *   `dashboard.service.ts` counts for `sites_online`. Tracked as `F4.55`.
 * - `861736076128211` Mora Nodir Kuthi II (clock −3:02:36) and
 *   `861736076128245` Bhutnirghat II (−0:21:34) — publish fine, but their rows
 *   land outside every dashboard recency window, so the tiles read offline
 *   whatever the plant is doing. Tracked as `F4.54`.
 *
 * **Re-enabling them is one `UPDATE` and no code change**, because the seed
 * defers to the operator once a row is stamped. `F4.54`'s ingest-side clamp
 * would fix the second pair; the first pair needs a field visit.
 *
 * Re-measure before editing this list. `apps/ingest/scripts/fleet-probe.mjs`
 * repeats the run, and reports `absent=` per topic so the second filter is
 * visible rather than inferred.
 */
export const F1_7_ENABLED_RTU_CODES: readonly string[] = [
  "868019069263896", // Lotapata I
  "861736076080040", // Lotapata II
  "861736076128187", // Mora Nodir Kuthi I
  "861736076116638", // Bilsi I
  "861736076104923", // Bhutnirghat I — the ADR 0007 pilot
];

/**
 * A short digest of the set above, so the two cannot drift apart.
 *
 * **Derived, not written.** The stamp is the only thing that makes an
 * already-seeded database adopt a *changed* set, so a stamp that can stay still
 * while the set moves is the one failure this mechanism must not have. A
 * hand-edited literal has exactly that failure, and it is not theoretical: the
 * review of the first draft proved it by swapping one IMEI for another and
 * watching all 125 tests stay green, which would have left every seeded
 * database on the old set with nothing saying so.
 *
 * Sorted before hashing so a reordering — which is not a change of set — does
 * not force a needless re-adoption.
 */
function digestOfSet(codes: readonly string[]): string {
  return createHash("sha256").update([...codes].sort().join(",")).digest("hex").slice(0, 8);
}

/**
 * Stamped into `bms.rtus.meta` once the set above has been applied to a row.
 *
 * Carries the measurement date for a human and the digest for correctness: the
 * date says when someone last looked, the digest guarantees the stamp moves
 * whenever the set does.
 */
export const ENABLED_SET_VERSION = `f1.7-2026-08-22-${digestOfSet(F1_7_ENABLED_RTU_CODES)}`;

/** What the database already holds for one RTU, or `null` if the seed is inserting it. */
export type ExistingRtuEnabledState = {
  readonly ingestEnabled: boolean;
  /** `meta.enabledSetVersion`, absent on every row written before `F1.7`. */
  readonly enabledSetVersion: string | null;
};

export type ResolveIngestEnabledInput = {
  readonly rtuCode: string;
  readonly existing: ExistingRtuEnabledState | null;
};

export type ResolveIngestEnabledResult = {
  readonly ingestEnabled: boolean;
  /**
   * Why, so the seed can log it and an operator can tell an adoption from an
   * override without reading this file.
   */
  readonly reason: "seeded" | "adopted" | "operator";
};

/**
 * Decides `ingest_enabled` for one RTU on one seed run.
 *
 * **The rule is "assert once, then get out of the way."** Before this, the
 * seed's `ON CONFLICT DO UPDATE SET` carried `ingest_enabled =
 * EXCLUDED.ingest_enabled`, so it re-asserted its own opinion on every run.
 * An operator who switched a flapping station off in the admin RTU screen
 * (`apps/web/src/pages/admin/rtus-page.tsx`) had that reverted by the next
 * `pnpm db:seed` — and CI runs the seed on every PR. At one enabled RTU nobody
 * would ever have noticed; at nine it means the operator's switch does not
 * hold, which is worse than not offering one.
 *
 * Dropping the column from the update instead would have been the opposite
 * failure: correct for the operator, and unable to ever change the set on a
 * database that had already been seeded. The version stamp is what separates
 * "the seed has never said anything about this row" from "the seed said its
 * piece and the row is the operator's now".
 */
export function resolveIngestEnabled(
  input: ResolveIngestEnabledInput,
): ResolveIngestEnabledResult {
  const seeded = F1_7_ENABLED_RTU_CODES.includes(input.rtuCode);

  if (input.existing === null) {
    return { ingestEnabled: seeded, reason: "seeded" };
  }
  if (input.existing.enabledSetVersion !== ENABLED_SET_VERSION) {
    return { ingestEnabled: seeded, reason: "adopted" };
  }
  // Adopted already. The row belongs to whoever is running the plant — in both
  // directions: re-enabling a station they disabled is the defect this closes,
  // and disabling one they enabled would be the same mistake mirrored, since a
  // silent RTU may simply have come back.
  return { ingestEnabled: input.existing.ingestEnabled, reason: "operator" };
}
