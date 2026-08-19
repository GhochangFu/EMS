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
