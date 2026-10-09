import type { AdminAssetPointDto, POINT_METADATA_FIELDS, PointMetadataFields } from "@bms/shared";

/**
 * ADR 0056 Amendment 3 part A (`F2.25`) — what the Asset Points list shows in
 * its Scale / Range / Quality cells: the value the ingest host applies to a
 * reading, and which part of it came from the asset's pinned template.
 *
 * The API carries the asset's own five and the template's five
 * (`templateDefaults`) side by side; this module is the one place the web
 * combines them, with the host's rule — `coalesce(asset, template)` per field.
 */

export type MetadataField = (typeof POINT_METADATA_FIELDS)[number];

export type EffectivePointMetadata = {
  /** What applies to a reading: the asset's own value, else the template's. */
  readonly value: PointMetadataFields;
  /** `true` only where the asset states nothing and the template states a value. */
  readonly inherited: Readonly<Record<MetadataField, boolean>>;
};

/** The fields each list cell shows, in the cell's order. */
export const SCALE_FIELDS: readonly MetadataField[] = ["scaleMultiplier", "scaleOffset"];
export const RANGE_FIELDS: readonly MetadataField[] = ["engMin", "engMax"];
export const QUALITY_FIELDS: readonly MetadataField[] = ["qualityPolicy"];

type MetadataSource = Pick<AdminAssetPointDto, MetadataField | "templateDefaults">;

/** One field: `??`, never `||` — a stored `0` is a value, not an absence. */
function pick<K extends MetadataField>(
  item: MetadataSource,
  field: K,
): { value: PointMetadataFields[K]; inherited: boolean } {
  const own = item[field];
  const template = item.templateDefaults?.[field] ?? null;
  return { value: own ?? template, inherited: own === null && template !== null };
}

/** The effective five and the inherited flags of one asset point. */
export function effectivePointMetadata(item: MetadataSource): EffectivePointMetadata {
  const scaleMultiplier = pick(item, "scaleMultiplier");
  const scaleOffset = pick(item, "scaleOffset");
  const engMin = pick(item, "engMin");
  const engMax = pick(item, "engMax");
  const qualityPolicy = pick(item, "qualityPolicy");
  return {
    value: {
      scaleMultiplier: scaleMultiplier.value,
      scaleOffset: scaleOffset.value,
      engMin: engMin.value,
      engMax: engMax.value,
      qualityPolicy: qualityPolicy.value,
    },
    inherited: {
      scaleMultiplier: scaleMultiplier.inherited,
      scaleOffset: scaleOffset.inherited,
      engMin: engMin.inherited,
      engMax: engMax.inherited,
      qualityPolicy: qualityPolicy.inherited,
    },
  };
}

/** The fields of one cell whose shown value came from the template. */
export function inheritedFields(
  effective: EffectivePointMetadata,
  fields: readonly MetadataField[],
): MetadataField[] {
  return fields.filter((field) => effective.inherited[field]);
}

/**
 * The marker one cell carries: `"all"` when every value it shows came from the
 * template, `"part"` when some did, `"none"` otherwise (an empty cell too).
 */
export function inheritedParts(
  effective: EffectivePointMetadata,
  fields: readonly MetadataField[],
): "none" | "part" | "all" {
  const shown = fields.filter((field) => effective.value[field] !== null);
  const inherited = inheritedFields(effective, fields);
  if (inherited.length === 0) return "none";
  return inherited.length === shown.length ? "all" : "part";
}

/** `×1.5 +2` — the effective scaling, or a dash where neither side sets one. */
export function scaleCell(value: PointMetadataFields): string {
  const parts: string[] = [];
  if (value.scaleMultiplier !== null) parts.push(`×${value.scaleMultiplier}`);
  if (value.scaleOffset !== null) {
    parts.push(value.scaleOffset < 0 ? `−${Math.abs(value.scaleOffset)}` : `+${value.scaleOffset}`);
  }
  return parts.length > 0 ? parts.join(" ") : "—";
}

/** `0 – 100`, or one bound alone, or a dash. */
export function rangeCell(value: PointMetadataFields): string {
  if (value.engMin !== null && value.engMax !== null) return `${value.engMin} – ${value.engMax}`;
  if (value.engMin !== null) return `≥ ${value.engMin}`;
  if (value.engMax !== null) return `≤ ${value.engMax}`;
  return "—";
}

/** The effective quality policy, or a dash. */
export function qualityCell(value: PointMetadataFields): string {
  return value.qualityPolicy ?? "—";
}
