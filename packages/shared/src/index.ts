/**
 * `@bms/shared` — the cross-app contract surface.
 *
 * **Every response type here is `z.infer` of a schema in `./contracts`.** They
 * are not written twice. ADR 0030 decision 2 applied ADR 0029 decision 1's
 * thesis to the response side: the description is derived from the thing that
 * enforces the shape, because a second hand-written copy is worse than none —
 * it gets believed, and nothing tells you when it stops being true.
 *
 * That was proved rather than asserted before the switch: 81 assertions of
 * strict type identity between each schema and the hand-written type it
 * replaced, 79 identical, and the 2 that differ are recorded in ADR 0030
 * Amendment 2 with the single reason they cannot be.
 *
 * **The schemas are re-exported here as values, not only under the
 * `./contracts` subpath**, for the same reason `./ingest` is: `apps/api`
 * compiles with `moduleResolution: "node"` (node10), which ignores the
 * `exports` map. `apps/web` should prefer `@bms/shared/contracts`, which is
 * where the contract/constant line is actually drawn.
 *
 * Adding a response type means adding a schema in `./contracts` and one
 * `z.infer` line here. Writing the type out by hand instead is what
 * `tests/adr-0030-contract-derivation.test.ts` rejects.
 */
import type { z } from "zod";

import type * as A from "./contracts/admin";
import type * as Au from "./contracts/auth";
import type * as D from "./contracts/dashboard";
import type * as Db from "./contracts/dashboard-builder";
import type * as E from "./contracts/envelopes";
import type * as He from "./contracts/health";
import type * as N from "./contracts/notifications";
import type * as Ob from "./contracts/onboarding";
import type * as Op from "./contracts/operations";
import type * as Te from "./contracts/telemetry-entry";
import type * as Ti from "./contracts/telemetry-import";
import { TELEMETRY_POINT_REF_SEP } from "./constants";

/** Point-key catalogues and the `pointRef` separator — the non-contract half. */
export * from "./constants";

/** The schemas themselves. See the note above on why they are re-exported. */
export * from "./contracts";

/** The `bms-calc-v1` grammar (ADR 0036, `F2.3`) — tokenizer, parser, AST
 * types, and the pure `parseFormula`/`validateFormula` surface. No `./calc-dsl`
 * subpath is added to `package.json` `exports`: AGENTS.md §4.8 records that
 * `apps/api` compiles with `moduleResolution: "node"` and ignores the
 * `exports` map, so the barrel is the only route its main consumer typechecks
 * through. */
export * from "./calc-dsl";

// ---------------------------------------------------------------------------
// Auth and access scope
// ---------------------------------------------------------------------------

/** Prototype role slugs stored in `bms.users.role`. */
export type UserRole = z.infer<typeof Au.userRoleSchema>;
/** JWT payload claims issued by `apps/api` (prototype). */
export type JwtPayload = z.infer<typeof Au.jwtPayloadSchema>;
/** Successful login response body from `POST /api/v1/auth/login`. */
export type LoginResponse = z.infer<typeof Au.loginResponseSchema>;
export type AccessScopeKind = z.infer<typeof Au.accessScopeKindSchema>;
export type AccessLocation = z.infer<typeof Au.accessLocationSchema>;
export type AccessAssetGroup = z.infer<typeof Au.accessAssetGroupSchema>;
export type AccessibleScope = z.infer<typeof Au.accessibleScopeSchema>;
export type CurrentUserResponse = z.infer<typeof Au.currentUserResponseSchema>;

// ---------------------------------------------------------------------------
// Dashboard, telemetry and map
// ---------------------------------------------------------------------------

export type OrganizationRef = z.infer<typeof D.organizationRefSchema>;
export type RtuSummary = z.infer<typeof D.rtuSummarySchema>;
export type LocationKpiSummary = z.infer<typeof D.locationKpiSummarySchema>;
export type LocationDashboardDto = z.infer<typeof D.locationDashboardDtoSchema>;
/** One telemetry sample (DB row / WebSocket payload). */
export type TelemetryReading = z.infer<typeof D.telemetryReadingSchema>;
/** Snapshot for Executive Dashboard KPI row (`GET /api/v1/dashboard/kpis`). */
export type DashboardKpis = z.infer<typeof D.dashboardKpisSchema>;
/** Aggregated load curve for trend chart. */
export type LoadTrendPoint = z.infer<typeof D.loadTrendPointSchema>;
/** Live map marker (`GET /api/v1/map/sites`). */
export type MapSiteLive = z.infer<typeof D.mapSiteLiveSchema>;
export type MapSiteDto = z.infer<typeof D.mapSiteDtoSchema>;

// --- Configurable dashboards (F3.1a, ADR 0047) ------------------------------
/** The four widget types. Closed — a fifth ships a component, so it is a code change (§4.8). */
export type WidgetType = z.infer<typeof Db.widgetTypeSchema>;
/** The generic `chart` type's series: one component, four shapes (ADR 0047 decision 4). */
export type ChartSeriesKind = z.infer<typeof Db.chartSeriesKindSchema>;
/** Which slot of the renderer a bound point feeds. */
export type WidgetPointRole = z.infer<typeof Db.widgetPointRoleSchema>;
/** Type and config as one discriminated value — what `F3.1c`'s exhaustive switch reads. */
export type DashboardWidgetSpec = z.infer<typeof Db.dashboardWidgetSpecSchema>;
/** One point binding — a row, never an id inside JSON (ADR 0047 decision 3). */
export type DashboardWidgetPointDto = z.infer<typeof Db.dashboardWidgetPointDtoSchema>;
/** A widget as read, narrowing on `widgetType` through the intersection. */
export type DashboardWidgetDto = z.infer<typeof Db.dashboardWidgetDtoSchema>;
/** A dashboard with its widgets. */
export type DashboardDto = z.infer<typeof Db.dashboardDtoSchema>;
/** A dashboard in a list, without its widgets. */
export type DashboardSummaryDto = z.infer<typeof Db.dashboardSummaryDtoSchema>;

// --- F3.35 Stage A — aggregation and presentation (ADR 0048) ----------------
/**
 * How a window collapses to one number. Four members, and there is no `median`:
 * the ADR 0023 rollup relations store totals, counts and extremes only.
 */
export type PointAggregateFunction = z.infer<typeof Db.pointAggregateFunctionSchema>;
/** A tile icon by NAME. The name→SVG-path map is frontend code (§4.8). */
export type WidgetIcon = z.infer<typeof Db.widgetIconSchema>;
/**
 * `E1.3` — the asset health score (ADR 0050 + Amendment 1).
 *
 * Four kinds of absence stay distinguishable across these types: `score: null`,
 * `band: null`, the unscored counts, and `skippedRuleCount`. `contracts/health.ts`
 * says which is which and why collapsing any two of them is a defect.
 */
export type HealthBand = z.infer<typeof He.healthBandSchema>;
/** One tag's contribution, carrying both counts and not only their quotient. */
export type HealthTagScore = z.infer<typeof He.healthTagScoreSchema>;
/** A tag excluded from the ratio, and whether that was for want of a rule or
 * because every matching rule was unevaluatable. */
export type HealthUnscoredTag = z.infer<typeof He.healthUnscoredTagSchema>;
/** `GET /api/v1/asset-health/assets/:assetId`. */
export type AssetHealthResponse = z.infer<typeof He.assetHealthResponseSchema>;
/** One slice of the donut, grouped by band `code`. */
export type HealthBandCount = z.infer<typeof He.healthBandCountSchema>;
/** `GET /api/v1/asset-health/summary` — the plant and enterprise donut. */
export type HealthSummaryResponse = z.infer<typeof He.healthSummaryResponseSchema>;
/** One plotted bucket — the same `{ t, v }` shape the chart renderer already takes. */
export type PointAggregateBucket = z.infer<typeof E.pointAggregateBucketSchema>;
/** The scalar half: totals, extremes, the weighted mean, and when the peak fell. */
export type PointAggregateStats = z.infer<typeof E.pointAggregateStatsSchema>;
/** `GET /telemetry/points/:pointRef/aggregate`. */
export type PointAggregateResponse = z.infer<typeof E.pointAggregateResponseSchema>;

/** Builds the REST path segment for `GET .../points/:pointRef/recent`. */
export function encodePointRef(assetId: string, pointKey: string): string {
  return encodeURIComponent(`${assetId}${TELEMETRY_POINT_REF_SEP}${pointKey}`);
}

/** Parses `encodePointRef` output from a route param (already URL-decoded by Nest/Express). */
export function decodePointRefParam(param: string): {
  assetId: string;
  pointKey: string;
} {
  const decoded = decodeURIComponent(param);
  const i = decoded.indexOf(TELEMETRY_POINT_REF_SEP);
  if (i < 0) {
    throw new Error("Invalid point reference");
  }
  return {
    assetId: decoded.slice(0, i),
    pointKey: decoded.slice(i + TELEMETRY_POINT_REF_SEP.length),
  };
}

// ---------------------------------------------------------------------------
// Energy
// ---------------------------------------------------------------------------

/** Energy Centre KPI row (`GET /api/v1/dashboard/energy/summary`). */
export type EnergyCentreSummary = z.infer<typeof Op.energyCentreSummarySchema>;
/** Stacked source mix (grid / solar / nominal DG slice) per time bucket. */
export type EnergySourceMixPoint = z.infer<typeof Op.energySourceMixPointSchema>;
/** Top consumers by average kW in the window. */
export type EnergyTopConsumer = z.infer<typeof Op.energyTopConsumerSchema>;
export type EnergyReportTemplate = z.infer<typeof Op.energyReportTemplateSchema>;
export type EnergyReportSourceTotals = z.infer<typeof Op.energyReportSourceTotalsSchema>;
/** Preview payload for Phase 5 Sprint E Energy Consumption reports. */
export type EnergyReportPreview = z.infer<typeof Op.energyReportPreviewSchema>;

// ---------------------------------------------------------------------------
// Alarms
// ---------------------------------------------------------------------------

/** One alarm row for list / WebSocket payloads (`GET /api/v1/alarms`). */
export type AlarmListItem = z.infer<typeof Op.alarmListItemSchema>;
/** Socket.IO `/ws/alarms` event payload. */
export type AlarmSocketEvent = z.infer<typeof Op.alarmSocketEventSchema>;
/** One row of `bms.alarm_affected_assets`, joined for display (ADR 0034). */
export type AlarmAffectedAssetDto = z.infer<typeof Op.alarmAffectedAssetDtoSchema>;
/** `bms.alarm_enrichments`, one row per alarm (ADR 0034, `E2.1`). */
export type AlarmEnrichmentDto = z.infer<typeof Op.alarmEnrichmentDtoSchema>;
/** `GET /api/v1/alarms/:id/details` (ADR 0034 decision 5). */
export type AlarmDetailsResponse = z.infer<typeof Op.alarmDetailsResponseSchema>;
// `AlarmEnrichmentUpsertBody` deliberately not here — it is a request type,
// declared in `apps/api/src/alarms/enrichment.schema.ts` (AGENTS.md §3).

// ---------------------------------------------------------------------------
// Work orders and maintenance
// ---------------------------------------------------------------------------

export type WorkOrderStatus = z.infer<typeof Op.workOrderStatusSchema>;
export type WorkOrderPriority = z.infer<typeof Op.workOrderPrioritySchema>;
export type MaintenanceDueState = z.infer<typeof Op.maintenanceDueStateSchema>;
export type MaintenanceScheduleCategory = z.infer<
  typeof Op.maintenanceScheduleCategorySchema
>;
export type MaintenanceGenerationMode = z.infer<typeof Op.maintenanceGenerationModeSchema>;
/** One work order row for Phase 5 Sprint A API responses. */
export type WorkOrderListItem = z.infer<typeof Op.workOrderListItemSchema>;
/** Maintenance schedule item shown in the Phase 5 Sprint C Schedule Centre. */
export type MaintenanceScheduleItem = z.infer<typeof Op.maintenanceScheduleItemSchema>;

// ---------------------------------------------------------------------------
// Rule engine
// ---------------------------------------------------------------------------

export type AutomationRuleType = z.infer<typeof Op.automationRuleTypeSchema>;
/**
 * A rule's **concern**, as a code into `bms.rule_categories`.
 *
 * A `string`, not a union, since ADR 0031 Amendment 1 — the vocabulary is data,
 * and `automation_rules_category_fk` is what closes it. `AuthorableRuleCategory`
 * used to name a narrower write half; there is no narrower half now.
 */
export type AutomationRuleCategory = z.infer<typeof Op.ruleCategoryCodeSchema>;
/** The plant axis, as a code into `bms.asset_domains` (ADR 0031). */
export type AssetDomain = z.infer<typeof Op.assetDomainCodeSchema>;
/** How a category badge is styled — a closed *presentation* vocabulary. */
export type BadgeTone = z.infer<typeof Op.badgeToneSchema>;
export type RuleCategoryDto = z.infer<typeof Op.ruleCategoryDtoSchema>;
export type AssetDomainDto = z.infer<typeof Op.assetDomainDtoSchema>;
/** ADR 0032 — one row of `bms.alarm_severities`, with its `rank` and `tone`. */
export type AlarmSeverityDto = z.infer<typeof Op.alarmSeverityDtoSchema>;
/** ADR 0034 — one row of `bms.alarm_skills`. No `rank`/`tone`: a skill drives no styling. */
export type AlarmSkillDto = z.infer<typeof Op.alarmSkillDtoSchema>;
/** A skill/trade code, as a code into `bms.alarm_skills` (ADR 0034). */
export type AlarmSkillCode = z.infer<typeof Op.alarmSkillCodeSchema>;
/** ADR 0049 — one row of `bms.asset_roles`. No `rank`/`tone`: a role drives no styling. */
export type AssetRoleDto = z.infer<typeof Op.assetRoleDtoSchema>;
/** What part a member plays in its group, as a code into `bms.asset_roles` (ADR 0049). */
export type AssetRoleCode = z.infer<typeof Op.assetRoleCodeSchema>;
/** The `StatusPill` palette, as a type. Closed; see `pillToneSchema`. */
export type PillTone = z.infer<typeof Op.pillToneSchema>;
/** `GET /api/v1/vocabularies` — all five open vocabularies, so a page renders none half-loaded. */
export type VocabulariesResponse = z.infer<typeof Op.vocabulariesResponseSchema>;
export type AutomationRuleOperator = z.infer<typeof Op.automationRuleOperatorSchema>;
export type AutomationRuleSeverity = z.infer<typeof Op.automationRuleSeveritySchema>;
export type AutomationRuleLifecycleStatus = z.infer<
  typeof Op.automationRuleLifecycleStatusSchema
>;
export type RuleExecutionStatus = z.infer<typeof Op.ruleExecutionStatusSchema>;
export type AutomationRuleCondition = z.infer<typeof Op.automationRuleConditionSchema>;
export type AutomationRuleAction = z.infer<typeof Op.automationRuleActionSchema>;
/** Basic automation rule row for Phase 5 Sprint D Rule Engine responses. */
export type RuleListItem = z.infer<typeof Op.ruleListItemSchema>;
export type RuleBuilderCatalogAsset = z.infer<typeof Op.ruleBuilderCatalogAssetSchema>;
export type RulePreviewResult = z.infer<typeof Op.rulePreviewResultSchema>;
/** One evaluation trace row for the Phase 5 Sprint D Rule Engine. */
export type RuleExecutionItem = z.infer<typeof Op.ruleExecutionItemSchema>;

// ---------------------------------------------------------------------------
// Master data (ADR 0008–0010)
// ---------------------------------------------------------------------------

/** Active filter for master-data list endpoints. */
export type MasterDataActiveFilter = z.infer<typeof A.masterDataActiveFilterSchema>;
export type AdminOrganizationDto = z.infer<typeof A.adminOrganizationDtoSchema>;
export type AdminLocationDto = z.infer<typeof A.adminLocationDtoSchema>;
export type AdminRtuDto = z.infer<typeof A.adminRtuDtoSchema>;
export type AdminAssetDto = z.infer<typeof A.adminAssetDtoSchema>;
export type AdminAssetPointDto = z.infer<typeof A.adminAssetPointDtoSchema>;
/** `F3.37` (ADR 0049) — one `bms.asset_groups` row for the admin surface. */
export type AdminAssetGroupDto = z.infer<typeof A.adminAssetGroupDtoSchema>;
export type AdminAssetGroupListResponse = z.infer<
  typeof A.adminAssetGroupListResponseSchema
>;
/** One membership, joined to its asset and its role label. */
export type AdminAssetGroupMemberDto = z.infer<
  typeof A.adminAssetGroupMemberDtoSchema
>;
export type AdminAssetGroupMembersResponse = z.infer<
  typeof A.adminAssetGroupMembersResponseSchema
>;
export type SetAssetGroupMemberRoleBody = z.infer<
  typeof A.setAssetGroupMemberRoleBodySchema
>;
export type AdminPointKeyDto = z.infer<typeof A.adminPointKeyDtoSchema>;
export type AdminOrganizationSummaryDto = z.infer<
  typeof A.adminOrganizationSummaryDtoSchema
>;
export type AdminLocationSummaryDto = z.infer<typeof A.adminLocationSummaryDtoSchema>;
export type AdminRtuSummaryDto = z.infer<typeof A.adminRtuSummaryDtoSchema>;
export type AdminAssetSummaryDto = z.infer<typeof A.adminAssetSummaryDtoSchema>;

// ---------------------------------------------------------------------------
// Telemetry entry — manual + bulk import (ADR 0018, `F1.8`/`F1.9`)
// ---------------------------------------------------------------------------

/** The full `bms.asset_points.source_kind` vocabulary. */
export type PointSourceKind = z.infer<typeof Te.pointSourceKindSchema>;
/** What a caller may ask the write path for — excludes `measured`. */
export type WritableSourceKind = z.infer<typeof Te.writableSourceKindSchema>;
export type TelemetryEntryRow = z.infer<typeof Te.telemetryEntryRowSchema>;
export type RejectedRowDto = z.infer<typeof Te.rejectedRowDtoSchema>;
export type TelemetryWriteResultDto = z.infer<typeof Te.telemetryWriteResultDtoSchema>;
/** The full write-response envelope returned by the F1.8/F1.9 write endpoints. */
export type TelemetryWriteResponse = z.infer<typeof Te.telemetryWriteResponseSchema>;
export type TelemetryImportPreviewDto = z.infer<typeof Ti.telemetryImportPreviewDtoSchema>;
export type TelemetryImportCommitDto = z.infer<typeof Ti.telemetryImportCommitDtoSchema>;

// ---------------------------------------------------------------------------
// Audit reads (ADR 0021, `F4.14`)
// ---------------------------------------------------------------------------

/**
 * One `bms.audit_log` row as returned by the read API.
 *
 * **`payload` is optional here and was required before the `F4.23` switch** —
 * the only contract this migration changed, and it could not be avoided: a
 * required `unknown` property is not expressible in Zod, because Zod marks any
 * key whose output includes `undefined` as optional and `unknown` includes it.
 * The practical gap is nil (`payload: unknown` already permitted the value
 * `undefined`), but it is a change and ADR 0030 Amendment 2 records it rather
 * than letting it pass unannounced.
 */
export type AuditLogEntryDto = z.infer<typeof A.auditLogEntryDtoSchema>;
/** Offset-paginated audit list. `F4.22` adds a cursor without removing these. */
export type AuditLogListResponse = z.infer<typeof A.auditLogListResponseSchema>;

// ---------------------------------------------------------------------------
// Asset templates (ADR 0015 / ADR 0019)
// ---------------------------------------------------------------------------

/** Lifecycle of an asset template version (ADR 0015). */
export type AssetTemplateStatus = z.infer<typeof A.assetTemplateStatusSchema>;
/** Whether instantiation emits an `asset_points` row for this point. */
export type TemplatePointKind = z.infer<typeof A.templatePointKindSchema>;
export type AdminTemplatePointDto = z.infer<typeof A.adminTemplatePointDtoSchema>;
export type AdminAssetTemplateDto = z.infer<typeof A.adminAssetTemplateDtoSchema>;
/** List rows omit `points` — the editor fetches them per template. */
export type AdminAssetTemplateSummaryDto = z.infer<
  typeof A.adminAssetTemplateSummaryDtoSchema
>;
export type InstantiatedAssetDto = z.infer<typeof A.instantiatedAssetDtoSchema>;
/** The result of one instantiate call — the whole batch or nothing. */
export type AssetInstantiationResultDto = z.infer<
  typeof A.assetInstantiationResultDtoSchema
>;

// `F2.6` template version lifecycle (ADR 0039).
/** The five calc columns — the same shape as template value, override and effective. */
export type AssetPointCalcOverrideFields = z.infer<
  typeof A.assetPointCalcOverrideFieldsSchema
>;
/** One derived point of one asset: template, override and resolved values. */
export type AssetPointCalcConfigDto = z.infer<typeof A.assetPointCalcConfigDtoSchema>;
/** One version of a template code, with how much of the estate sits on it. */
export type TemplateVersionSummaryDto = z.infer<typeof A.templateVersionSummaryDtoSchema>;
export type TemplateMigrationRefusalReason = z.infer<
  typeof A.templateMigrationRefusalReasonSchema
>;
export type TemplateMigrationRefusalDto = z.infer<
  typeof A.templateMigrationRefusalDtoSchema
>;
export type TemplateMeasuredAdditionDto = z.infer<
  typeof A.templateMeasuredAdditionDtoSchema
>;
export type TemplateMeasuredChangeDto = z.infer<typeof A.templateMeasuredChangeDtoSchema>;
/** Which of the five calc fields moved between two versions. */
export type TemplateCalcField = z.infer<typeof A.templateCalcFieldSchema>;
export type TemplateDerivedChangeDto = z.infer<typeof A.templateDerivedChangeDtoSchema>;
export type TemplateDerivedAdditionDto = z.infer<typeof A.templateDerivedAdditionDtoSchema>;
export type TemplateDerivedRemovalDto = z.infer<typeof A.templateDerivedRemovalDtoSchema>;
/** Keyed on `point_key` throughout, never on `template_points.id` (D-4). */
export type TemplateVersionDeltaDto = z.infer<typeof A.templateVersionDeltaDtoSchema>;
export type TemplateMigrationAssetDto = z.infer<typeof A.templateMigrationAssetDtoSchema>;
export type TemplateMigrationSkippedPointDto = z.infer<
  typeof A.templateMigrationSkippedPointDtoSchema
>;

// ---------------------------------------------------------------------------
// AI onboarding wizard (ADR 0011, ADR 0022)
// ---------------------------------------------------------------------------

/** Onboarding wizard phase tracked by the AI bot. */
export type OnboardingPhase = z.infer<typeof Ob.onboardingPhaseSchema>;
export type OnboardingProtocol = z.infer<typeof Ob.onboardingProtocolSchema>;
export type OnboardingSessionStatus = z.infer<typeof Ob.onboardingSessionStatusSchema>;
export type OnboardingChatMessage = z.infer<typeof Ob.onboardingChatMessageSchema>;
export type OnboardingFieldError = z.infer<typeof Ob.onboardingFieldErrorSchema>;
export type OnboardingAutoOpenReason = z.infer<typeof Ob.onboardingAutoOpenReasonSchema>;
export type OnboardingDraftLocation = z.infer<typeof Ob.onboardingDraftLocationSchema>;
export type OnboardingDraftRtu = z.infer<typeof Ob.onboardingDraftRtuSchema>;
export type OnboardingDraftPointKey = z.infer<typeof Ob.onboardingDraftPointKeySchema>;
export type OnboardingDraftAsset = z.infer<typeof Ob.onboardingDraftAssetSchema>;
export type OnboardingDraftAssetPoint = z.infer<typeof Ob.onboardingDraftAssetPointSchema>;
export type OnboardingDraftMeta = z.infer<typeof Ob.onboardingDraftMetaSchema>;
export type OnboardingDraft = z.infer<typeof Ob.onboardingDraftSchema>;
export type OnboardingSessionDto = z.infer<typeof Ob.onboardingSessionDtoSchema>;
export type OnboardingChatResponseDto = z.infer<typeof Ob.onboardingChatResponseDtoSchema>;
export type OnboardingValidateResponseDto = z.infer<
  typeof Ob.onboardingValidateResponseDtoSchema
>;
export type OnboardingCommitResponseDto = z.infer<
  typeof Ob.onboardingCommitResponseDtoSchema
>;

// ---------------------------------------------------------------------------
// Response envelopes
//
// These lived in `apps/web/src/api/` — thirteen `export type XListResponse =
// { items: SomeDto[] }` declarations beside the fetch that cast to them, plus
// one (`AssetRow`) with no shared counterpart at all. A row type shared while
// the envelope around it is stranded in one app is a contract that is only
// half shared, and only the shared half was checkable.
// ---------------------------------------------------------------------------

export type OrganizationsListResponse = z.infer<typeof E.organizationsListResponseSchema>;
export type LocationsListResponse = z.infer<typeof E.locationsListResponseSchema>;
export type RtusListResponse = z.infer<typeof E.rtusListResponseSchema>;
export type AssetsListResponse = z.infer<typeof E.assetsListResponseSchema>;
export type AssetPointsListResponse = z.infer<typeof E.assetPointsListResponseSchema>;
export type PointKeysListResponse = z.infer<typeof E.pointKeysListResponseSchema>;
/** `F3.1b`/`F3.1d` (ADR 0047) — `GET /dashboards`. */
export type DashboardsListResponse = z.infer<typeof E.dashboardsListResponseSchema>;
/** `F3.1b`/`F3.1d` (ADR 0047) — `DELETE /dashboards/:id`. */
export type DashboardDeletedResponse = z.infer<typeof E.dashboardDeletedResponseSchema>;
/** `F2.5` (ADR 0038) — the template list. Rows omit `points`, carry `pointCount`. */
export type AssetTemplatesListResponse = z.infer<
  typeof E.assetTemplatesListResponseSchema
>;
/** `F2.5` (ADR 0038) — `DELETE /admin/asset-templates/:id` on a draft. */
export type TemplateDraftDeletedResponse = z.infer<
  typeof E.templateDraftDeletedResponseSchema
>;
/** `F2.6` (ADR 0039) — one asset's derived points, template vs override vs effective. */
export type AssetPointCalcConfigListResponse = z.infer<
  typeof E.assetPointCalcConfigListResponseSchema
>;
/** `F2.6` (ADR 0039) — every version of one template code. */
export type TemplateVersionsListResponse = z.infer<
  typeof E.templateVersionsListResponseSchema
>;
/** `F2.6` (ADR 0039) — decision 2's preview. Writes nothing. */
export type TemplateMigrationPreviewResponse = z.infer<
  typeof E.templateMigrationPreviewResponseSchema
>;
/** `F2.6` (ADR 0039) — decision 1's explicit, audited apply. */
export type TemplateMigrationResultResponse = z.infer<
  typeof E.templateMigrationResultResponseSchema
>;
export type AlarmsListResponse = z.infer<typeof E.alarmsListResponseSchema>;
export type WorkOrdersListResponse = z.infer<typeof E.workOrdersListResponseSchema>;
export type MaintenanceSchedulesResponse = z.infer<
  typeof E.maintenanceSchedulesResponseSchema
>;
export type ConvertMaintenanceResponse = z.infer<typeof E.convertMaintenanceResponseSchema>;
export type RulesResponse = z.infer<typeof E.rulesResponseSchema>;
export type RuleExecutionsResponse = z.infer<typeof E.ruleExecutionsResponseSchema>;
export type RuleBuilderCatalogResponse = z.infer<typeof E.ruleBuilderCatalogResponseSchema>;
/** `GET /api/v1/assets` — the asset picker's row (was `AssetRow` in `apps/web`). */
export type AssetPickerRow = z.infer<typeof E.assetPickerRowSchema>;

// ---------------------------------------------------------------------------
// Notifications (`F3.8`, ADR 0041)
// ---------------------------------------------------------------------------
/** The five outcomes of one dispatch attempt, three of them skips. */
export type NotificationDeliveryStatus = z.infer<typeof N.notificationDeliveryStatusSchema>;
/** A configured destination. Carries `hasSecret`, never a secret (§9.6). */
export type NotificationChannelDto = z.infer<typeof N.notificationChannelDtoSchema>;
/** One row of the delivery ledger — every attempt, including every skip. */
export type NotificationDeliveryDto = z.infer<typeof N.notificationDeliveryDtoSchema>;
/** Whether a transport can send at all, per kind. */
export type NotificationReadinessDto = z.infer<typeof N.notificationReadinessDtoSchema>;
/** The outcome of `POST /notifications/channels/:id/test`. */
export type NotificationTestResult = z.infer<typeof N.notificationTestResultSchema>;
export type NotificationChannelsListResponse = z.infer<
  typeof E.notificationChannelsListResponseSchema
>;
export type NotificationDeliveriesResponse = z.infer<
  typeof E.notificationDeliveriesResponseSchema
>;
export type NotificationReadinessResponse = z.infer<
  typeof E.notificationReadinessResponseSchema
>;
export type NotificationTestResultResponse = z.infer<
  typeof E.notificationTestResultResponseSchema
>;
/** `POST /notifications/channels` and `PATCH /notifications/channels/:id`. */
export type NotificationChannelResponse = z.infer<
  typeof E.notificationChannelResponseSchema
>;
export type NotificationChannelDeletedResponse = z.infer<
  typeof E.notificationChannelDeletedResponseSchema
>;
/** `GET` and `PUT /rules/:id/notifications` (plan D1). */
export type RuleNotificationsResponse = z.infer<typeof E.ruleNotificationsResponseSchema>;

// ---------------------------------------------------------------------------
// Re-exported sibling modules
// ---------------------------------------------------------------------------

/**
 * The `asset_templates.content` overlay model (ADR 0019, backlog `E1.7`) —
 * `TemplateContent` and its sections. Its own module because this file used to
 * sit at the AGENTS.md §4.5 1000-line cap.
 */
export type * from "./asset-template-content";

/**
 * Ingest data contracts (ADR 0016 §8). Re-exported here, not only under the
 * `./ingest` subpath, because `apps/api` compiles with `moduleResolution:
 * "node"` (node10), which ignores the `exports` map entirely — and the
 * `/admin/*` RTU screens are one of the two consumers §8 cites. The type-only
 * import back from `./index` inside `ingest.ts` is erased at emit, so there is
 * no runtime cycle.
 *
 * These types are deliberately NOT converted to schemas by `F4.23`: they are
 * an adapter interface, not a wire contract, and nothing crosses HTTP.
 */
export * from "./ingest";
