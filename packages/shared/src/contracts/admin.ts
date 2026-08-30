/**
 * Master-data admin contracts (ADR 0008–0010), audit reads (ADR 0021) and
 * asset templates (ADR 0015, ADR 0019).
 *
 * `adminAssetTemplateSummaryDtoSchema` is the second site where ADR 0030
 * Amendment 1's encoding rules bite: the exported type is
 * `Omit<AdminAssetTemplateDto, "points"> & { pointCount: number }`, so it is
 * `z.intersection(base.omit(…), …)` and NOT `.omit().extend()`, which flattens.
 */
import { z } from "zod";

import { CALC_DIALECT, CALC_TRIGGERS } from "../calc-dsl";
import { assetRoleCodeSchema } from "./operations";
import { pointSourceKindSchema } from "./telemetry-entry";

export const masterDataActiveFilterSchema = z.enum(["true", "false", "all"]);

export const adminOrganizationDtoSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  active: z.boolean(),
  meta: z.record(z.unknown()).nullable(),
  createdAt: z.string(),
});

export const adminLocationDtoSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  organizationCode: z.string(),
  organizationName: z.string(),
  code: z.string(),
  slug: z.string(),
  name: z.string(),
  type: z.enum(["smoc_campus", "rsmoc", "csmoc"]),
  province: z.string().nullable(),
  capital: z.string().nullable(),
  latitude: z.number(),
  longitude: z.number(),
  active: z.boolean(),
  meta: z.record(z.unknown()).nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const adminRtuDtoSchema = z.object({
  id: z.string(),
  locationId: z.string(),
  locationName: z.string(),
  organizationCode: z.string(),
  code: z.string(),
  displayName: z.string(),
  sourceType: z.enum(["mqtt", "simulator", "catalog"]),
  domain: z.string().nullable(),
  externalRtuId: z.number().nullable(),
  rtuCode: z.string().nullable(),
  mqttTopic: z.string().nullable(),
  stationCode: z.string().nullable(),
  stationName: z.string().nullable(),
  ingestEnabled: z.boolean(),
  active: z.boolean(),
  meta: z.record(z.unknown()).nullable(),
  createdAt: z.string(),
});

export const adminAssetDtoSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  siteName: z.string(),
  // ADR 0018: location is mandatory, gateway is optional. An asset with no
  // gateway is a first-class asset whose points are hand-entered or computed.
  locationId: z.string(),
  locationName: z.string().nullable(),
  organizationCode: z.string().nullable(),
  rtuId: z.string().nullable(),
  rtuDisplayName: z.string().nullable(),
  domain: z.string(),
  active: z.boolean(),
  // `F2.6` (ADR 0039 decision 8): which template *version* this asset is pinned
  // to. Added because the Versions view is defined as "listing which assets sit
  // on which version", and no other response says it — a migration UI without
  // this can only offer every asset and let the server refuse, teaching the
  // operator by 400. All three are null for a hand-created asset, which is
  // every seeded one.
  templateId: z.string().nullable(),
  templateCode: z.string().nullable(),
  templateVersion: z.number().nullable(),
  meta: z.record(z.unknown()).nullable(),
  createdAt: z.string(),
});

export const adminAssetPointDtoSchema = z.object({
  id: z.string(),
  assetId: z.string(),
  assetCode: z.string(),
  assetName: z.string(),
  locationId: z.string().nullable(),
  locationName: z.string().nullable(),
  pointKey: z.string(),
  sourceDataKey: z.string(),
  sensorCode: z.string().nullable(),
  unit: z.string().nullable(),
  active: z.boolean(),
  /** ADR 0018 — where this point's provenance comes from. */
  sourceKind: pointSourceKindSchema,
  createdAt: z.string(),
});

export const adminPointKeyDtoSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  organizationCode: z.string(),
  organizationName: z.string(),
  code: z.string(),
  name: z.string(),
  domain: z.string().nullable(),
  unit: z.string().nullable(),
  description: z.string().nullable(),
  active: z.boolean(),
  createdAt: z.string(),
});

export const adminOrganizationSummaryDtoSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
});

export const adminLocationSummaryDtoSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  organizationId: z.string(),
  organizationCode: z.string(),
  organizationName: z.string(),
});

export const adminRtuSummaryDtoSchema = z.object({
  id: z.string(),
  code: z.string(),
  displayName: z.string(),
  locationId: z.string(),
  locationName: z.string(),
  organizationId: z.string(),
  organizationCode: z.string(),
});

export const adminAssetSummaryDtoSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  locationId: z.string(),
  locationName: z.string().nullable(),
  rtuId: z.string().nullable(),
  rtuDisplayName: z.string().nullable(),
  organizationId: z.string().nullable(),
  organizationCode: z.string().nullable(),
});

// ---------------------------------------------------------------------------
// Audit reads (ADR 0021, `F4.14`)
// ---------------------------------------------------------------------------

/**
 * One `bms.audit_log` row as returned by the read API.
 *
 * `actorId`/`actorEmail` are nullable: the writer resolves the actor by id or
 * email and stores `null` when neither matches, which is preserved rather than
 * rendered as a fabricated identity. `payload` is the verbatim request body of
 * the audited mutation — see ADR 0021 decision 6 before adding a field to any
 * audited request schema.
 */
export const auditLogEntryDtoSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  actorId: z.string().nullable(),
  actorEmail: z.string().nullable(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string().nullable(),
  reason: z.string().nullable(),
  payload: z.unknown(),
});

/** Offset-paginated audit list. `F4.22` adds a cursor without removing these. */
export const auditLogListResponseSchema = z.object({
  items: z.array(auditLogEntryDtoSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});

// ---------------------------------------------------------------------------
// Asset templates (ADR 0015 / ADR 0019)
// ---------------------------------------------------------------------------

/** Lifecycle of an asset template version (ADR 0015). */
export const assetTemplateStatusSchema = z.enum(["draft", "published", "archived"]);

/**
 * Whether instantiation emits an `asset_points` row for this point.
 *
 * `derived` points are computed by the calc engine (F2.6) and deliberately
 * produce no mapping row — `asset_points.source_data_key` is NOT NULL and there
 * is no honest source key for a computed tag.
 */
export const templatePointKindSchema = z.enum(["measured", "derived"]);

export const adminTemplatePointDtoSchema = z.object({
  id: z.string(),
  templateId: z.string(),
  pointKey: z.string(),
  label: z.string().nullable(),
  /** Override; `null` means "use the point-key catalog's unit". */
  unit: z.string().nullable(),
  kind: templatePointKindSchema,
  sourceDataKeyPattern: z.string().nullable(),
  // ADR 0036 decisions 5 and 7. Both null for a measured point; both set for a
  // derived one (enforced in apps/api's templatePointBodySchema, not here —
  // this is a read-side DTO).
  formula: z.string().nullable(),
  formulaDialect: z.literal(CALC_DIALECT).nullable(),
  // ADR 0037 decision 4. Read-side counterpart of the enforcement in
  // apps/api's templatePointBodySchema — carried here for the same reason
  // formula/formulaDialect are: templatePointsBodySchema sends the whole
  // points array on every draft update, so an editor round-tripping a GET
  // response back through PATCH must see these fields or lose them.
  calcTrigger: z.enum(CALC_TRIGGERS).nullable(),
  calcIntervalSeconds: z.number().nullable(),
  maxInputAgeSeconds: z.number().nullable(),
  required: z.boolean(),
  sortOrder: z.number(),
  createdAt: z.string(),
});

/**
 * One template *version* (ADR 0015) — a row is a version, so
 * `assets.templateId` pins it exactly and the two can never disagree.
 */
export const adminAssetTemplateDtoSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  organizationCode: z.string(),
  organizationName: z.string(),
  code: z.string(),
  version: z.number(),
  name: z.string(),
  assetType: z.string(),
  domain: z.string(),
  description: z.string().nullable(),
  status: assetTemplateStatusSchema,
  /**
   * The `E1.7` overlay. A bare record rather than `TemplateContent` on purpose:
   * `F2.1` shipped this column behind `z.record(z.unknown())`, so a deployment
   * may hold rows written before ADR 0019 tightened it. Those rows still read
   * and still instantiate — nothing consumes `content` — and are rejected only
   * when someone next writes or publishes them. A DTO claiming `TemplateContent`
   * would be lying about them.
   */
  content: z.record(z.unknown()),
  publishedAt: z.string().nullable(),
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  points: z.array(adminTemplatePointDtoSchema),
});

/**
 * List rows omit `points` — the editor fetches them per template.
 *
 * `z.intersection`, never `.omit().extend()` — ADR 0030 Amendment 1, rule 2.
 */
export const adminAssetTemplateSummaryDtoSchema = z.intersection(
  adminAssetTemplateDtoSchema.omit({ points: true }),
  z.object({ pointCount: z.number() }),
);

/**
 * One asset built by `F2.2` instantiation (ADR 0015 §6).
 *
 * `skippedPoints` names the optional measured points that produced no
 * `asset_points` row because their `sourceDataKeyPattern` did not resolve.
 * Required points abort the batch instead, so anything listed here was
 * explicitly declared optional — surfaced because "12 points in, 10 rows out"
 * is otherwise indistinguishable from a bug.
 */
export const instantiatedAssetDtoSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  locationId: z.string(),
  rtuId: z.string().nullable(),
  pointCount: z.number(),
  skippedPoints: z.array(z.string()),
});

/** The result of one instantiate call — the whole batch or nothing. */
export const assetInstantiationResultDtoSchema = z.object({
  templateId: z.string(),
  templateCode: z.string(),
  templateVersion: z.number(),
  locationId: z.string(),
  rtuId: z.string().nullable(),
  /**
   * `measured` when instantiated through an RTU, `unmapped` through a
   * location. `.extract()` off `pointSourceKindSchema` (ADR 0018 §4.8) so this
   * narrow, two-value vocabulary derives from the wide one by construction
   * rather than by a second hand-maintained list that could drift from it.
   */
  sourceKind: pointSourceKindSchema.extract(["measured", "unmapped"]),
  assets: z.array(instantiatedAssetDtoSchema),
  assetCount: z.number(),
  pointCount: z.number(),
});

// Compile-time guard: the narrowing above must still describe exactly
// "measured" | "unmapped" — not silently widen if `.extract()`'s argument
// list is ever edited without checking what depends on the result.
type AssertAssignable<A extends B, B> = A;
export type AssetInstantiationSourceKindMatchesExpected = AssertAssignable<
  z.infer<typeof assetInstantiationResultDtoSchema>["sourceKind"],
  "measured" | "unmapped"
>;
export type ExpectedMatchesAssetInstantiationSourceKind = AssertAssignable<
  "measured" | "unmapped",
  z.infer<typeof assetInstantiationResultDtoSchema>["sourceKind"]
>;

// --- F2.6: template version lifecycle (ADR 0039) ----------------------------

/**
 * The five calc columns, as one shape used in three roles.
 *
 * ADR 0039 decision 6 makes resolution `coalesce(asset_points.<col>,
 * template_points.<col>)` per column, so "what the template says", "what this
 * asset overrides" and "what the engine will actually use" are the *same five
 * fields* read three ways. One schema, not three near-identical ones: a fourth
 * column added later must reach all three or the merge stops being total.
 *
 * Every field is nullable in every role. In the override role `null` means
 * "inherit"; in the template role it means the template never set one; in the
 * effective role it means neither did.
 *
 * No numeric bounds here, deliberately, matching
 * `adminTemplatePointDtoSchema`: this is a read-side DTO over stored rows, and
 * a read schema that rejects a row the database holds is a schema that lies
 * about the estate. The bounds are enforced on the write side, in `apps/api`,
 * from `MIN_CALC_INTERVAL_SECONDS` / `MAX_CALC_INTERVAL_SECONDS` /
 * `MAX_INPUT_AGE_SECONDS_BOUND`.
 */
export const assetPointCalcOverrideFieldsSchema = z.object({
  formula: z.string().nullable(),
  formulaDialect: z.literal(CALC_DIALECT).nullable(),
  calcTrigger: z.enum(CALC_TRIGGERS).nullable(),
  calcIntervalSeconds: z.number().nullable(),
  maxInputAgeSeconds: z.number().nullable(),
});

/**
 * One derived point of one asset, as the asset detail page shows it (ADR 0039
 * decision 8): what the pinned template version declares, what this asset
 * overrides, and what the engine resolves.
 *
 * `assetPointId` is `null` when no `asset_points` row exists yet — the normal
 * state for a derived point that has neither been overridden nor produced a
 * first value (ADR 0037), and the reason this DTO is keyed on `pointKey`
 * rather than on a row id that may not exist.
 */
export const assetPointCalcConfigDtoSchema = z.object({
  pointKey: z.string(),
  /** The `template_points` row this resolves against, on the version pinned now. */
  templatePointId: z.string(),
  label: z.string().nullable(),
  unit: z.string().nullable(),
  assetPointId: z.string().nullable(),
  template: assetPointCalcOverrideFieldsSchema,
  override: assetPointCalcOverrideFieldsSchema,
  effective: assetPointCalcOverrideFieldsSchema,
});

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
  /** Q-A — a required measured addition's pattern uses a token beyond `asset_code`. */
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

/** Which of the five calc fields moved between the two versions. */
export const templateCalcFieldSchema = z.enum([
  "formula",
  "formulaDialect",
  "calcTrigger",
  "calcIntervalSeconds",
  "maxInputAgeSeconds",
]);

/**
 * A derived point whose calc configuration differs between the two versions.
 *
 * `changedFields` is carried alongside `from`/`to` rather than left for the
 * reader to diff: "formula unchanged, interval 60 → 300" and "both changed" are
 * different decisions for whoever confirms the migration, and a UI that
 * recomputed the comparison would be a second implementation of it.
 */
export const templateDerivedChangeDtoSchema = z.object({
  pointKey: z.string(),
  changedFields: z.array(templateCalcFieldSchema),
  from: assetPointCalcOverrideFieldsSchema,
  to: assetPointCalcOverrideFieldsSchema,
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

export const templateVersionDeltaDtoSchema = z.object({
  fromVersion: z.number(),
  toVersion: z.number(),
  measuredAdded: z.array(templateMeasuredAdditionDtoSchema),
  measuredRemoved: z.array(templateMeasuredChangeDtoSchema),
  measuredReKeyed: z.array(templateMeasuredChangeDtoSchema),
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

/**
 * `F3.37` (ADR 0049 decision 5) — the asset-group admin surface.
 *
 * **Why these reads exist at all.** Before `F3.37` this API exposed no
 * asset-group read of any kind: `AccessControlService` returns groups only as
 * the *calling user's own scope*, and that array is empty for `admin`,
 * `organization_admin` and `location_admin` — precisely the users who
 * administer roles. So the role column had a write endpoint whose only input
 * was a membership id nothing returned. `F3.8` / ADR 0041 decision 10 is the
 * precedent that closed the same gap by shipping the surface in the row rather
 * than after it, "because an item closed with its browser layer marked N/A is
 * not closed".
 *
 * Hanging the control off the asset admin screen was foreclosed by ADR 0049
 * decision 5's own case: the same pump is the raw-water pump in the water
 * group and a monitored load in the electrical one, so the role sits on the
 * *membership* and the surface has to be group-centric.
 */
export const adminAssetGroupDtoSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  locationId: z.string(),
  locationName: z.string().nullable(),
  organizationId: z.string(),
  memberCount: z.number(),
  createdAt: z.string(),
});

export const adminAssetGroupListResponseSchema = z.object({
  items: z.array(adminAssetGroupDtoSchema),
});

/** One row of `bms.asset_group_members`, joined to the asset it names. */
export const adminAssetGroupMemberDtoSchema = z.object({
  membershipId: z.string(),
  assetId: z.string(),
  assetCode: z.string(),
  assetName: z.string(),
  assetDomain: z.string(),
  /** `null` means no role is set — the state every membership was in before 0051. */
  role: z.string().nullable(),
  /** The role's label from `bms.asset_roles`, or `null` when `role` is null. */
  roleLabel: z.string().nullable(),
});

export const adminAssetGroupMembersResponseSchema = z.object({
  /**
   * **Ordered by `assets.code`, and that is a contract rather than an
   * incidental.** `assets.code` is `varchar(64) NOT NULL UNIQUE`, so it is a
   * *total* order — which is what makes it safe. ADR 0049 put no unique index
   * on `(asset_group_id, role)`, because the mock's own nodes are plural
   * ("Chillers 2 of 3", "Primary Pumps 3 running") and one role still maps to
   * one widget however many members match. A role therefore resolves to N
   * bindings, and ordering by `id` or by insertion order would make the same
   * stock template instantiated twice in one organization produce two
   * different tile orders with no visible cause.
   */
  items: z.array(adminAssetGroupMemberDtoSchema),
  /**
   * How many members carry each role code, for the roles present in this group.
   *
   * **This is decision 6's spectrum made visible.** ADR 0049 decision 6 ruled
   * that an unresolved role imports as a widget with zero bindings rendering
   * "no data bound". That was written for match/no-match. With plural roles a
   * group where two of three chillers carry the role renders a widget that
   * *looks* right and is quietly one short. Zero bindings is visible;
   * N-minus-one is not, unless something counts. A display concern and not a
   * stored invariant, so it does not reopen the ADR.
   */
  roleCounts: z.record(z.number()),
});

/**
 * `PATCH /api/v1/admin/asset-group-members/:id` — set or clear one membership's
 * role.
 *
 * `null` clears it. The code is checked against `bms.asset_roles` by
 * `VocabulariesService.assertAssetRole` before the write, so an unknown value
 * is a 400 naming the live codes rather than
 * `asset_group_members_role_fkey` as a 500.
 */
export const setAssetGroupMemberRoleBodySchema = z.object({
  role: assetRoleCodeSchema.nullable(),
});
