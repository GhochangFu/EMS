/**
 * `F4.23` conversion spike — ADR 0030 decision 4, question (a).
 *
 * **This file is a measurement, not a deliverable.** It converts nine types,
 * chosen to cover every structural class the census found in this package, and
 * asserts the result against both bars defined in `equality.ts`. Whether it
 * survives into the implementation depends on what it reports.
 *
 * The census (99 named declarations across the three modules):
 *
 * | class                | n  | covered by |
 * |----------------------|----|------------|
 * | plain object         | 67 | `locationKpiSummarySchema`, `alarmListItemSchema` |
 * | property-level union | 37 | inline `z.enum` inside those objects |
 * | nullable field       | 25 | `alarmListItemSchema` (4 of them) |
 * | optional property    | 18 | `automationRuleConditionSchema` |
 * | array field          | 17 | `locationDashboardDtoSchema` (nested 3 deep) |
 * | index signature      | 12 | `rulePreviewResultSchema`, `adminOrganizationDtoSchema` |
 * | const-array-derived  |  7 | `electricalPointKeySchema` |
 * | type-level union     |  — | `userRoleSchema`, `alarmSocketEventSchema` |
 * | intersection         |  2 | `locationDashboardDto*` — **both encodings** |
 * | mapped utility       |  1 | `adminAssetTemplateSummaryDto*` — **both encodings** |
 *
 * Two classes are converted twice, because Zod offers two encodings that infer
 * differently and the choice between them is exactly what question (a) is for.
 */
import { z } from "zod";

import { ELECTRICAL_POINT_KEYS } from "../index";
import type {
  AdminAssetTemplateSummaryDto,
  AdminOrganizationDto,
  AlarmListItem,
  AlarmSocketEvent,
  AutomationRuleCondition,
  ElectricalPointKey,
  LocationDashboardDto,
  LocationKpiSummary,
  RulePreviewResult,
  UserRole,
} from "../index";
import type { SourceSample } from "../ingest";
import type { Assignable, Measured, Strict } from "./equality";

// ---------------------------------------------------------------------------
// 1. Type-level string union.
// ---------------------------------------------------------------------------
export const userRoleSchema = z.enum([
  "admin",
  "organization_admin",
  "location_admin",
  "asset_group_admin",
  "operator",
  "viewer",
]);

// ---------------------------------------------------------------------------
// 2. Const-array-derived. All 7 of these derive from `as const` tuples —
//    verified, not assumed — so `z.enum` takes the array directly and the
//    literal list is never restated. Restating it would create the second
//    description ADR 0029 decision 1 forbids.
// ---------------------------------------------------------------------------
export const electricalPointKeySchema = z.enum(ELECTRICAL_POINT_KEYS);

// ---------------------------------------------------------------------------
// 3. Plain object, with property-level unions and a nullable.
// ---------------------------------------------------------------------------
export const organizationRefSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
});

export const locationKpiSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(["smoc_campus", "rsmoc", "csmoc"]),
  province: z.string().nullable(),
  organization: organizationRefSchema,
  rtuCount: z.number(),
  assetCount: z.number(),
  freshAssetCount: z.number(),
  totalKw: z.number(),
  openAlarms: z.number(),
  criticalAlarms: z.number(),
  scopeLabel: z.enum(["full", "partial"]),
});

// ---------------------------------------------------------------------------
// 4. Nullable-heavy object (4 nullable fields of 11).
// ---------------------------------------------------------------------------
export const alarmListItemSchema = z.object({
  id: z.string(),
  assetId: z.string(),
  ruleKey: z.string().nullable(),
  severity: z.string(),
  message: z.string(),
  raisedAt: z.string(),
  acknowledgedAt: z.string().nullable(),
  acknowledgedBy: z.string().nullable(),
  assetCode: z.string(),
  assetName: z.string(),
  siteName: z.string(),
});

// ---------------------------------------------------------------------------
// 5. Discriminated union.
// ---------------------------------------------------------------------------
export const alarmSocketEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("created"), alarm: alarmListItemSchema }),
  z.object({ type: z.literal("acknowledged"), alarm: alarmListItemSchema }),
]);

// ---------------------------------------------------------------------------
// 6. Non-discriminated union carrying an optional property. The two arms share
//    no common key, so `z.discriminatedUnion` cannot express it.
// ---------------------------------------------------------------------------
export const automationRuleConditionSchema = z.union([
  z.object({ window: z.literal("latest"), unit: z.string().optional() }),
  z.object({ days: z.array(z.string()), startTime: z.string(), endTime: z.string() }),
]);

// ---------------------------------------------------------------------------
// 7. Index signature — `Record<string, unknown>`, bare and nullable.
// ---------------------------------------------------------------------------
export const rulePreviewResultSchema = z.object({
  status: z.enum(["matched", "not_matched", "skipped", "error"]),
  matched: z.boolean(),
  observedValue: z.number().nullable(),
  message: z.string(),
  trace: z.record(z.unknown()),
});

export const adminOrganizationDtoSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  active: z.boolean(),
  meta: z.record(z.unknown()).nullable(),
  createdAt: z.string(),
});

// ---------------------------------------------------------------------------
// 8. Intersection, THREE deep, both encodings.
//    `LocationDashboardDto = LocationKpiSummary & { … }` — `.merge()` flattens
//    into one object type; `z.intersection` preserves `A & B`. They infer
//    differently and only one can match the exported type.
// ---------------------------------------------------------------------------
const dashboardExtraSchema = z.object({
  rtus: z.array(
    z.object({
      id: z.string(),
      code: z.string(),
      displayName: z.string(),
      sourceType: z.enum(["mqtt", "simulator", "catalog"]),
      domain: z.string().nullable(),
      ingestEnabled: z.boolean(),
      assetCount: z.number(),
      freshAssetCount: z.number(),
    }),
  ),
  assets: z.object({
    items: z.array(
      z.object({
        id: z.string(),
        code: z.string(),
        name: z.string(),
        domain: z.string(),
        rtuId: z.string().nullable(),
        rtuDisplayName: z.string().nullable(),
        latestKw: z.number().nullable(),
        latestTelemetryAt: z.string().nullable(),
        freshness: z.enum(["live", "stale", "none"]),
        telemetry: z.array(
          z.object({
            pointKey: z.string(),
            value: z.number(),
            unit: z.string().nullable(),
            time: z.string(),
          }),
        ),
        openAlarmCount: z.number(),
        criticalAlarmCount: z.number(),
        warningAlarmCount: z.number(),
        latestAlarm: z
          .object({ severity: z.string(), message: z.string(), raisedAt: z.string() })
          .nullable(),
        openWorkOrderCount: z.number(),
      }),
    ),
    page: z.number(),
    pageSize: z.number(),
    total: z.number(),
    totalPages: z.number(),
  }),
  topAssets: z.array(
    z.object({
      id: z.string(),
      code: z.string(),
      name: z.string(),
      domain: z.string(),
      kw: z.number().nullable(),
    }),
  ),
  workOrdersOpen: z.number(),
});

/** Encoding A — flattened. */
export const locationDashboardDtoMerged = locationKpiSummarySchema.merge(dashboardExtraSchema);

/** Encoding B — preserved `A & B`. */
export const locationDashboardDtoIntersected = z.intersection(
  locationKpiSummarySchema,
  dashboardExtraSchema,
);

// ---------------------------------------------------------------------------
// 9. Mapped utility — `Omit<AdminAssetTemplateDto, "points"> & { … }`, both
//    encodings again.
// ---------------------------------------------------------------------------
const adminAssetTemplateDtoSchema = z.object({
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
  status: z.enum(["draft", "published", "archived"]),
  content: z.record(z.unknown()),
  publishedAt: z.string().nullable(),
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  points: z.array(
    z.object({
      id: z.string(),
      templateId: z.string(),
      pointKey: z.string(),
      label: z.string().nullable(),
      unit: z.string().nullable(),
      kind: z.enum(["measured", "derived"]),
      sourceDataKeyPattern: z.string().nullable(),
      required: z.boolean(),
      sortOrder: z.number(),
      createdAt: z.string(),
    }),
  ),
});

/** Encoding A — `.omit().extend()`, flattened. */
export const adminAssetTemplateSummaryFlat = adminAssetTemplateDtoSchema
  .omit({ points: true })
  .extend({ pointCount: z.number() });

/** Encoding B — `z.intersection` over the omitted base, preserving `A & B`. */
export const adminAssetTemplateSummaryIntersected = z.intersection(
  adminAssetTemplateDtoSchema.omit({ points: true }),
  z.object({ pointCount: z.number() }),
);

// ===========================================================================
// MEASUREMENTS
//
// Each is a standalone `const` with an explicit annotation, so `tsc` reports
// every failure independently instead of stopping at the first.
// ===========================================================================

/* eslint-disable @typescript-eslint/no-unused-vars */

// 1. type-level string union
export const s01: Measured<Strict<z.infer<typeof userRoleSchema>, UserRole>> = true;
export const a01: Measured<Assignable<z.infer<typeof userRoleSchema>, UserRole>> = true;

// 2. const-array-derived
export const s02: Measured<
  Strict<z.infer<typeof electricalPointKeySchema>, ElectricalPointKey>
> = true;
export const a02: Measured<
  Assignable<z.infer<typeof electricalPointKeySchema>, ElectricalPointKey>
> = true;

// 3. plain object
export const s03: Measured<
  Strict<z.infer<typeof locationKpiSummarySchema>, LocationKpiSummary>
> = true;
export const a03: Measured<
  Assignable<z.infer<typeof locationKpiSummarySchema>, LocationKpiSummary>
> = true;

// 4. nullable-heavy object
export const s04: Measured<Strict<z.infer<typeof alarmListItemSchema>, AlarmListItem>> = true;
export const a04: Measured<Assignable<z.infer<typeof alarmListItemSchema>, AlarmListItem>> = true;

// 5. discriminated union
export const s05: Measured<
  Strict<z.infer<typeof alarmSocketEventSchema>, AlarmSocketEvent>
> = true;
export const a05: Measured<
  Assignable<z.infer<typeof alarmSocketEventSchema>, AlarmSocketEvent>
> = true;

// 6. union with an optional property
export const s06: Measured<
  Strict<z.infer<typeof automationRuleConditionSchema>, AutomationRuleCondition>
> = true;
export const a06: Measured<
  Assignable<z.infer<typeof automationRuleConditionSchema>, AutomationRuleCondition>
> = true;

// 7. index signature, bare and nullable
export const s07: Measured<
  Strict<z.infer<typeof rulePreviewResultSchema>, RulePreviewResult>
> = true;
export const a07: Measured<
  Assignable<z.infer<typeof rulePreviewResultSchema>, RulePreviewResult>
> = true;
export const s08: Measured<
  Strict<z.infer<typeof adminOrganizationDtoSchema>, AdminOrganizationDto>
> = true;
export const a08: Measured<
  Assignable<z.infer<typeof adminOrganizationDtoSchema>, AdminOrganizationDto>
> = true;

// 8. intersection — encoding A (merged) then B (intersected)
//
// s09 is `false`, and that is the measurement, not a defect: `.merge()`
// FLATTENS `LocationKpiSummary & { … }` into one object type, which is
// mutually assignable with the exported type (a09 passes) but is not the same
// type. Annotated with what was measured so the file compiles and the finding
// is pinned — if a future Zod or TS makes these strictly identical, this line
// breaks and someone re-reads it.
export const s09: Measured<
  Strict<z.infer<typeof locationDashboardDtoMerged>, LocationDashboardDto>
> = false;
export const a09: Measured<
  Assignable<z.infer<typeof locationDashboardDtoMerged>, LocationDashboardDto>
> = true;
export const s10: Measured<
  Strict<z.infer<typeof locationDashboardDtoIntersected>, LocationDashboardDto>
> = true;
export const a10: Measured<
  Assignable<z.infer<typeof locationDashboardDtoIntersected>, LocationDashboardDto>
> = true;

// 9. mapped utility — encoding A (flat) then B (intersected)
// s11 `false` for the same reason as s09: `.omit().extend()` flattens
// `Omit<AdminAssetTemplateDto, "points"> & { pointCount: number }`.
export const s11: Measured<
  Strict<z.infer<typeof adminAssetTemplateSummaryFlat>, AdminAssetTemplateSummaryDto>
> = false;
export const a11: Measured<
  Assignable<z.infer<typeof adminAssetTemplateSummaryFlat>, AdminAssetTemplateSummaryDto>
> = true;
export const s12: Measured<
  Strict<z.infer<typeof adminAssetTemplateSummaryIntersected>, AdminAssetTemplateSummaryDto>
> = true;
export const a12: Measured<
  Assignable<z.infer<typeof adminAssetTemplateSummaryIntersected>, AdminAssetTemplateSummaryDto>
> = true;

// ---------------------------------------------------------------------------
// 10. The two classes the completeness scan found AFTER the conversion —
//     `readonly` property modifiers and `Date`-typed properties, 18 sites
//     across 4 types, ALL of them in `ingest.ts`.
//
//     They were not in the census taxonomy, which is the point of running a
//     completeness scan separately from a classifier: the classifier had filed
//     these under "object" and counted them covered. Measured here rather than
//     reasoned about, because the answer decides whether the contracts package
//     can include `ingest.ts` at all.
// ---------------------------------------------------------------------------
export const sourceSampleSchema = z.object({
  sourceKey: z.string(),
  value: z.number(),
  deviceKey: z.string().optional(),
  at: z.date().optional(),
  good: z.boolean().optional(),
});

/** Zod's `.readonly()` applies to the object, not per property. */
export const sourceSampleReadonlySchema = sourceSampleSchema.readonly();

// s13 `false`: a plain `z.object` infers MUTABLE properties, and every
// property of `SourceSample` is `readonly`. s14 shows `.readonly()` recovers
// strict identity — so `readonly` is expressible, just not by default. `Date`
// converts cleanly via `z.date()`; it was the modifier, not the type.
export const s13: Measured<Strict<z.infer<typeof sourceSampleSchema>, SourceSample>> = false;
export const a13: Measured<Assignable<z.infer<typeof sourceSampleSchema>, SourceSample>> = true;
export const s14: Measured<
  Strict<z.infer<typeof sourceSampleReadonlySchema>, SourceSample>
> = true;
export const a14: Measured<
  Assignable<z.infer<typeof sourceSampleReadonlySchema>, SourceSample>
> = true;
