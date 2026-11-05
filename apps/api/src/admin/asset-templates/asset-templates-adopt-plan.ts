import { POINT_METADATA_FIELDS } from "@bms/shared";
import type {
  TemplateAdoptionAddedPointDto,
  TemplateAdoptionAssetPlanDto,
  TemplateAdoptionInheritedDefaultsDto,
  TemplateAdoptionRefusalDto,
} from "@bms/shared";

import { SOURCE_DATA_KEY_MAX_LENGTH } from "../../calc/computed-source-data-key";
import {
  resolveAdditionSourceDataKey,
  unresolvableAdditionMessage,
} from "./asset-templates-migrate-source-key";
import { CALC_FIELDS, type StoredTemplatePoint } from "./template-version-delta";

/**
 * `F4.312` (ADR 0109 Amendment 1; plan task 1.5) — the pure half of adoption:
 * what one template version does to each selected template-less asset, and
 * every refusal, before anything is read for the gates or written.
 *
 * No database, no clock, no access check: `AssetTemplateAdoptionService`
 * reads the assets, their rows, the version and the catalog units, hands them
 * here, and runs the two override gates and the rule-code check after. So
 * every rule below is unit-testable on its own.
 *
 * ## The rules, in order
 *
 * Per asset, first the three about the whole asset; any one ends the asset's
 * plan, because a point-by-point list for an asset that cannot be adopted at
 * all is noise:
 * 1. `assets.template_id` is set → `already_pinned` (A7: later changes go
 *    through migrate).
 * 2. another organization → `organization_mismatch` (A1).
 * 3. another domain → `domain_mismatch` (A1).
 *
 * Then per declared point of the version, against the asset's row of the same
 * key:
 * - **measured, `computed` row** → `point_key_already_mapped` (owner ruling
 *   5): reusing calc configuration as telemetry wiring would repoint a formula
 *   onto ingest values.
 * - **measured, any other row** → `kept` (decision 1: wiring, source key, RTU
 *   and history stay), then the unit check.
 * - **derived, `computed` row** → `converted`: the standalone formula becomes
 *   the asset's override of the derived point with no row write (ruling 8),
 *   then the unit check.
 * - **derived, any other row** → `derived_key_held_by_mapping` (decision 2).
 * - **measured, no row** → `added` as an `unmapped` row (A3) with the source
 *   key resolved exactly as migrate resolves an addition; an unresolvable
 *   required point refuses (`unresolvable_source_data_key`), an optional one
 *   is `skipped`; a key over the column's 128 refuses.
 * - **derived, no row** → nothing: it reaches the asset through the pin.
 *
 * **The unit check (A8, owner ruling 3).** Refused only when the row's unit
 * and the version's unit (the template override, else the catalog's) are
 * **both** set and differ. A blank unit — NULL, empty or whitespace, on either
 * side — is not a mismatch, and the row's unit is never rewritten.
 *
 * **Inherited defaults (reported, not refused).** A kept measured row reads the
 * version's instrument metadata, and a converted row the version's calc
 * columns, through `coalesce(asset, template)` wherever the row is NULL — the
 * ingest host's bindings and `CalcDefinitionsService` both merge that way. No
 * ruling covers it, so each such row is listed in `inheritsDefaults` with the
 * field names the version sets and the row leaves NULL.
 *
 * Then every addition's source key, against every existing row of the asset
 * and against the other additions: `asset_points_asset_source_key_idx` makes
 * `(asset_id, source_data_key)` unique, so a clash is `source_key_already_used`
 * here rather than a 23505 inside the transaction.
 *
 * Last, every row whose key the version does not declare: a `computed` one is
 * `standalone_calc_not_declared` (A4 — the engine would stop reading it once
 * the pin moves), anything else is `kept` (A2).
 *
 * Every message names the asset code and, where there is one, the point key.
 */

/** One selected asset, as the service reads it. */
export type AdoptionAsset = {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly organizationId: string;
  readonly domain: string;
  readonly templateId: string | null;
  readonly sourceDataKeyVars: Readonly<Record<string, string>> | null;
};

/**
 * The `asset_points` columns the planner reads: identity, unit, and the ten
 * coalesced columns `inheritsDefaults` compares against the version.
 */
export type AdoptionExistingRow = {
  readonly pointKey: string;
  readonly sourceKind: string;
  readonly sourceDataKey: string;
  readonly unit: string | null;
  readonly formula: string | null;
  readonly formulaDialect: string | null;
  readonly calcTrigger: string | null;
  readonly calcIntervalSeconds: number | null;
  readonly maxInputAgeSeconds: number | null;
  readonly scaleMultiplier: number | null;
  readonly scaleOffset: number | null;
  readonly engMin: number | null;
  readonly engMax: number | null;
  readonly qualityPolicy: string | null;
};

/** The version adopted onto. */
export type AdoptionTarget = {
  readonly id: string;
  readonly code: string;
  readonly version: number;
  readonly organizationId: string;
  readonly domain: string;
};

/**
 * Everything `planAdoption` reads — the version, its points and catalog units,
 * each selected asset with its existing rows — and where refusals go. Built by
 * `AssetTemplateAdoptionService.buildPlan` from fleet reads; pure here.
 */
export type AdoptionPlanInput = {
  readonly target: AdoptionTarget;
  /** The version's points, as `loadPoints` reads them. */
  readonly points: readonly StoredTemplatePoint[];
  /** Catalog unit by point key, as `catalogUnits` reads it (an inactive key still resolves). */
  readonly catalogUnits: ReadonlyMap<string, string | null>;
  /** Each selected asset with its existing rows, in request order. */
  readonly assets: readonly {
    readonly asset: AdoptionAsset;
    readonly rows: readonly AdoptionExistingRow[];
  }[];
  /** The service's capped collector; the count keeps rising after the list stops. */
  readonly refuse: (refusal: TemplateAdoptionRefusalDto) => void;
};

/** One asset's plan, and whether the asset-level checks passed. */
export type PlannedAdoption = {
  readonly dto: TemplateAdoptionAssetPlanDto;
  /**
   * False when a whole-asset refusal ended the plan (pinned, organization,
   * domain). The service runs the override gates and the rule-code check on
   * eligible assets only, for the reason the plan stops early.
   */
  readonly eligible: boolean;
};

const SOURCE_DATA_KEY_MAX = SOURCE_DATA_KEY_MAX_LENGTH;

/**
 * Plans adoption for every asset of the batch, in request order.
 *
 * @param input the version, its points and catalog units, the assets with
 *   their rows, and the collector refusals go to
 */
export function planAdoption(input: AdoptionPlanInput): PlannedAdoption[] {
  return input.assets.map(({ asset, rows }) => planOne(input, asset, rows));
}

function planOne(
  input: AdoptionPlanInput,
  asset: AdoptionAsset,
  rows: readonly AdoptionExistingRow[],
): PlannedAdoption {
  const { target } = input;
  const dto = {
    assetId: asset.id,
    assetCode: asset.code,
    assetName: asset.name,
    kept: [] as string[],
    added: [] as TemplateAdoptionAddedPointDto[],
    converted: [] as string[],
    skipped: [] as string[],
    inheritsDefaults: [] as TemplateAdoptionInheritedDefaultsDto[],
  };
  const refuse = (
    reason: TemplateAdoptionRefusalDto["reason"],
    pointKey: string | null,
    message: string,
  ): void => input.refuse({ reason, assetId: asset.id, assetCode: asset.code, pointKey, message });
  const label = `Asset "${asset.code}"`;
  const versionLabel = `"${target.code}" v${target.version}`;

  if (asset.templateId !== null) {
    refuse(
      "already_pinned",
      null,
      `${label} is already pinned to a template version, so there is nothing to adopt. ` +
        "Adoption is for an asset built without a template; move a pinned asset between " +
        "versions with migrate.",
    );
    return { dto, eligible: false };
  }
  if (asset.organizationId !== target.organizationId) {
    refuse(
      "organization_mismatch",
      null,
      `${label} belongs to another organization than template ${versionLabel}. An asset ` +
        "adopts a version of its own organization only.",
    );
    return { dto, eligible: false };
  }
  if (asset.domain !== target.domain) {
    refuse(
      "domain_mismatch",
      null,
      `${label} has domain "${asset.domain}" and template ${versionLabel} declares ` +
        `"${target.domain}". An asset adopts a version of its own domain only.`,
    );
    return { dto, eligible: false };
  }

  const rowByKey = new Map(rows.map((row) => [row.pointKey, row]));
  const declared = new Set(input.points.map((point) => point.pointKey));

  const checkUnit = (point: StoredTemplatePoint, row: AdoptionExistingRow): void => {
    const versionUnit = blankToNull(point.unit) ?? blankToNull(input.catalogUnits.get(point.pointKey));
    const rowUnit = blankToNull(row.unit);
    if (rowUnit === null || versionUnit === null || rowUnit === versionUnit) {
      return;
    }
    refuse(
      "unit_mismatch",
      point.pointKey,
      `${label}: point "${point.pointKey}" is in "${row.unit}" on the asset and in ` +
        `"${versionUnit}" on template ${versionLabel}. Adoption does not rewrite a unit; ` +
        "correct the asset's point or the template, then adopt.",
    );
  };

  for (const point of input.points) {
    const row = rowByKey.get(point.pointKey);
    if (point.kind === "measured") {
      if (row?.sourceKind === "computed") {
        refuse(
          "point_key_already_mapped",
          point.pointKey,
          `${label}: template ${versionLabel} declares "${point.pointKey}" as a measured ` +
            "point, but this asset holds it as a calculated point. That row is calc " +
            "configuration, and reusing it as telemetry wiring would repoint a formula onto " +
            "ingest values. Delete the calculated point, or declare the key derived, first.",
        );
        continue;
      }
      if (row !== undefined) {
        dto.kept.push(point.pointKey);
        checkUnit(point, row);
        reportInherited(dto.inheritsDefaults, point, row, POINT_METADATA_FIELDS);
        continue;
      }
      planAddition(input, asset, point, dto, refuse, label);
      continue;
    }

    // Derived.
    if (row === undefined) {
      continue;
    }
    if (row.sourceKind === "computed") {
      dto.converted.push(point.pointKey);
      checkUnit(point, row);
      reportInherited(dto.inheritsDefaults, point, row, CALC_FIELDS);
      continue;
    }
    refuse(
      "derived_key_held_by_mapping",
      point.pointKey,
      `${label}: template ${versionLabel} declares "${point.pointKey}" as a derived point, ` +
        `but this asset holds it as a ${row.sourceKind} point. A derived point is computed, ` +
        "not wired; remove or re-key the asset's point first.",
    );
  }

  refuseSourceKeyClashes(dto.added, rows, refuse, label);

  for (const row of rows) {
    if (declared.has(row.pointKey)) {
      continue;
    }
    if (row.sourceKind === "computed") {
      refuse(
        "standalone_calc_not_declared",
        row.pointKey,
        `${label}: its calculated point "${row.pointKey}" is not declared by template ` +
          `${versionLabel}, and the engine would stop computing it once the asset is pinned. ` +
          "Delete it, or add the key to the template as a derived point, first.",
      );
      continue;
    }
    dto.kept.push(row.pointKey);
  }

  return { dto, eligible: true };
}

/** NULL, empty and whitespace-only all mean "no unit" (owner ruling 3). */
function blankToNull(unit: string | null | undefined): string | null {
  return unit === null || unit === undefined || unit.trim() === "" ? null : unit;
}

type CoalescedField = (typeof CALC_FIELDS)[number] | (typeof POINT_METADATA_FIELDS)[number];

/** Lists the fields the version sets and the row leaves NULL, when there are any. */
function reportInherited(
  into: TemplateAdoptionInheritedDefaultsDto[],
  point: StoredTemplatePoint,
  row: AdoptionExistingRow,
  fields: readonly CoalescedField[],
): void {
  const inherited = fields.filter((field) => row[field] === null && point[field] !== null);
  if (inherited.length > 0) {
    into.push({ pointKey: point.pointKey, fields: [...inherited] });
  }
}

/** A measured point the asset lacks: an `unmapped` row, a skip, or a refusal. */
function planAddition(
  input: AdoptionPlanInput,
  asset: AdoptionAsset,
  point: StoredTemplatePoint,
  dto: { added: TemplateAdoptionAddedPointDto[]; skipped: string[] },
  refuse: (reason: TemplateAdoptionRefusalDto["reason"], pointKey: string, message: string) => void,
  label: string,
): void {
  const resolved = resolveAdditionSourceDataKey(
    point.sourceDataKeyPattern,
    asset.code,
    asset.sourceDataKeyVars,
  );
  if (!resolved.ok) {
    if (point.required) {
      refuse(
        "unresolvable_source_data_key",
        point.pointKey,
        unresolvableAdditionMessage({
          assetCode: asset.code,
          pointKey: point.pointKey,
          pattern: point.sourceDataKeyPattern,
          unresolved: resolved.unresolved,
          storedVars: asset.sourceDataKeyVars,
          operation: "adopt",
        }),
      );
      return;
    }
    dto.skipped.push(point.pointKey);
    return;
  }
  if (resolved.sourceDataKey.length > SOURCE_DATA_KEY_MAX) {
    refuse(
      "unresolvable_source_data_key",
      point.pointKey,
      `${label}: point "${point.pointKey}" resolves to a source data key of ` +
        `${resolved.sourceDataKey.length} characters, over the ${SOURCE_DATA_KEY_MAX} limit.`,
    );
    return;
  }
  dto.added.push({
    pointKey: point.pointKey,
    sourceDataKey: resolved.sourceDataKey,
    // Instantiate's and migrate's resolution: the template's unit is an
    // override, and null means "use the catalog's".
    unit: point.unit ?? input.catalogUnits.get(point.pointKey) ?? null,
  });
}

/**
 * `(asset_id, source_data_key)` is unique: an addition whose key an existing
 * row holds, or a second addition resolving to the same key, refuses by name.
 */
function refuseSourceKeyClashes(
  added: readonly TemplateAdoptionAddedPointDto[],
  rows: readonly AdoptionExistingRow[],
  refuse: (reason: TemplateAdoptionRefusalDto["reason"], pointKey: string, message: string) => void,
  label: string,
): void {
  const holderBySourceKey = new Map(rows.map((row) => [row.sourceDataKey, row.pointKey]));
  const firstAdditionBySourceKey = new Map<string, string>();
  for (const point of added) {
    const holder = holderBySourceKey.get(point.sourceDataKey);
    const earlier = firstAdditionBySourceKey.get(point.sourceDataKey);
    if (holder !== undefined) {
      refuse(
        "source_key_already_used",
        point.pointKey,
        `${label}: the new point "${point.pointKey}" resolves to source key ` +
          `"${point.sourceDataKey}", which point "${holder}" on this asset already reads (one ` +
          "source key maps to one point per asset). Re-key one of them first.",
      );
    } else if (earlier !== undefined) {
      refuse(
        "source_key_already_used",
        point.pointKey,
        `${label}: the new points "${earlier}" and "${point.pointKey}" both resolve to source ` +
          `key "${point.sourceDataKey}" (one source key maps to one point per asset). Give one ` +
          "of them a different source key pattern in the template.",
      );
    }
    if (earlier === undefined) {
      firstAdditionBySourceKey.set(point.sourceDataKey, point.pointKey);
    }
  }
}
