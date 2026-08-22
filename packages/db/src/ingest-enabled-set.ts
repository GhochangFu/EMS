/**
 * Which PHE RTUs the seed enables for live ingest, and who owns that column
 * afterwards (`F1.7`).
 *
 * Pure and database-free on purpose. `phe-pilot-seed.ts` runs against a live
 * Postgres and nothing tests it; the decision this file makes is the part worth
 * constraining, so it lives here and is tested in
 * `tests/f1.7-ingest-enabled-set.test.ts` with no database at all.
 */

/**
 * The nine RTUs measured publishing on 2026-08-22.
 *
 * **Measured, not chosen.** A read-only probe of all twelve topics in
 * `phe-catalog.json` ran for 600 s — ten publish cycles at the fleet's ~60 s
 * cadence — and these nine sent 9–10 messages each while three sent nothing in
 * any cycle. The full record is `docs/f1.7-fleet-probe.md`.
 *
 * The three silent ones are deliberately absent, and that is not caution for
 * its own sake: the seed sets `meta.telemetrySource = 'mqtt'` on an enabled
 * RTU's assets, and `apps/sim` skips exactly those. Enabling a station that
 * does not publish therefore takes its 88 points from simulated to **dead**,
 * which is worse than leaving it on catalog data.
 *
 * Re-measure before editing this list. `apps/ingest/scripts/fleet-probe.mjs`
 * repeats the run.
 */
export const F1_7_ENABLED_RTU_CODES: readonly string[] = [
  "868019069263896", // Lotapata I
  "861736076080040", // Lotapata II
  "861736076128187", // Mora Nodir Kuthi I
  "861736076128211", // Mora Nodir Kuthi II
  "861736076116638", // Bilsi I
  "861736076104923", // Bhutnirghat I — the ADR 0007 pilot
  "861736076128245", // Bhutnirghat II
  "861736076081915", // Salkumarhat I
  "861736076128260", // Salkumarhat II
];

/**
 * Stamped into `bms.rtus.meta` once the set above has been applied to a row.
 *
 * **Carries the measurement date, so changing the set changes the stamp.** A
 * constant like `"v1"` would make adoption a one-time event for all time: a
 * later set would never reach an already-seeded database, and the fleet would
 * stay as it was with nothing saying so.
 */
export const ENABLED_SET_VERSION = "f1.7-2026-08-22";

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
