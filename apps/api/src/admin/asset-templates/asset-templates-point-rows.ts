import type { templatePoints } from "@bms/db";
import type { AdminTemplatePointDto, CalcDialect, CalcTrigger, QualityPolicy, TemplatePointKind } from "@bms/shared";

import type { TemplatePointBody } from "./asset-templates.schema";

/**
 * `template_points` row mappers — the DTO a stored row becomes, and the insert
 * a body (or a parent version's row) becomes.
 *
 * Pulled out of `AssetTemplatesAdminService` by `F2.7` (plan design decision
 * 11): that service sat at 998 of AGENTS.md §4.5's 1000 lines, and the five
 * point-metadata fields ADR 0056 decision 1 adds had to land in exactly the two
 * mappers it held inline. Pure functions, no IO, spec'd whole-object so the
 * move is provably a move (`asset-templates-point-rows.spec.ts`).
 *
 * **The five metadata fields, now read and written off the row (Unit B).**
 * Migration `0063` gives both tables the columns and `TemplatePointRow`
 * carries them as `number | string | null`; `toTemplatePointDto` reads them
 * straight off the row (narrowing `qualityPolicy` to `QualityPolicy | null`,
 * the way `formulaDialect`/`calcTrigger` already narrow their own varchar
 * columns). `toTemplatePointInsert`'s `point` parameter is intersected with
 * `PointMetadataOverrides` — a widened, all-optional shape typed on the raw
 * `string | null` the column actually is, not the narrower `PointMetadataFields`
 * from `@bms/shared` — rather than widened on `TemplatePointBody` itself,
 * because the write-side schema (`templatePointBodySchema`) does not gain the
 * five until Unit C2 of the same plan: until then a parsed body simply has no
 * such keys, and `?? null` reads that absence the same way it reads an
 * explicit `null`.
 */

/** One stored `template_points` row, as drizzle selects it. */
export type TemplatePointRow = typeof templatePoints.$inferSelect;

/** One `template_points` insert, as drizzle accepts it. */
export type TemplatePointInsert = typeof templatePoints.$inferInsert;

/**
 * The five metadata fields, optional and typed on the raw column shape
 * (`qualityPolicy: string | null`, not `QualityPolicy | null`) so this
 * intersects cleanly with `TemplatePointRow`, whose own `quality_policy`
 * column is an unnarrowed varchar — the same reason `toTemplatePointDto`
 * below casts it to `QualityPolicy | null` only on the way out to the DTO.
 */
type PointMetadataOverrides = {
  scaleMultiplier?: number | null;
  scaleOffset?: number | null;
  engMin?: number | null;
  engMax?: number | null;
  qualityPolicy?: string | null;
};

/**
 * The insert `replacePoints` writes for one point of a draft.
 *
 * `point` is a request body **or** a parent version's stored row —
 * `createDraftFrom` copies the parent's `PointRow`s through here — so every
 * field is re-stamped with `??` onto its column default. `sortOrder ?? index`
 * keeps the array order when a body omits it; `meta ?? {}` matches the jsonb
 * column's own default for a point with no provenance (`F2.13`, ADR 0052
 * decision 2). `minCoverageRatio` is re-stamped like every other field, and
 * the version bump is why: omitting it would silently reset a published ratio
 * to `NULL` on the next version, which ADR 0055 decision 11 reads as fail
 * closed — the formula stops computing with no error and no edit.
 *
 * `organizationId` is the parent template's org (`E7.1b`): every
 * `template_points` write stamps it so `0047`'s `WITH CHECK` accepts the row.
 */
export function toTemplatePointInsert(
  point: (TemplatePointBody | TemplatePointRow) & PointMetadataOverrides,
  templateId: string,
  organizationId: string,
  index: number,
): TemplatePointInsert {
  return {
    templateId,
    organizationId,
    pointKey: point.pointKey,
    label: point.label ?? null,
    unit: point.unit ?? null,
    kind: point.kind ?? "measured",
    sourceDataKeyPattern: point.sourceDataKeyPattern ?? null,
    formula: point.formula ?? null,
    formulaDialect: point.formulaDialect ?? null,
    calcTrigger: point.calcTrigger ?? null,
    calcIntervalSeconds: point.calcIntervalSeconds ?? null,
    maxInputAgeSeconds: point.maxInputAgeSeconds ?? null,
    minCoverageRatio: point.minCoverageRatio ?? null,
    required: point.required ?? true,
    sortOrder: point.sortOrder ?? index,
    meta: point.meta ?? {},
    // ADR 0056 decision 1 — `null` = inherit / today's behaviour. `?? null`
    // reads an absent key (a body Zod has not yet been taught to carry, Unit
    // C2) the same way it reads an explicit `null` (a parent row's own
    // uninherited value).
    scaleMultiplier: point.scaleMultiplier ?? null,
    scaleOffset: point.scaleOffset ?? null,
    engMin: point.engMin ?? null,
    engMax: point.engMax ?? null,
    qualityPolicy: point.qualityPolicy ?? null,
  };
}

/**
 * The DTO one stored row becomes. Straight off the row: `template_points` has
 * no override to coalesce against — the asset side does that. `meta` is jsonb
 * and is cast rather than trusted, the same reason the service casts `content`.
 */
export function toTemplatePointDto(point: TemplatePointRow): AdminTemplatePointDto {
  return {
    id: point.id,
    templateId: point.templateId,
    pointKey: point.pointKey,
    label: point.label,
    unit: point.unit,
    kind: point.kind as TemplatePointKind,
    sourceDataKeyPattern: point.sourceDataKeyPattern,
    formula: point.formula,
    formulaDialect: point.formulaDialect as CalcDialect | null,
    calcTrigger: point.calcTrigger as CalcTrigger | null,
    calcIntervalSeconds: point.calcIntervalSeconds,
    maxInputAgeSeconds: point.maxInputAgeSeconds,
    // ADR 0055 decision 11 (`F2.9`). `null` means fail closed, not "no limit".
    minCoverageRatio: point.minCoverageRatio,
    required: point.required,
    sortOrder: point.sortOrder,
    meta: point.meta as AdminTemplatePointDto["meta"],
    createdAt: point.createdAt.toISOString(),
    // ADR 0056 decision 1 — `null` = inherit / today's behaviour. Read
    // straight off the row.
    scaleMultiplier: point.scaleMultiplier,
    scaleOffset: point.scaleOffset,
    engMin: point.engMin,
    engMax: point.engMax,
    qualityPolicy: point.qualityPolicy as QualityPolicy | null,
  };
}
