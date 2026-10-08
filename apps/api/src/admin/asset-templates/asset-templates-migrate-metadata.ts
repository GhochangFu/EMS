import { POINT_METADATA_FIELDS } from "@bms/shared";
import type { TemplateMigrationRefusalDto } from "@bms/shared";

import { findEmptyEngineeringRange } from "../asset-points/point-metadata.schema";
import { pointMetadataOf, type StoredTemplatePoint } from "./template-version-delta";

/**
 * **The stored metadata override, re-validated before the pin moves** (`F2.30`,
 * ADR 0056 decision 2's merged-pair rule on the template side).
 *
 * The asset side already refuses an override whose merge with the *pinned*
 * version's defaults resolves to an empty engineering band (`update` and
 * `bulk-update` in `asset-points.service.ts`). What it cannot see is a later
 * version: `eng_min 150` is legal on a version with no `eng_max`, and a version
 * that sets `eng_max 100` turns the same stored row into a band that admits no
 * reading — the ingest host's range test then discards every sample of the
 * point, silently (ADR 0056 Q2).
 *
 * **Why at migrate, and only there.** A template's points are editable only on
 * a draft, and an asset can be pinned only to a published version, so no
 * template save can change the resolved band of any pinned asset. The new
 * default meets a stored override at exactly one moment: when `migrate` moves
 * `assets.template_id` onto the version that carries it. So the check sits
 * beside `refuseOverridesThatDoNotSurvive` (`F2.9` Task 12b, the calc-override
 * precedent of the same shape), in `buildPlan`, **before the transaction
 * opens** — that service's contract is that every fallible decision is made
 * first, so a refusal moves no pin.
 *
 * **One rule, imported; its own words.** `findEmptyEngineeringRange` is the
 * rule `validateMergedPointMetadata` runs on the asset side; restating it here
 * would be two copies of one rule, which is how two paths drift. The message is
 * this gate's own: the asset side's "state both together, or clear the one this
 * request sets" speaks to a request, and a migrate has none — its repair is the
 * bulk editor, then migrate again. It runs regardless of `active`, for parity
 * with the asset side, which checks every patch.
 *
 * Pure and synchronous: `buildPlan` reads the rows and the target points, and
 * this decides only which of them refuse.
 */

/** The `asset_points` columns this check reads, as `buildPlan` already selects them. */
export type MigratingMetadataRow = {
  readonly sourceKind: string;
  readonly scaleMultiplier: number | null;
  readonly scaleOffset: number | null;
  readonly engMin: number | null;
  readonly engMax: number | null;
  readonly qualityPolicy: string | null;
};

/** One migrating asset and its existing `asset_points` rows, keyed by point key. */
export type MigratingAssetMetadata = {
  readonly assetCode: string;
  readonly rows: ReadonlyMap<string, MigratingMetadataRow>;
};

/** What the `F2.30` gate reads: the migrating assets, the target version, and where refusals go. */
export type MetadataSurvivalInput = {
  /** Every migrating asset with its existing `asset_points` rows. */
  readonly assets: readonly MigratingAssetMetadata[];
  /** The **target** version's points — the defaults the merged pair resolves against. */
  readonly targetPoints: readonly StoredTemplatePoint[];
  /** The target version number, named in every refusal message. */
  readonly targetVersion: number;
  /** `buildPlan`'s own capped collector — the count keeps rising after the list stops. */
  readonly refuse: (refusal: TemplateMigrationRefusalDto) => void;
};

/**
 * Refuses, one refusal per asset and point, every stored metadata override
 * whose merge with the target version's defaults leaves an empty engineering
 * band (`metadata_override_invalid_on_target`).
 *
 * @param input the migrating assets, the target's points and version, and the
 *   collector the refusals go to
 */
export function refuseMetadataOverridesThatDoNotSurvive(input: MetadataSurvivalInput): void {
  const { targetPoints, targetVersion, refuse } = input;
  const measuredByKey = new Map(
    targetPoints.filter((point) => point.kind === "measured").map((point) => [point.pointKey, point]),
  );
  const source = (inherited: boolean): string =>
    inherited ? " (inherited from the template)" : "";

  for (const asset of input.assets) {
    for (const [pointKey, row] of asset.rows) {
      // A `computed` row is calc configuration; it carries no instrument
      // metadata (the asset side refuses the five on one).
      if (row.sourceKind === "computed") continue;
      // Only a point the target declares measured has class defaults to merge
      // with; anything else is the delta's or the calc gate's concern.
      const target = measuredByKey.get(pointKey);
      if (target === undefined) continue;
      // No override at all merges to the target's own pair, which
      // `template_points_eng_range_check` already guarantees. A cost guard.
      if (!POINT_METADATA_FIELDS.some((field) => row[field] !== null)) continue;

      const empty = findEmptyEngineeringRange(pointMetadataOf(row), pointMetadataOf(target));
      if (empty === null) continue;
      refuse({
        reason: "metadata_override_invalid_on_target",
        pointKey,
        assetCount: 1,
        message:
          `Asset "${asset.assetCode}": point "${pointKey}" would have an empty engineering range ` +
          `on version ${targetVersion} — eng_min ${empty.engMin}${source(empty.engMinInherited)}, ` +
          `eng_max ${empty.engMax}${source(empty.engMaxInherited)}. The ingest host would ` +
          "discard every reading of the point. Clear or restate the override on the asset " +
          `(Asset Points, bulk editor), then migrate to version ${targetVersion}.`,
      });
    }
  }
}
