import type {
  AssetPointCalcOverrideFields,
  TemplateCalcField,
  TemplateMigrationRefusalDto,
  TemplateVersionDeltaDto,
} from "@bms/shared";

/**
 * `F2.6` — what changes between two versions of one template code
 * (ADR 0039 decision 2, "no blind apply").
 *
 * Pure and total: two arrays of stored `template_points` rows in, one delta
 * out. No database, no Nest, no `apps/web` import — the migration service does
 * the reading and the writing, and this decides only what the difference *is*.
 *
 * ## Keyed on `point_key`, never on `template_points.id` (D-4)
 *
 * Every version is a distinct set of rows: `createDraftFrom` copies the points
 * of version N into fresh rows for N+1, so two versions with *identical* point
 * keys share no id at all. An id-keyed diff would report every point as removed
 * and re-added, and decision 3 — which refuses a measured removal — would then
 * refuse every migration that has ever existed. That failure is not subtle in
 * production and is completely invisible in a test whose fixture reuses ids.
 *
 * ## Measured and derived are not symmetric
 *
 * Decision 3: removing or re-keying a *measured* point refuses the migration,
 * because an `asset_points` row is physical wiring that `apps/ingest` and the
 * rule engine read, and no automatic reconciliation of it is honest. Measured
 * *additions* migrate freely (decision 4 creates their rows). Derived changes
 * in every combination migrate freely — a derived point has no wiring to lose.
 *
 * A point that changes `kind` is therefore reported on both sides: a
 * `measured -> derived` flip is a measured removal *and* a derived addition, so
 * it refuses; `derived -> measured` is a derived removal and a measured
 * addition, so it does not. That asymmetry is deliberate and is asserted
 * explicitly in the spec rather than left to fall out of the implementation.
 *
 * ## `minCoverageRatio` is compared, and it is not one of the five (`F2.9`)
 *
 * `CALC_FIELDS` is the five columns an asset may **override**, and ADR 0055
 * decision 11 refuses a per-asset coverage ratio — so `calcFieldsOf` is right
 * to exclude it and the ratio is compared on its own, reported through
 * `changedFields` and through the two `*MinCoverageRatio` fields that sit
 * outside `from`/`to`. Finding 31: before this, a version bump that moved only
 * the ratio produced an empty `derivedChanged`, `migration-preview` reported
 * "no changes", and the migrated asset picked the new ratio up at once — which
 * can move a formula from computing to fail-closed with no operator ever
 * seeing it. Widening `AssetPointCalcOverrideFields` to make the diff
 * symmetrical would have been the tidy version of the same mistake: it claims
 * an override decision 11 forbids.
 *
 * **Still pure, and still blind to any asset.** This function sees two template
 * versions, which is exactly what `migration-preview` has to show. Whether one
 * asset's *override* survives the move is a question about a row this function
 * has never read, and `AssetTemplateMigrationService` answers it with
 * `validateMergedCalcOverride` (`F2.9` Task 12b, refusal
 * `calc_override_invalid_on_target`).
 */

/** The subset of a stored `template_points` row this function reads. */
export interface StoredTemplatePoint {
  pointKey: string;
  kind: string;
  sourceDataKeyPattern: string | null;
  required: boolean;
  /** The template's unit *override*; null means "use the catalog unit". */
  unit: string | null;
  formula: string | null;
  formulaDialect: string | null;
  calcTrigger: string | null;
  calcIntervalSeconds: number | null;
  maxInputAgeSeconds: number | null;
  /**
   * ADR 0055 decision 11 — `null` is **fail closed**: every declared member of
   * a `bms-calc-v2` aggregate must be fresh, not "no limit". Required rather
   * than optional on purpose: an optional field a caller forgot to project
   * compares `undefined` to `undefined`, which is equal, and the ratio change
   * goes unreported exactly as it did before finding 31.
   */
  minCoverageRatio: number | null;
}

export interface TemplateVersionDeltaOptions {
  fromVersion: number;
  toVersion: number;
  /**
   * How many of the selected assets sit on `fromVersion`.
   *
   * Stamped into every refusal so the message can say how much of the estate a
   * refusal is about. The count is the caller's knowledge, not this function's
   * — passing it in is what keeps the diff pure.
   */
  assetCount: number;
}

/**
 * The five columns an asset may override — **not** every member of
 * `TemplateCalcField`, which also names `minCoverageRatio` (decision 11 refuses
 * a per-asset ratio, so there is no `AssetPointCalcOverrideFields` key for it).
 * Typed as `keyof AssetPointCalcOverrideFields` so that stays true by
 * construction rather than by comment.
 *
 * Exported for `AssetTemplateMigrationService`, which asks "does this asset
 * override anything on this point at all" before it re-validates the merge.
 */
export const CALC_FIELDS: readonly (keyof AssetPointCalcOverrideFields)[] = [
  "formula",
  "formulaDialect",
  "calcTrigger",
  "calcIntervalSeconds",
  "maxInputAgeSeconds",
];

/**
 * The five calc columns of one stored row, in the shared DTO shape.
 *
 * Structural in its parameter, and exported, because `template_points` and
 * `asset_points` name these five columns identically and the migration service
 * needs the same shaping for an `asset_points` row. One function, so a template
 * side and an asset side of the same merge cannot be built differently.
 */
export function calcFieldsOf(point: {
  formula: string | null;
  formulaDialect: string | null;
  calcTrigger: string | null;
  calcIntervalSeconds: number | null;
  maxInputAgeSeconds: number | null;
}): AssetPointCalcOverrideFields {
  return {
    formula: point.formula,
    // The DTO narrows these two to their vocabularies. A stored row predating
    // that vocabulary is carried through as-is rather than coerced: the delta
    // reports what the versions hold, and it is `toActiveDefinition` — not
    // this function — that decides an unusable row is a counted skip.
    formulaDialect: point.formulaDialect as AssetPointCalcOverrideFields["formulaDialect"],
    calcTrigger: point.calcTrigger as AssetPointCalcOverrideFields["calcTrigger"],
    calcIntervalSeconds: point.calcIntervalSeconds,
    maxInputAgeSeconds: point.maxInputAgeSeconds,
  };
}

function isDerived(point: StoredTemplatePoint): boolean {
  return point.kind === "derived";
}

/** `point_key` is unique within a template version, so this cannot lose a row. */
function byPointKey(points: readonly StoredTemplatePoint[]): Map<string, StoredTemplatePoint> {
  return new Map(points.map((p) => [p.pointKey, p]));
}

export function computeTemplateVersionDelta(
  fromPoints: readonly StoredTemplatePoint[],
  toPoints: readonly StoredTemplatePoint[],
  options: TemplateVersionDeltaOptions,
): TemplateVersionDeltaDto {
  const from = byPointKey(fromPoints);
  const to = byPointKey(toPoints);

  const delta: TemplateVersionDeltaDto = {
    fromVersion: options.fromVersion,
    toVersion: options.toVersion,
    measuredAdded: [],
    measuredRemoved: [],
    measuredReKeyed: [],
    derivedAdded: [],
    derivedRemoved: [],
    derivedChanged: [],
    refusals: [],
  };

  const refuse = (
    reason: TemplateMigrationRefusalDto["reason"],
    pointKey: string,
    message: string,
  ): void => {
    delta.refusals.push({ reason, pointKey, assetCount: options.assetCount, message });
  };

  // --- present in the source version ---------------------------------------
  for (const [pointKey, before] of from) {
    const after = to.get(pointKey);

    if (after === undefined || isDerived(after) !== isDerived(before)) {
      // Gone, or no longer the same kind of thing. A kind flip is a removal on
      // the old side; the addition is picked up by the second loop below.
      if (isDerived(before)) {
        delta.derivedRemoved.push({ pointKey, from: calcFieldsOf(before) });
      } else {
        delta.measuredRemoved.push({
          pointKey,
          fromSourceDataKeyPattern: before.sourceDataKeyPattern,
          toSourceDataKeyPattern: after?.sourceDataKeyPattern ?? null,
        });
        refuse(
          "measured_removed",
          pointKey,
          after === undefined
            ? `measured point "${pointKey}" exists in version ${options.fromVersion} but not in ` +
                `version ${options.toVersion}. Migration cannot remove a measured point: its ` +
                `asset_points row is physical wiring that ingest and the rule engine read ` +
                `(ADR 0039 decision 3). ${options.assetCount} asset(s) carry it.`
            : `measured point "${pointKey}" becomes derived in version ${options.toVersion}. ` +
                `That destroys the asset_points row ingest writes into, so it is refused for ` +
                `the same reason a removal is (ADR 0039 decision 3). ` +
                `${options.assetCount} asset(s) carry it.`,
        );
      }
      continue;
    }

    if (isDerived(before)) {
      const changedFields: TemplateCalcField[] = CALC_FIELDS.filter(
        (field) => calcFieldsOf(before)[field] !== calcFieldsOf(after)[field],
      );
      // Sixth, and last, so the five keep their existing order in the list an
      // operator reads. Compared on its own because it is a template-only
      // column — see this file's header and decision 11.
      if (before.minCoverageRatio !== after.minCoverageRatio) {
        changedFields.push("minCoverageRatio");
      }
      if (changedFields.length > 0) {
        delta.derivedChanged.push({
          pointKey,
          changedFields,
          from: calcFieldsOf(before),
          to: calcFieldsOf(after),
          fromMinCoverageRatio: before.minCoverageRatio,
          toMinCoverageRatio: after.minCoverageRatio,
        });
      }
      continue;
    }

    if (before.sourceDataKeyPattern !== after.sourceDataKeyPattern) {
      delta.measuredReKeyed.push({
        pointKey,
        fromSourceDataKeyPattern: before.sourceDataKeyPattern,
        toSourceDataKeyPattern: after.sourceDataKeyPattern,
      });
      refuse(
        "measured_rekeyed",
        pointKey,
        `measured point "${pointKey}" changes source_data_key_pattern from ` +
          `${before.sourceDataKeyPattern === null ? "none" : `"${before.sourceDataKeyPattern}"`} to ` +
          `${after.sourceDataKeyPattern === null ? "none" : `"${after.sourceDataKeyPattern}"`}. ` +
          `Migration cannot re-key a measured point — the existing asset_points row already ` +
          `carries the old key and ingest is writing through it (ADR 0039 decision 3). ` +
          `${options.assetCount} asset(s) carry it. Rebuild the assets instead.`,
      );
    }
  }

  // --- present only in the target version -----------------------------------
  for (const [pointKey, after] of to) {
    const before = from.get(pointKey);
    if (before !== undefined && isDerived(before) === isDerived(after)) {
      continue;
    }
    if (isDerived(after)) {
      delta.derivedAdded.push({ pointKey, to: calcFieldsOf(after) });
    } else {
      delta.measuredAdded.push({
        pointKey,
        sourceDataKeyPattern: after.sourceDataKeyPattern,
        required: after.required,
        unit: after.unit,
      });
    }
  }

  return delta;
}
