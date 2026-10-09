/**
 * Template version migration contracts (ADR 0039 decision 8; `F2.5`, `F2.9`,
 * `F2.24`, `F2.30`) — the Versions view's summary, the version delta, the
 * refusal vocabulary and the per-asset migration rows.
 *
 * Moved out of `admin.ts` whole when it reached 998 lines (AGENTS.md §4.5).
 * The dependency is one-way: this file imports from `./admin`, and `admin.ts`
 * must never import back.
 */
import { z } from "zod";

import { assetPointCalcOverrideFieldsSchema, assetTemplateStatusSchema } from "./admin";
import { pointMetadataFieldNameSchema, pointMetadataFieldsSchema } from "./point-metadata";

/**
 * One version of a template code, for the Versions view `F2.5`'s detail page
 * gains (ADR 0039 decision 8).
 *
 * `assetCount` is what makes the view worth having: it says how much of the
 * estate is still on this version, which is the question a migration answers.
 */
export const templateVersionSummaryDtoSchema = z.object({
  id: z.string(),
  version: z.number(),
  status: assetTemplateStatusSchema,
  publishedAt: z.string().nullable(),
  assetCount: z.number(),
  pointCount: z.number(),
});

/**
 * Why a migration cannot proceed.
 *
 * `pointKey` is nullable because not every refusal is about a point — a target
 * version whose `domain` differs from the source's refuses the whole migration
 * (Q-B, ruled 2026-08-22) and names two domain codes instead.
 */
export const templateMigrationRefusalReasonSchema = z.enum([
  /** Decision 3 — a measured point present in the source version is gone from the target. */
  "measured_removed",
  /** Decision 3 — a measured point's `source_data_key_pattern` changed. */
  "measured_rekeyed",
  /**
   * Q-A (ADR 0039 Amendment 1 decision 5) — a required measured addition's
   * pattern uses a token the asset does not store (neither `asset_code` nor a
   * key of `bms.assets.source_data_key_vars`).
   */
  "unresolvable_source_data_key",
  /** Q-B — the target version declares a different plant domain. */
  "domain_changed",
  /**
   * The asset already has an `asset_points` row for a point key the target
   * version adds as measured.
   *
   * Three things create that row and none of them knows about the others: a
   * hand-made mapping, `CalcWriteService` on a derived point's first computed
   * value, and — since ADR 0039 decision 7 — the calc override endpoint. So a
   * version that turns a derived point into a measured one collides with a row
   * the operator never thinks of as a mapping.
   *
   * Refused rather than merged: the existing row may be `computed` wiring for a
   * formula, and quietly turning it into telemetry wiring (or leaving it in
   * place and reporting the point as created) is the "wrong number, quietly"
   * class this feature is built to avoid.
   */
  "point_key_already_mapped",
  /**
   * `F4.216` — a new measured point's resolved `source_data_key` is already
   * held on the asset by another row, or by a second addition of the version.
   *
   * `asset_points_asset_source_key_idx` (migration 0015) makes
   * `(asset_id, source_data_key)` unique: one source key feeds one point per
   * asset. Without this refusal the insert raised 23505 inside the transaction
   * and the route answered 500. Refused rather than re-pointed: which of the
   * two points the key really belongs to is the operator's call.
   */
  "source_key_already_used",
  /**
   * `F2.9` — the asset's own calc override, merged over the **target**
   * version's declaration of the same derived point, is not a pair this engine
   * will run (findings 31 and 34; ADR 0039 decision 2, "no blind apply").
   *
   * ## The same rules as two of the override endpoint's three gates, deliberately
   *
   * This one reason covers **two of that endpoint's three gates**, because both
   * are "the merged pair does not survive the move" and an operator acts on
   * either the same way — correct or clear the override, then migrate.
   * `AssetTemplateMigrationService` runs `validateMergedCalcOverride`, the one
   * pure function `PUT /admin/assets/:id/calc-points/:key` validates with, and
   * `CalcDependencyService.checkCandidate`, the save-time cycle detector that
   * endpoint also runs. The endpoint's third gate — `unresolvedQualifiedCodes`
   * (`F2.22` item 9) — is the endpoint's alone: an asset deleted after a save is
   * ADR 0055 decision 8's evaluation-time case, counted as
   * `unknown_asset_reference` rather than refused, and refusing a migrate for it
   * would strand the asset (`asset-templates-migrate-calc.ts` docblock). An
   * override states only the columns it sets and
   * inherits the rest, so a new version can turn a pair that was legal when it
   * was written into one that is not: a legal dialect-only `bms-calc-v1`
   * override plus a target version whose formula is `bms-calc-v2` merges to a
   * `v2` formula wearing a `v1` label, which is a formula no dialect gate reads
   * correctly. Two implementations of one rule is how two paths drift apart, so
   * both are imported rather than restated.
   *
   * **The claim is parity on the two shared gates, and only that.** Both
   * resolve against the estate as it stands, exactly as the endpoint resolves
   * them, so a merged pair migrate admits is one that endpoint would admit at
   * this instant — with the one exception the third gate carries: a `v2`
   * formula whose qualified code resolves to no active asset at the asset’s own
   * location, which the endpoint refuses and migrate admits, counted instead
   * as `unknown_asset_reference`. Beyond that exception it is
   * not a promise that the post-migration graph is acyclic: definitions resolve
   * through each asset's *current* pin, so the target version's own derived
   * points join the graph only once the pin moves. ADR 0055 decision 8 puts
   * that authority on the tick, which refuses such a formula as
   * `dependency_cycle` — counted, and reported on the asset's own page.
   *
   * ## Why it is checked at migrate and not inside the delta
   *
   * `computeTemplateVersionDelta` is pure over two arrays of *template* points.
   * It has no asset and no override, and `migration-preview` computes it from
   * exactly those two inputs — giving it an asset would make it impure and
   * would stop matching the preview's own inputs. The delta reports what the
   * two versions say; this refusal is about what one asset's stored row means
   * once the pin moves, which only the service can see.
   */
  "calc_override_invalid_on_target",
  /**
   * `F2.30` (ADR 0056 decision 2's merged-pair rule, template side) — the
   * asset's own instrument-metadata override, merged per column over the
   * **target** version's class defaults for the same measured point, resolves
   * to a band that admits no reading (`eng_min >= eng_max`).
   *
   * The same rule (`findEmptyEngineeringRange`) the asset-side `update` and
   * `bulk-update` run through `validateMergedPointMetadata`, imported rather
   * than restated; the message is this refusal's own, because the asset
   * side's wording speaks to a request a migrate has not got. Checked **at migrate**,
   * because that is the one moment a class default meets a stored override: a
   * template's points are editable only on a draft, and no asset can be pinned
   * to a draft, so no template save can change any pinned asset's resolved
   * band. Not inside the delta, for the reason `calc_override_invalid_on_target`
   * is not: the delta is pure over two template versions and never reads an
   * override row. Refused rather than applied, because a pin that moved would
   * make the ingest host discard every sample of the point until the override
   * is repaired. The operator clears or restates the override on the asset
   * (Asset Points, bulk editor), then migrates.
   */
  "metadata_override_invalid_on_target",
]);

export const templateMigrationRefusalDtoSchema = z.object({
  reason: templateMigrationRefusalReasonSchema,
  pointKey: z.string().nullable(),
  /** How many of the selected assets this refusal affects. */
  assetCount: z.number(),
  /** Human-readable and specific — it names the point, the codes or the tokens. */
  message: z.string(),
});

/**
 * A measured point the target version adds; migration creates its
 * `asset_points` row.
 *
 * `unit` is the template's *override*, not the catalog's unit — null means
 * "use the catalog's", exactly as `adminTemplatePointDtoSchema.unit` does. It
 * is carried here because decision 4 says these rows are created "by the same
 * path instantiation uses", and instantiation resolves
 * `point.unit ?? catalogUnit ?? null`. Dropping it would give the same point on
 * the same template two different units depending on whether the asset was
 * instantiated or migrated.
 */
export const templateMeasuredAdditionDtoSchema = z.object({
  pointKey: z.string(),
  sourceDataKeyPattern: z.string().nullable(),
  required: z.boolean(),
  unit: z.string().nullable(),
});

/** A measured point the target version drops, or whose source pattern moved. */
export const templateMeasuredChangeDtoSchema = z.object({
  pointKey: z.string(),
  fromSourceDataKeyPattern: z.string().nullable(),
  toSourceDataKeyPattern: z.string().nullable(),
});

/**
 * Which calc field moved between the two versions.
 *
 * **This is a delta vocabulary, not `keyof AssetPointCalcOverrideFields`**, and
 * `minCoverageRatio` is the member that makes the difference load-bearing.
 * ADR 0055 decision 11 refuses a per-asset coverage-ratio override, so the
 * ratio is a `template_points` column only and must never join
 * `assetPointCalcOverrideFieldsSchema` above. It still *changes between two
 * versions*, and a migrated asset picks the new value up on its next sweep —
 * `null` meaning "every declared member must be fresh" — so a delta that could
 * not name it reported "no changes" about a migration that decides whether the
 * formula computes at all (`F2.9` finding 31).
 */
export const templateCalcFieldSchema = z.enum([
  "formula",
  "formulaDialect",
  "calcTrigger",
  "calcIntervalSeconds",
  "maxInputAgeSeconds",
  "minCoverageRatio",
]);

/**
 * A derived point whose calc configuration differs between the two versions.
 *
 * `changedFields` is carried alongside `from`/`to` rather than left for the
 * reader to diff: "formula unchanged, interval 60 → 300" and "both changed" are
 * different decisions for whoever confirms the migration, and a UI that
 * recomputed the comparison would be a second implementation of it.
 *
 * **The two ratio fields sit outside `from`/`to`, and that asymmetry is the
 * point** (`F2.9` finding 31). Those two are `AssetPointCalcOverrideFields` —
 * the five columns an asset may override — and ADR 0055 decision 11 refuses a
 * per-asset `minCoverageRatio`. Widening that DTO to make this entry
 * symmetrical would claim an override the ADR forbids, in a shape the override
 * endpoint would then have to refuse. So the ratio is reported here, beside
 * them, as what the two *versions* declare.
 */
export const templateDerivedChangeDtoSchema = z.object({
  pointKey: z.string(),
  changedFields: z.array(templateCalcFieldSchema),
  from: assetPointCalcOverrideFieldsSchema,
  to: assetPointCalcOverrideFieldsSchema,
  /** The source version's coverage ratio; `null` means "every member fresh". */
  fromMinCoverageRatio: z.number().nullable(),
  /** The target version's, which the asset picks up the moment the pin moves. */
  toMinCoverageRatio: z.number().nullable(),
});

/**
 * The delta between two versions of one template code (ADR 0039 decision 2).
 *
 * **Keyed on `point_key` throughout, never on `template_points.id`** (D-4).
 * Every version is a distinct row set, so two versions with identical point
 * keys have entirely different ids — an id-keyed diff would report every point
 * as removed and re-added, and decision 3 would then refuse every migration
 * that ever existed.
 *
 * Measured and derived are separated because ADR 0039 decision 3 treats them
 * differently and not symmetrically: a measured removal or re-key refuses the
 * migration, while derived changes in any combination migrate freely. A point
 * that flips `kind` is reported as a removal on one side and an addition on the
 * other, so `measured -> derived` refuses — it destroys physical wiring that
 * `apps/ingest` and the rule engine read.
 */
export const templateDerivedAdditionDtoSchema = z.object({
  pointKey: z.string(),
  to: assetPointCalcOverrideFieldsSchema,
});

export const templateDerivedRemovalDtoSchema = z.object({
  pointKey: z.string(),
  from: assetPointCalcOverrideFieldsSchema,
});

/**
 * `F2.24` (ADR 0056 decision 1) — a measured point whose class defaults for
 * the five instrument-metadata fields differ between the two versions.
 *
 * **Reported, never refused.** ADR 0056 decision 3 refuses a wiring change
 * (removal, re-key) only; a default that moves is the finding-31 shape of
 * `F2.9` on the measured side — the operator sees it before migrating, it does
 * not block. The migrated asset resolves `coalesce(asset, template)` per
 * column, so every asset without its own override picks the new value up on
 * the ingest host's next reload. (An asset that *does* override is `F2.30`'s
 * concern, gated at migrate by `metadata_override_invalid_on_target`.)
 *
 * `from`/`to` nest `pointMetadataFieldsSchema` whole, as
 * `templateDerivedChangeDtoSchema` nests `assetPointCalcOverrideFieldsSchema`;
 * `changedFields` lists the moved names in `POINT_METADATA_FIELDS` order.
 */
export const templateMeasuredMetadataChangeDtoSchema = z.object({
  pointKey: z.string(),
  changedFields: z.array(pointMetadataFieldNameSchema),
  from: pointMetadataFieldsSchema,
  to: pointMetadataFieldsSchema,
});

export const templateVersionDeltaDtoSchema = z.object({
  fromVersion: z.number(),
  toVersion: z.number(),
  measuredAdded: z.array(templateMeasuredAdditionDtoSchema),
  measuredRemoved: z.array(templateMeasuredChangeDtoSchema),
  measuredReKeyed: z.array(templateMeasuredChangeDtoSchema),
  measuredMetadataChanged: z.array(templateMeasuredMetadataChangeDtoSchema),
  derivedAdded: z.array(templateDerivedAdditionDtoSchema),
  derivedRemoved: z.array(templateDerivedRemovalDtoSchema),
  derivedChanged: z.array(templateDerivedChangeDtoSchema),
  refusals: z.array(templateMigrationRefusalDtoSchema),
});

/** One asset in a migration selection, with the version it is pinned to now. */
export const templateMigrationAssetDtoSchema = z.object({
  assetId: z.string(),
  assetCode: z.string(),
  assetName: z.string(),
  fromVersionId: z.string(),
  fromVersion: z.number(),
});

/**
 * A measured addition that produced no `asset_points` row.
 *
 * Only ever an *optional* point: Q-A (ruled 2026-08-22) refuses the whole
 * migration when a **required** addition's pattern does not resolve. Reported
 * for the same reason `instantiatedAssetDto.skippedPoints` is — "12 points in,
 * 10 rows out" is otherwise indistinguishable from a bug.
 */
export const templateMigrationSkippedPointDtoSchema = z.object({
  assetId: z.string(),
  assetCode: z.string(),
  pointKey: z.string(),
});
