/**
 * `F2.6` template version lifecycle (ADR 0039) — the response types, each
 * `z.infer`red from its schema in `../contracts/` (ADR 0030 decision 2).
 *
 * Moved out of `index.ts` (which re-exports this file) to keep that file under
 * the AGENTS.md §4.5 cap. `tests/adr-0030-contract-derivation.test.ts` scans
 * every file in this directory under the same no-hand-written-type rule.
 */
import type { z } from "zod";

import type * as AT from "../contracts/asset-templates";
import type * as TM from "../contracts/template-migration";

/** The five calc columns — the same shape as template value, override and effective. */
export type AssetPointCalcOverrideFields = z.infer<
  typeof AT.assetPointCalcOverrideFieldsSchema
>;
/** One derived point of one asset: template, override and resolved values. */
export type AssetPointCalcConfigDto = z.infer<typeof AT.assetPointCalcConfigDtoSchema>;
/** One version of a template code, with how much of the estate sits on it. */
export type TemplateVersionSummaryDto = z.infer<typeof TM.templateVersionSummaryDtoSchema>;
export type TemplateMigrationRefusalReason = z.infer<
  typeof TM.templateMigrationRefusalReasonSchema
>;
export type TemplateMigrationRefusalDto = z.infer<
  typeof TM.templateMigrationRefusalDtoSchema
>;
export type TemplateMeasuredAdditionDto = z.infer<
  typeof TM.templateMeasuredAdditionDtoSchema
>;
export type TemplateMeasuredChangeDto = z.infer<typeof TM.templateMeasuredChangeDtoSchema>;
/** Which of the five calc fields moved between two versions. */
export type TemplateCalcField = z.infer<typeof TM.templateCalcFieldSchema>;
export type TemplateDerivedChangeDto = z.infer<typeof TM.templateDerivedChangeDtoSchema>;
export type TemplateDerivedAdditionDto = z.infer<typeof TM.templateDerivedAdditionDtoSchema>;
export type TemplateDerivedRemovalDto = z.infer<typeof TM.templateDerivedRemovalDtoSchema>;
/** Keyed on `point_key` throughout, never on `template_points.id` (D-4). */
export type TemplateMeasuredMetadataChangeDto = z.infer<
  typeof TM.templateMeasuredMetadataChangeDtoSchema
>;
export type TemplateVersionDeltaDto = z.infer<typeof TM.templateVersionDeltaDtoSchema>;
export type TemplateMigrationAssetDto = z.infer<typeof TM.templateMigrationAssetDtoSchema>;
export type TemplateMigrationSkippedPointDto = z.infer<
  typeof TM.templateMigrationSkippedPointDtoSchema
>;
