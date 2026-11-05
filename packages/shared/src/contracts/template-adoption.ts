/**
 * `F4.312` (ADR 0109 Amendment 1, rulings A1–A10) — adopting a template-less
 * asset onto one published template version: the request body both routes
 * take, the refusal vocabulary, the per-asset plan, and the preview and
 * result responses.
 *
 * `POST /admin/asset-templates/:id/adoption-preview` writes nothing;
 * `POST /admin/asset-templates/:id/adopt` re-runs the same plan and refuses
 * (409, nothing written) on any refusal — migrate's own guard (owner ruling
 * 1, 2026-11-05). So, like `migrateAssetsBodySchema`, the body has **no**
 * field echoing a preview back: the server decides, from the rows as they
 * stand at apply.
 *
 * The dependency is one-way: this file imports from `./calc-point-writes`
 * only, for the batch cap, and nothing imports back.
 */
import { z } from "zod";

import { CALC_POINT_BATCH_MAX_ASSETS } from "./calc-point-writes";

/**
 * Decision 4: "1–25 template-less assets … all or nothing (A6, the calc
 * batch's bound)". Imported, never restated — the two batches are one bound.
 */
export const TEMPLATE_ADOPTION_MAX_ASSETS = CALC_POINT_BATCH_MAX_ASSETS;

/**
 * The body of both routes. `:id` is the template version to adopt onto.
 *
 * Duplicate ids are refused here rather than collapsed: a batch is "these
 * assets, all or nothing", and a repeated id is a client defect a silent
 * de-duplication would hide.
 */
export const adoptAssetsBodySchema = z
  .object({
    assetIds: z
      .array(z.string().uuid())
      .min(1)
      .max(TEMPLATE_ADOPTION_MAX_ASSETS)
      .refine((ids) => new Set(ids).size === ids.length, {
        message: "Each asset id may appear once.",
      })
      .describe(
        `The template-less assets to pin to this version. Between 1 and ${TEMPLATE_ADOPTION_MAX_ASSETS}, ` +
          "no duplicates. Every id must be inside your writable scope, pinned to no template, and " +
          "of the version's organization and domain.",
      ),
  })
  .strict();

/**
 * Why one asset cannot be adopted. Every refusal names the asset code and,
 * where there is one, the point key (Amendment 1 decision 2).
 */
export const templateAdoptionRefusalReasonSchema = z.enum([
  /** The asset is already pinned to a template version; later changes go through migrate (A7). */
  "already_pinned",
  /** A1 — the asset belongs to another organization than the version. */
  "organization_mismatch",
  /** A1 — the asset's domain differs from the version's. */
  "domain_mismatch",
  /** A4 — a standalone calculated point whose key the version does not declare. */
  "standalone_calc_not_declared",
  /** A8 — an asset point and the version's point of the same key differ in unit (both set). */
  "unit_mismatch",
  /** Decision 2 — a key the version declares derived is held as a measured, manual or unmapped point. */
  "derived_key_held_by_mapping",
  /** Owner ruling 5 — a computed row whose key the version declares measured. */
  "point_key_already_mapped",
  /** A required measured point the asset lacks, whose pattern the asset cannot resolve. */
  "unresolvable_source_data_key",
  /** A new `unmapped` row's source key is held by an existing row, or by a second addition. */
  "source_key_already_used",
  /** Ruling 8 — the standalone formula, as the version's override, fails the override's own checks. */
  "calc_override_invalid_on_target",
  /** A kept row's metadata override, merged over the version's defaults, leaves an empty band. */
  "metadata_override_invalid_on_target",
  /** A rule code the version's alarms would seed on the asset is taken. */
  "rule_code_taken",
  /**
   * A default dashboard slug the version would write for the asset is taken in
   * the organization, or derived twice by the batch (`dashboards_organization_slug_key`).
   */
  "dashboard_slug_taken",
]);

/**
 * One refusal. `pointKey` is null for a refusal about the whole asset
 * (`already_pinned`, the two mismatches, `rule_code_taken`).
 */
export const templateAdoptionRefusalDtoSchema = z.object({
  reason: templateAdoptionRefusalReasonSchema,
  assetId: z.string(),
  assetCode: z.string(),
  pointKey: z.string().nullable(),
  /** Human-readable and specific — it names the asset code and the point key. */
  message: z.string(),
});

/** A measured point the version declares and the asset lacks: an `unmapped` row (A3). */
export const templateAdoptionAddedPointDtoSchema = z.object({
  pointKey: z.string(),
  sourceDataKey: z.string(),
  unit: z.string().nullable(),
});

/**
 * A kept or converted row that will read a value from the version through
 * `coalesce(asset, template)`: `fields` names each column the version sets and
 * the row leaves NULL (instrument metadata for a kept measured row, calc
 * columns for a converted one). Reported, never refused — no ruling covers it
 * yet, so the preview says it and the operator decides.
 */
export const templateAdoptionInheritedDefaultsDtoSchema = z.object({
  pointKey: z.string(),
  fields: z.array(z.string()),
});

/**
 * One asset's plan. `kept` are the existing rows whose key the version
 * declares measured, plus the rows it does not declare (A2); `converted` are
 * the standalone calculated points whose key the version declares derived,
 * which become the asset's override with no row write (ruling 8); `skipped`
 * are optional measured points whose pattern the asset cannot resolve.
 */
export const templateAdoptionAssetPlanDtoSchema = z.object({
  assetId: z.string(),
  assetCode: z.string(),
  assetRtuName: z.string().nullable(),
  assetLocationName: z.string().nullable(),
  assetName: z.string(),
  kept: z.array(z.string()),
  added: z.array(templateAdoptionAddedPointDtoSchema),
  converted: z.array(z.string()),
  skipped: z.array(z.string()),
  inheritsDefaults: z.array(templateAdoptionInheritedDefaultsDtoSchema),
});

/**
 * `POST /admin/asset-templates/:id/adoption-preview`. `refusals` is capped
 * at 50; `refusalCount` is the true total and `canApply` is decided on it,
 * so a preview never disagrees with the apply.
 */
export const templateAdoptionPreviewResponseSchema = z.object({
  templateId: z.string(),
  templateCode: z.string(),
  templateVersion: z.number(),
  assets: z.array(templateAdoptionAssetPlanDtoSchema),
  refusals: z.array(templateAdoptionRefusalDtoSchema),
  refusalCount: z.number(),
  canApply: z.boolean(),
});

/** `POST /admin/asset-templates/:id/adopt` — what one transaction wrote. */
export const templateAdoptionResultResponseSchema = z.object({
  templateId: z.string(),
  templateCode: z.string(),
  templateVersion: z.number(),
  adoptedAssetIds: z.array(z.string()),
  assetCount: z.number(),
  assets: z.array(templateAdoptionAssetPlanDtoSchema),
  pointsCreated: z.number(),
  ruleCount: z.number(),
  dashboardCount: z.number(),
});
