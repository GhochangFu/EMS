/**
 * TEMPORARY — the `F4.23` migration proof.
 *
 * Every schema in `contracts/` is asserted **strictly identical** to the
 * hand-written type it is about to replace in `index.ts`. This file exists for
 * exactly one commit: it is the evidence that the conversion is faithful.
 *
 * **It is deleted in the next commit, and that is deliberate.** Once `index.ts`
 * derives its types with `z.infer`, `Strict<z.infer<S>, z.infer<S>>` is
 * trivially `true` and every assertion below becomes a tautology. AGENTS.md
 * §4.4 is a list of guards that passed while checking nothing; leaving 79
 * vacuous assertions behind would be the ninth entry.
 *
 * The durable guards are different in kind and live in `tests/`: that no
 * contract type is hand-written beside its schema, and that no flattening
 * encoding is used. Neither of those goes vacuous after the switch.
 */
import type {
  AccessAssetGroup,
  AccessLocation,
  AccessScopeKind,
  AccessibleScope,
  AdminAssetDto,
  AdminAssetPointDto,
  AdminAssetSummaryDto,
  AdminAssetTemplateDto,
  AdminAssetTemplateSummaryDto,
  AdminLocationDto,
  AdminLocationSummaryDto,
  AdminOrganizationDto,
  AdminOrganizationSummaryDto,
  AdminPointKeyDto,
  AdminRtuDto,
  AdminRtuSummaryDto,
  AdminTemplatePointDto,
  AlarmListItem,
  AlarmSocketEvent,
  AssetInstantiationResultDto,
  AssetTemplateStatus,
  AuditLogEntryDto,
  AuditLogListResponse,
  AutomationRuleAction,
  AutomationRuleCategory,
  AutomationRuleCondition,
  AutomationRuleLifecycleStatus,
  AutomationRuleOperator,
  AutomationRuleSeverity,
  AutomationRuleType,
  CurrentUserResponse,
  DashboardKpis,
  EnergyCentreSummary,
  EnergyReportPreview,
  EnergyReportSourceTotals,
  EnergyReportTemplate,
  EnergySourceMixPoint,
  EnergyTopConsumer,
  InstantiatedAssetDto,
  JwtPayload,
  LoadTrendPoint,
  LocationDashboardDto,
  LocationKpiSummary,
  LoginResponse,
  MaintenanceDueState,
  MaintenanceGenerationMode,
  MaintenanceScheduleCategory,
  MaintenanceScheduleItem,
  MapSiteDto,
  MapSiteLive,
  MasterDataActiveFilter,
  OnboardingAutoOpenReason,
  OnboardingChatMessage,
  OnboardingChatResponseDto,
  OnboardingCommitResponseDto,
  OnboardingDraft,
  OnboardingDraftAsset,
  OnboardingDraftAssetPoint,
  OnboardingDraftLocation,
  OnboardingDraftMeta,
  OnboardingDraftPointKey,
  OnboardingDraftRtu,
  OnboardingFieldError,
  OnboardingPhase,
  OnboardingProtocol,
  OnboardingSessionDto,
  OnboardingSessionStatus,
  OnboardingValidateResponseDto,
  OrganizationRef,
  RtuSummary,
  RuleBuilderCatalogAsset,
  RuleExecutionItem,
  RuleExecutionStatus,
  RuleListItem,
  RulePreviewResult,
  TelemetryReading,
  TemplatePointKind,
  UserRole,
  WorkOrderListItem,
  WorkOrderPriority,
  WorkOrderStatus,
} from "../index";
import type { z } from "zod";

import * as A from "./admin";
import * as Au from "./auth";
import * as D from "./dashboard";
import * as Ob from "./onboarding";
import * as Op from "./operations";
import type { Measured, Strict } from "./equality";

type Same<S extends z.ZodTypeAny, T> = Measured<Strict<z.infer<S>, T>>;

// --- auth -------------------------------------------------------------------
export const p001: Same<typeof Au.userRoleSchema, UserRole> = true;
export const p002: Same<typeof Au.jwtPayloadSchema, JwtPayload> = true;
export const p003: Same<typeof Au.loginResponseSchema, LoginResponse> = true;
export const p004: Same<typeof Au.accessScopeKindSchema, AccessScopeKind> = true;
export const p005: Same<typeof Au.accessLocationSchema, AccessLocation> = true;
export const p006: Same<typeof Au.accessAssetGroupSchema, AccessAssetGroup> = true;
export const p007: Same<typeof Au.accessibleScopeSchema, AccessibleScope> = true;
export const p008: Same<typeof Au.currentUserResponseSchema, CurrentUserResponse> = true;

// --- dashboard / telemetry / map --------------------------------------------
export const p009: Same<typeof D.organizationRefSchema, OrganizationRef> = true;
export const p010: Same<typeof D.rtuSummarySchema, RtuSummary> = true;
export const p011: Same<typeof D.locationKpiSummarySchema, LocationKpiSummary> = true;
export const p012: Same<typeof D.locationDashboardDtoSchema, LocationDashboardDto> = true;
export const p013: Same<typeof D.telemetryReadingSchema, TelemetryReading> = true;
export const p014: Same<typeof D.dashboardKpisSchema, DashboardKpis> = true;
export const p015: Same<typeof D.loadTrendPointSchema, LoadTrendPoint> = true;
export const p016: Same<typeof D.mapSiteLiveSchema, MapSiteLive> = true;
export const p017: Same<typeof D.mapSiteDtoSchema, MapSiteDto> = true;

// --- energy -----------------------------------------------------------------
export const p018: Same<typeof Op.energyCentreSummarySchema, EnergyCentreSummary> = true;
export const p019: Same<typeof Op.energySourceMixPointSchema, EnergySourceMixPoint> = true;
export const p020: Same<typeof Op.energyTopConsumerSchema, EnergyTopConsumer> = true;
export const p021: Same<typeof Op.energyReportTemplateSchema, EnergyReportTemplate> = true;
export const p022: Same<typeof Op.energyReportSourceTotalsSchema, EnergyReportSourceTotals> = true;
export const p023: Same<typeof Op.energyReportPreviewSchema, EnergyReportPreview> = true;

// --- alarms -----------------------------------------------------------------
export const p024: Same<typeof Op.alarmListItemSchema, AlarmListItem> = true;
export const p025: Same<typeof Op.alarmSocketEventSchema, AlarmSocketEvent> = true;

// --- work orders / maintenance ----------------------------------------------
export const p026: Same<typeof Op.workOrderStatusSchema, WorkOrderStatus> = true;
export const p027: Same<typeof Op.workOrderPrioritySchema, WorkOrderPriority> = true;
export const p028: Same<typeof Op.maintenanceDueStateSchema, MaintenanceDueState> = true;
export const p029: Same<typeof Op.maintenanceScheduleCategorySchema, MaintenanceScheduleCategory> = true;
export const p030: Same<typeof Op.maintenanceGenerationModeSchema, MaintenanceGenerationMode> = true;
export const p031: Same<typeof Op.workOrderListItemSchema, WorkOrderListItem> = true;
export const p032: Same<typeof Op.maintenanceScheduleItemSchema, MaintenanceScheduleItem> = true;

// --- rule engine ------------------------------------------------------------
export const p033: Same<typeof Op.automationRuleTypeSchema, AutomationRuleType> = true;
export const p034: Same<typeof Op.automationRuleCategorySchema, AutomationRuleCategory> = true;
export const p035: Same<typeof Op.automationRuleOperatorSchema, AutomationRuleOperator> = true;
export const p036: Same<typeof Op.automationRuleSeveritySchema, AutomationRuleSeverity> = true;
export const p037: Same<typeof Op.automationRuleLifecycleStatusSchema, AutomationRuleLifecycleStatus> = true;
export const p038: Same<typeof Op.ruleExecutionStatusSchema, RuleExecutionStatus> = true;
export const p039: Same<typeof Op.automationRuleConditionSchema, AutomationRuleCondition> = true;
export const p040: Same<typeof Op.automationRuleActionSchema, AutomationRuleAction> = true;
export const p041: Same<typeof Op.ruleListItemSchema, RuleListItem> = true;
export const p042: Same<typeof Op.ruleBuilderCatalogAssetSchema, RuleBuilderCatalogAsset> = true;
export const p043: Same<typeof Op.rulePreviewResultSchema, RulePreviewResult> = true;
export const p044: Same<typeof Op.ruleExecutionItemSchema, RuleExecutionItem> = true;

// --- master data ------------------------------------------------------------
export const p045: Same<typeof A.masterDataActiveFilterSchema, MasterDataActiveFilter> = true;
export const p046: Same<typeof A.adminOrganizationDtoSchema, AdminOrganizationDto> = true;
export const p047: Same<typeof A.adminLocationDtoSchema, AdminLocationDto> = true;
export const p048: Same<typeof A.adminRtuDtoSchema, AdminRtuDto> = true;
export const p049: Same<typeof A.adminAssetDtoSchema, AdminAssetDto> = true;
export const p050: Same<typeof A.adminAssetPointDtoSchema, AdminAssetPointDto> = true;
export const p051: Same<typeof A.adminPointKeyDtoSchema, AdminPointKeyDto> = true;
export const p052: Same<typeof A.adminOrganizationSummaryDtoSchema, AdminOrganizationSummaryDto> = true;
export const p053: Same<typeof A.adminLocationSummaryDtoSchema, AdminLocationSummaryDto> = true;
export const p054: Same<typeof A.adminRtuSummaryDtoSchema, AdminRtuSummaryDto> = true;
export const p055: Same<typeof A.adminAssetSummaryDtoSchema, AdminAssetSummaryDto> = true;

// --- audit ------------------------------------------------------------------
//
// THE ONLY TWO OF 81 THAT DIFFER, and both for one reason: `AuditLogEntryDto`
// declares `payload: unknown` as a REQUIRED property, and that is not
// expressible in Zod. `z.unknown()` yields an OPTIONAL key, because Zod marks
// any key whose output includes `undefined` — and `unknown` includes it.
// Unlike the three encoding rules in Amendment 1, this has no passing sibling:
// `z.any()`, `z.custom<unknown>()` and every other spelling infer an output
// that `undefined` extends, so the key is optional in all of them.
//
// The gap is narrow. `payload: unknown` ALREADY permits the value `undefined`,
// so no consumer could ever have relied on the key carrying something — the
// difference is only whether a producer is forced to write the key. Recorded
// as `false` rather than smoothed over, because a weakened contract that slips
// in unannounced is exactly what this package now exists to prevent.
// ADR 0030 Amendment 2.
export const p056: Same<typeof A.auditLogEntryDtoSchema, AuditLogEntryDto> = false;
export const p057: Same<typeof A.auditLogListResponseSchema, AuditLogListResponse> = false;

// --- templates --------------------------------------------------------------
export const p058: Same<typeof A.assetTemplateStatusSchema, AssetTemplateStatus> = true;
export const p059: Same<typeof A.templatePointKindSchema, TemplatePointKind> = true;
export const p060: Same<typeof A.adminTemplatePointDtoSchema, AdminTemplatePointDto> = true;
export const p061: Same<typeof A.adminAssetTemplateDtoSchema, AdminAssetTemplateDto> = true;
export const p062: Same<typeof A.adminAssetTemplateSummaryDtoSchema, AdminAssetTemplateSummaryDto> = true;
export const p063: Same<typeof A.instantiatedAssetDtoSchema, InstantiatedAssetDto> = true;
export const p064: Same<typeof A.assetInstantiationResultDtoSchema, AssetInstantiationResultDto> = true;

// --- onboarding -------------------------------------------------------------
export const p065: Same<typeof Ob.onboardingPhaseSchema, OnboardingPhase> = true;
export const p066: Same<typeof Ob.onboardingProtocolSchema, OnboardingProtocol> = true;
export const p067: Same<typeof Ob.onboardingSessionStatusSchema, OnboardingSessionStatus> = true;
export const p068: Same<typeof Ob.onboardingChatMessageSchema, OnboardingChatMessage> = true;
export const p069: Same<typeof Ob.onboardingFieldErrorSchema, OnboardingFieldError> = true;
export const p070: Same<typeof Ob.onboardingAutoOpenReasonSchema, OnboardingAutoOpenReason> = true;
export const p071: Same<typeof Ob.onboardingDraftLocationSchema, OnboardingDraftLocation> = true;
export const p072: Same<typeof Ob.onboardingDraftRtuSchema, OnboardingDraftRtu> = true;
export const p073: Same<typeof Ob.onboardingDraftPointKeySchema, OnboardingDraftPointKey> = true;
export const p074: Same<typeof Ob.onboardingDraftAssetSchema, OnboardingDraftAsset> = true;
export const p075: Same<typeof Ob.onboardingDraftAssetPointSchema, OnboardingDraftAssetPoint> = true;
export const p076: Same<typeof Ob.onboardingDraftMetaSchema, OnboardingDraftMeta> = true;
export const p077: Same<typeof Ob.onboardingDraftSchema, OnboardingDraft> = true;
export const p078: Same<typeof Ob.onboardingSessionDtoSchema, OnboardingSessionDto> = true;
export const p079: Same<typeof Ob.onboardingChatResponseDtoSchema, OnboardingChatResponseDto> = true;
export const p080: Same<typeof Ob.onboardingValidateResponseDtoSchema, OnboardingValidateResponseDto> = true;
export const p081: Same<typeof Ob.onboardingCommitResponseDtoSchema, OnboardingCommitResponseDto> = true;
