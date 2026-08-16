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
import type * as E from "./contracts/envelopes";
import type * as Ob from "./contracts/onboarding";
import type * as Op from "./contracts/operations";
import { TELEMETRY_POINT_REF_SEP } from "./constants";

/** Point-key catalogues and the `pointRef` separator — the non-contract half. */
export * from "./constants";

/** The schemas themselves. See the note above on why they are re-exported. */
export * from "./contracts";

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
/** `GET /api/v1/vocabularies` — both axes, so a page renders neither half-loaded. */
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
export type AdminPointKeyDto = z.infer<typeof A.adminPointKeyDtoSchema>;
export type AdminOrganizationSummaryDto = z.infer<
  typeof A.adminOrganizationSummaryDtoSchema
>;
export type AdminLocationSummaryDto = z.infer<typeof A.adminLocationSummaryDtoSchema>;
export type AdminRtuSummaryDto = z.infer<typeof A.adminRtuSummaryDtoSchema>;
export type AdminAssetSummaryDto = z.infer<typeof A.adminAssetSummaryDtoSchema>;

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
