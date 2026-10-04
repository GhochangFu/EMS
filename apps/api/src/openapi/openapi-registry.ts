import {
  addAssetGroupMemberBodySchema,
  addUserGrantBodySchema,
  createAssetGroupBodySchema,
  createUserBodySchema,
  temporaryPasswordBodySchema,
  updateAssetGroupBodySchema,
  updateUserBodySchema,
} from "@bms/shared";
import type { ZodTypeAny } from "zod";

import { setAssetGroupMemberRoleBodySchema } from "../admin/asset-groups/asset-groups.schema";
import { assetPointCalcOverrideBodySchema } from "../admin/asset-points/asset-point-calc-override.schema";
import {
  assetPointBulkUpdateBodySchema,
  createAssetPointBodySchema,
  mappingSheetQuerySchema,
  updateAssetPointBodySchema,
} from "../admin/asset-points/asset-points.schema";
import { migrateAssetsBodySchema } from "../admin/asset-templates/asset-templates-migrate.schema";
import {
  createAssetTemplateBodySchema,
  instantiateAssetsBodySchema,
  reapplySeededRulesBodySchema,
  templateStatusQuerySchema,
  updateAssetTemplateBodySchema,
} from "../admin/asset-templates/asset-templates.schema";
import {
  createDashboardTemplateBodySchema,
  importStockTemplateBodySchema,
  instantiateSectionTemplateBodySchema,
  listDashboardTemplatesQuerySchema,
  updateDashboardTemplateBodySchema,
} from "../admin/dashboard-templates/dashboard-templates.schema";
import {
  createAssetBodySchema,
  updateAssetBodySchema,
} from "../admin/assets/assets.schema";
import {
  auditExportQuerySchema,
  auditListQuerySchema,
} from "../admin/audit/audit.schema";
import {
  createLocationBodySchema,
  updateLocationBodySchema,
} from "../admin/locations/locations.schema";
import { putSiteControlRoomViewBodySchema } from "../control-room/site-control-room-view.schema";
import { siteLayoutBodySchema } from "../control-room/site-layout.schema";
import {
  createMimicLayoutBodySchema,
  putMimicLayoutBodySchema,
} from "../mimic-layouts/mimic-layouts.schema";
import {
  createMimicOrgSymbolLibraryBodySchema,
  putMimicLibrarySettingBodySchema,
  updateMimicOrgSymbolBodySchema,
  updateMimicOrgSymbolLibraryBodySchema,
} from "../mimic-symbol-libraries/mimic-symbol-libraries.schema";
import {
  chatBodySchema,
  createSessionBodySchema,
  patchDraftBodySchema,
  setCredentialsBodySchema,
} from "../admin/onboarding/onboarding.schema";
import {
  createCalcParameterBodySchema,
  listCalcParametersQuerySchema,
  updateCalcParameterBodySchema,
} from "../admin/calc-parameters/calc-parameters.schema";
import {
  createOrganizationBodySchema,
  updateOrganizationBodySchema,
} from "../admin/organizations/organizations.schema";
import {
  putAiAssistantSettingsBodySchema,
  testAiAssistantBodySchema,
} from "../admin/ai-assistant/ai-assistant-settings.schema";
import {
  createPointKeyBodySchema,
  updatePointKeyBodySchema,
} from "../admin/point-keys/point-keys.schema";
import {
  createAssetRoleBodySchema,
  updateAssetRoleBodySchema,
} from "../admin/vocabularies/asset-roles.schema";
import {
  createLocationTypeBodySchema,
  updateLocationTypeBodySchema,
} from "../admin/vocabularies/location-types.schema";
import {
  createRtuBodySchema,
  updateRtuBodySchema,
} from "../admin/rtus/rtus.schema";
import { manualReadingsBodySchema } from "../admin/telemetry-entry/manual-readings.schema";
import {
  assetHealthQuerySchema,
  healthSummaryQuerySchema,
} from "../asset-health/asset-health.schema";
import {
  pointAggregateQuerySchema,
  pointsLatestQuerySchema,
  pointValuesAtQuerySchema,
} from "../telemetry/telemetry.schema";
import {
  createEscalationProfileBodySchema,
  escalationDefaultsQuerySchema,
  setEscalationDefaultsBodySchema,
  updateEscalationProfileBodySchema,
} from "../notifications/escalation-profiles.schema";
import {
  createNotificationChannelBodySchema,
  listDeliveriesQuerySchema,
  setRuleNotificationsBodySchema,
  updateNotificationChannelBodySchema,
} from "../notifications/notifications.schema";
import { alarmAckBodySchema } from "../alarms/ack.schema";
import { alarmListQuerySchema, alarmSummaryQuerySchema } from "../alarms/alarm-list.schema";
import { alarmEnrichmentUpsertBodySchema } from "../alarms/enrichment.schema";
import { assetRoleSummaryQuerySchema } from "../assets/assets.schema";
import { loginBodySchema } from "../auth/login.schema";
import { loadTrendQuerySchema, locationDashboardQuerySchema } from "../dashboard/dashboard.schema";
import {
  createDashboardBodySchema,
  getDashboardQuerySchema,
  listDashboardsQuerySchema,
  putDashboardWidgetsBodySchema,
  updateDashboardBodySchema,
} from "../dashboard-builder/dashboards.schema";
import { siteWidgetsQuerySchema } from "../dashboard-builder/site-widgets.schema";
import {
  convertMaintenanceBodySchema,
  createMaintenanceScheduleBodySchema,
  listMaintenanceQuerySchema,
  updateMaintenanceScheduleBodySchema,
} from "../maintenance/maintenance.schema";
import {
  listReportFilesQuerySchema,
  saveEnergyReportFileBodySchema,
} from "../reports/report-files.schema";
import {
  createReportScheduleBodySchema,
  updateReportScheduleBodySchema,
} from "../reports/report-schedules.schema";
import { energyReportQuerySchema } from "../reports/reports.schema";
import {
  listRuleExecutionsQuerySchema,
  ruleDraftBodySchema,
  ruleLifecycleBodySchema,
  rulePreviewBodySchema,
  ruleToggleBodySchema,
  ruleUpdateBodySchema,
} from "../rules/rules.schema";
import {
  closeWorkOrderBodySchema,
  createWorkOrderBodySchema,
  reorderWorkOrdersBodySchema,
  updateWorkOrderStatusBodySchema,
} from "../work-orders/work-order.schema";

/**
 * `F4.20` / ADR 0029 decision 3 — the join between a route and the Zod schema
 * that validates it.
 *
 * **A registry rather than a decorator on every handler**, which is what the
 * ADR chose: 43 entries in one reviewable file, against 43 edits spread across
 * 20 controllers where a missing one is invisible.
 *
 * Keys are Nest's own `operationId` (`ControllerClass_handlerName`), so a route
 * can be re-pathed without touching this file — the binding is to the code that
 * handles the request, not to the URL it happens to live at.
 *
 * The values are the **same schema objects the handlers call `.parse()` on**,
 * imported rather than restated. That is ADR 0029 decision 1: there is exactly
 * one description of each payload and this file points at it. A renamed or
 * deleted schema is a **compile error here**, not a silently stale document.
 *
 * What this file cannot catch on its own is a handler that gains a schema and
 * is never added here — it would simply be absent from the document, which
 * reads as "no body". `tests/adr-0029-openapi-contract.test.ts` is what makes
 * that fail.
 *
 * **Multipart routes are deliberately absent.** The document generator hard-
 * codes `application/json` for every registered operation, so a `multipart/
 * form-data` route (a file upload) would be described wrong, not left
 * undescribed, if it were registered here — worse than the "no body" gap
 * above. `OnboardingController_uploadExcel` set this precedent; `Telemetry-
 * ImportController_preview`/`_commit` (`F1.9`, both `FileInterceptor` routes
 * with a `file` field the document has no way to say) follow it.
 * `AssetPointsAdminController_previewMappingSheet`/`_commitMappingSheet`
 * (`F2.7`, ADR 0056 decision 7) are the same case again — the uploaded
 * `MAPPINGS` workbook is the `file` field, and their one query parameter is
 * registered on the sibling download, `_exportMappingSheet`, which is not
 * multipart. `AssetImagesWriteController_upload` (`F3.4`, ADR 0066 decision 7)
 * is the sixth absence by the same rule — a `file` part plus an optional
 * `caption` field — and its sibling `AssetImagesWriteController_remove` is
 * absent because it takes no body and no query, the
 * `EscalationProfilesController_remove` case below. Documenting multipart
 * shape properly is a generator change, out of scope here.
 *
 * **`ReportFilesController_download` and `_remove` are absent** (`F3.5a`,
 * ADR 0071 decision 11) for the non-multipart reason: each takes one path
 * parameter and no body and no query, which Nest's own reflection describes
 * — the `EscalationProfilesController_remove` case again. Their siblings
 * `_save` (a body) and `_list` (a query) are registered below.
 * **`ReportSchedulesController_list`, `_get` and `_remove` are absent** by
 * the same rule (`F3.5b`): `_list` takes no body and no query at all, and
 * `_get`/`_remove` take one path parameter; `_create` and `_update` carry the
 * two bodies and are registered.
 */
export const REQUEST_SCHEMAS: Record<string, ZodTypeAny> = {
  AlarmsController_acknowledge: alarmAckBodySchema,
  AlarmsController_list: alarmListQuerySchema,
  AlarmsController_summary: alarmSummaryQuerySchema,
  AlarmsController_upsertEnrichment: alarmEnrichmentUpsertBodySchema,
  AssetGroupMembersAdminController_setRole: setAssetGroupMemberRoleBodySchema,
  // `F3.78` (ADR 0089 decision 7) — the three asset-group write bodies, registered for the
  // `F4.20` reason every entry here exists. `_list` and `_members` (reads) are absent: a
  // `locationId` query read and a path parameter. `AssetGroupMembersAdminController_remove` is
  // absent — one path parameter, no body, no query.
  AssetGroupsAdminController_addMember: addAssetGroupMemberBodySchema,
  AssetGroupsAdminController_create: createAssetGroupBodySchema,
  AssetGroupsAdminController_update: updateAssetGroupBodySchema,
  AssetPointCalcOverrideController_set: assetPointCalcOverrideBodySchema,
  // `F2.7` (ADR 0056 decision 8) — the bulk editor's body. Registered rather
  // than left out for the two reasons the `F3.40` note below gives: an
  // unregistered route reads as "no body" in the served document, and
  // `strict-body-ledger.spec.ts` walks only what is reachable from here, so
  // both `.strict()` objects would carry no recorded decision.
  AssetPointsAdminController_bulkUpdate: assetPointBulkUpdateBodySchema,
  AssetPointsAdminController_create: createAssetPointBodySchema,
  // `F2.7` (ADR 0056 decision 6) — the mapping sheet's only parameter, on the
  // one of its three routes the document can describe. The download is a plain
  // GET with a `.xlsx` response; the preview and commit siblings are multipart
  // and therefore absent, per the rule above.
  AssetPointsAdminController_exportMappingSheet: mappingSheetQuerySchema,
  AssetPointsAdminController_update: updateAssetPointBodySchema,
  // `F3.40` (ADR 0051 decision 5), registered for the second reason the `F3.36`
  // comment below states rather than the first: an unregistered route reads as
  // "no body" in the document, AND `strict-body-ledger.spec.ts` walks only what
  // is reachable from here, so these two `.strict()` bodies would carry no
  // recorded decision and a later reader removing `.strict()` would break no
  // gate. `AssetRolesAdminController_list` is deliberately absent, matching
  // `PointKeysAdminController_list` — the registry describes bodies, and
  // `parseActiveFilter` is not one.
  AssetRolesAdminController_create: createAssetRoleBodySchema,
  AssetRolesAdminController_update: updateAssetRoleBodySchema,
  // `F3.28` (ADR 0074, plan task 3.2) — the per-role summary's one optional
  // repeated `assetIds` parameter. A GET with no body, registered for the
  // `F4.20` reason every entry here exists: an undocumented scope parameter
  // and its `MAX_SCOPE_ASSET_IDS` bound are exactly that finding's omission.
  AssetsController_listRoleSummary: assetRoleSummaryQuerySchema,
  AssetHealthController_forAsset: assetHealthQuerySchema,
  AssetHealthController_summary: healthSummaryQuerySchema,
  AssetsAdminController_create: createAssetBodySchema,
  AssetsAdminController_update: updateAssetBodySchema,
  AssetTemplatesAdminController_create: createAssetTemplateBodySchema,
  // `F2.13` (ADR 0052 decision 4) — the same body schema the dashboard import
  // takes, reused by identity, so the ledger records one decision for it.
  AssetTemplatesAdminController_importStock: importStockTemplateBodySchema,
  AssetTemplatesAdminController_instantiate: instantiateAssetsBodySchema,
  AssetTemplatesAdminController_list: templateStatusQuerySchema,
  AssetTemplatesAdminController_migrate: migrateAssetsBodySchema,
  AssetTemplatesAdminController_previewMigration: migrateAssetsBodySchema,
  // `E2.4` (ADR 0058 decision 8) — the per-rule re-apply body.
  AssetTemplatesAdminController_reapplySeededRules: reapplySeededRulesBodySchema,
  AssetTemplatesAdminController_update: updateAssetTemplateBodySchema,
  // `F3.36` (ADR 0049). Registered for TWO reasons, and the second is the one
  // that bites: an unregistered route reads as "no body" in the generated
  // document, AND `strict-body-ledger.spec.ts` walks only what is reachable
  // from here — so the five `.strict()` bodies below were recorded by nothing,
  // and a later reader removing `.strict()` from the PATCH body would have
  // broken no gate. That removal is exactly the `F3.37` finding the ledger
  // exists for. Found by the `F3.36` correctness and compliance reviews.
  DashboardTemplatesController_create: createDashboardTemplateBodySchema,
  DashboardTemplatesController_importStock: importStockTemplateBodySchema,
  DashboardTemplatesController_instantiateTemplate: instantiateSectionTemplateBodySchema,
  DashboardTemplatesController_list: listDashboardTemplatesQuerySchema,
  DashboardTemplatesController_update: updateDashboardTemplateBodySchema,
  AuditAdminController_export: auditExportQuerySchema,
  AuditAdminController_list: auditListQuerySchema,
  AuthController_login: loginBodySchema,
  DashboardBuilderController_create: createDashboardBodySchema,
  DashboardBuilderController_getBySlug: getDashboardQuerySchema,
  DashboardBuilderController_list: listDashboardsQuerySchema,
  DashboardBuilderController_putWidgets: putDashboardWidgetsBodySchema,
  // `F3.73` (plan D9) — the site-widgets read's one query parameter, `tab`.
  DashboardBuilderController_siteWidgetsFor: siteWidgetsQuerySchema,
  DashboardBuilderController_update: updateDashboardBodySchema,
  DashboardController_energyTopConsumers: locationDashboardQuerySchema,
  // `F3.72` — `GET /dashboard/load-trend`: `window` plus the narrowing-only `organizationId`.
  DashboardController_loadTrend: loadTrendQuerySchema,
  // `F3.10` (ADR 0057 decision 7). Four operations across the two controllers
  // in `escalation-profiles.controller.ts`; the keys are Nest's own
  // `ControllerClass_handlerName`, copied from the classes and methods rather
  // than composed by hand — nothing fails if one is wrong, the route simply
  // reads as "no body" in the served document, which is the `F4.20` defect.
  // `EscalationProfilesController_list` and `_remove` are absent because they
  // take no body and no query.
  EscalationDefaultsController_get: escalationDefaultsQuerySchema,
  EscalationDefaultsController_set: setEscalationDefaultsBodySchema,
  EscalationProfilesController_create: createEscalationProfileBodySchema,
  EscalationProfilesController_update: updateEscalationProfileBodySchema,
  LocationsAdminController_create: createLocationBodySchema,
  LocationsAdminController_update: updateLocationBodySchema,
  // `F4.162` (ADR 0077 Amendment 1, plan D1/D4) — the two `.strict()` bodies
  // of the global-admin location-type catalog, registered so the served
  // document describes them and `strict-body-ledger.spec.ts` records their
  // decision. `LocationTypesVocabularyAdminController_list`, `_deactivate`
  // and `_reactivate` are deliberately absent — no body, no query.
  LocationTypesVocabularyAdminController_create: createLocationTypeBodySchema,
  LocationTypesVocabularyAdminController_update: updateLocationTypeBodySchema,
  // `F3.67` U4 (ADR 0076 decision 5, plan D4). `_getControlRoomView` is absent
  // — one path parameter, no body, no query, the `EscalationProfilesController_remove`
  // rule above. `SiteViewController_view` (the resolve read) is absent for the
  // same reason.
  LocationsAdminController_putControlRoomView: putSiteControlRoomViewBodySchema,
  // `F3.73` plan D6 — the "Make site layout" body. `DashboardTemplatesController_applyToSites`
  // is absent: one path parameter, no body, no query.
  LocationsAdminController_makeSiteLayout: siteLayoutBodySchema,
  MaintenanceController_convert: convertMaintenanceBodySchema,
  MaintenanceController_createSchedule: createMaintenanceScheduleBodySchema,
  MaintenanceController_listSchedules: listMaintenanceQuerySchema,
  MaintenanceController_updateSchedule: updateMaintenanceScheduleBodySchema,
  // `F3.32c` (ADR 0081 decision 3) — the mimic layout library's two write bodies.
  MimicLayoutsController_create: createMimicLayoutBodySchema,
  MimicLayoutsController_replace: putMimicLayoutBodySchema,
  // `F3.32f` slice 3 (ADR 0086 decisions 4, 6, 7) — the four JSON bodies. `_list` (a query) and
  // `_uploadSymbol` (multipart: the generator hard-codes application/json) are deliberately absent.
  MimicSymbolLibrariesController_create: createMimicOrgSymbolLibraryBodySchema,
  MimicSymbolLibrariesController_update: updateMimicOrgSymbolLibraryBodySchema,
  MimicSymbolLibrariesController_updateSymbol: updateMimicOrgSymbolBodySchema,
  MimicSymbolLibrariesController_putSetting: putMimicLibrarySettingBodySchema,
  ManualReadingsController_create: manualReadingsBodySchema,
  NotificationsController_createChannel: createNotificationChannelBodySchema,
  NotificationsController_listDeliveries: listDeliveriesQuerySchema,
  NotificationsController_updateChannel: updateNotificationChannelBodySchema,
  CalcParametersAdminController_create: createCalcParameterBodySchema,
  CalcParametersAdminController_list: listCalcParametersQuerySchema,
  CalcParametersAdminController_update: updateCalcParameterBodySchema,
  OnboardingController_chat: chatBodySchema,
  OnboardingController_createSession: createSessionBodySchema,
  OnboardingController_patchDraft: patchDraftBodySchema,
  OnboardingController_setCredentials: setCredentialsBodySchema,
  OrganizationsAdminController_create: createOrganizationBodySchema,
  OrganizationsAdminController_update: updateOrganizationBodySchema,
  // `F3.21` (ADR 0090 Amendment 1 A5). `_get` and `_remove` take no body.
  AiAssistantSettingsController_put: putAiAssistantSettingsBodySchema,
  AiAssistantSettingsController_test: testAiAssistantBodySchema,
  PointKeysAdminController_create: createPointKeyBodySchema,
  PointKeysAdminController_update: updatePointKeyBodySchema,
  // `F3.5a` (ADR 0071 decision 11). `_download` and `_remove` are absent —
  // one path parameter each, no body, no query; the docblock above says why.
  ReportFilesController_list: listReportFilesQuerySchema,
  ReportFilesController_save: saveEnergyReportFileBodySchema,
  // `F3.5b` (ADR 0071 decision 11). `_list`, `_get` and `_remove` are absent —
  // no body and no query (`_list` takes nothing at all; the cap bounds the
  // set), one path parameter for the other two; the docblock above says why.
  ReportSchedulesController_create: createReportScheduleBodySchema,
  ReportSchedulesController_update: updateReportScheduleBodySchema,
  ReportsController_energyCsv: energyReportQuerySchema,
  ReportsController_energyPdf: energyReportQuerySchema,
  ReportsController_energyPreview: energyReportQuerySchema,
  ReportsController_energyXlsx: energyReportQuerySchema,
  RtusAdminController_create: createRtuBodySchema,
  RtusAdminController_update: updateRtuBodySchema,
  RulesController_archiveRule: ruleLifecycleBodySchema,
  RulesController_createDraft: ruleDraftBodySchema,
  RulesController_duplicateRule: ruleLifecycleBodySchema,
  RulesController_listExecutions: listRuleExecutionsQuerySchema,
  RulesController_previewRule: rulePreviewBodySchema,
  RulesController_publishRule: ruleLifecycleBodySchema,
  RulesController_setEnabled: ruleToggleBodySchema,
  RulesController_setRuleNotifications: setRuleNotificationsBodySchema,
  RulesController_updateRule: ruleUpdateBodySchema,
  TelemetryController_aggregate: pointAggregateQuerySchema,
  // `F3.28` (ADR 0074 decision 2 / plan decision 2) — the batched instant read
  // `TelemetryController_atInstant` implements in task 2.3. A GET with two
  // query parameters and no body, registered ahead of the controller method
  // for the `F4.20` reason every entry here exists: an undocumented `refs`
  // bound is exactly the omission that finding is about.
  TelemetryController_atInstant: pointValuesAtQuerySchema,
  // `F4.176` (ADR 0074 Amendment 2) — the batched latest-value read: bounded
  // `assetIds` and `pointKeys` arrays and a bounded `windowMinutes`, no body.
  TelemetryController_latest: pointsLatestQuerySchema,
  // `F3.78` (ADR 0089 decisions 1 and 3) — the user-administration bodies. `UsersAdminController_list`,
  // `_deactivate` and `_reactivate`, and `UserGrantsAdminController_list` and `_remove`, are absent:
  // no body and no query, at most path parameters.
  UserGrantsAdminController_add: addUserGrantBodySchema,
  UsersAdminController_create: createUserBodySchema,
  UsersAdminController_temporaryPassword: temporaryPasswordBodySchema,
  UsersAdminController_update: updateUserBodySchema,
  WorkOrdersController_close: closeWorkOrderBodySchema,
  WorkOrdersController_create: createWorkOrderBodySchema,
  WorkOrdersController_reorder: reorderWorkOrdersBodySchema,
  WorkOrdersController_updateStatus: updateWorkOrderStatusBodySchema,
};

/** Every operationId the registry describes. */
export const REGISTERED_OPERATION_IDS = Object.keys(REQUEST_SCHEMAS);
