import type { ZodTypeAny } from "zod";

import { setAssetGroupMemberRoleBodySchema } from "../admin/asset-groups/asset-groups.schema";
import { assetPointCalcOverrideBodySchema } from "../admin/asset-points/asset-point-calc-override.schema";
import {
  createAssetPointBodySchema,
  updateAssetPointBodySchema,
} from "../admin/asset-points/asset-points.schema";
import { migrateAssetsBodySchema } from "../admin/asset-templates/asset-templates-migrate.schema";
import {
  createAssetTemplateBodySchema,
  instantiateAssetsBodySchema,
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
import {
  chatBodySchema,
  createSessionBodySchema,
  patchDraftBodySchema,
  setCredentialsBodySchema,
} from "../admin/onboarding/onboarding.schema";
import {
  createOrganizationBodySchema,
  updateOrganizationBodySchema,
} from "../admin/organizations/organizations.schema";
import {
  createPointKeyBodySchema,
  updatePointKeyBodySchema,
} from "../admin/point-keys/point-keys.schema";
import {
  createAssetRoleBodySchema,
  updateAssetRoleBodySchema,
} from "../admin/vocabularies/asset-roles.schema";
import {
  createRtuBodySchema,
  updateRtuBodySchema,
} from "../admin/rtus/rtus.schema";
import { manualReadingsBodySchema } from "../admin/telemetry-entry/manual-readings.schema";
import {
  assetHealthQuerySchema,
  healthSummaryQuerySchema,
} from "../asset-health/asset-health.schema";
import { pointAggregateQuerySchema } from "../telemetry/telemetry.schema";
import {
  createNotificationChannelBodySchema,
  listDeliveriesQuerySchema,
  setRuleNotificationsBodySchema,
  updateNotificationChannelBodySchema,
} from "../notifications/notifications.schema";
import { alarmAckBodySchema } from "../alarms/ack.schema";
import { alarmEnrichmentUpsertBodySchema } from "../alarms/enrichment.schema";
import { loginBodySchema } from "../auth/login.schema";
import { locationDashboardQuerySchema } from "../dashboard/dashboard.schema";
import {
  createDashboardBodySchema,
  getDashboardQuerySchema,
  listDashboardsQuerySchema,
  putDashboardWidgetsBodySchema,
  updateDashboardBodySchema,
} from "../dashboard-builder/dashboards.schema";
import {
  convertMaintenanceBodySchema,
  createMaintenanceScheduleBodySchema,
  listMaintenanceQuerySchema,
  updateMaintenanceScheduleBodySchema,
} from "../maintenance/maintenance.schema";
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
 * with a `file` field the document has no way to say) follow it. Documenting
 * multipart shape properly is a generator change, out of scope here.
 */
export const REQUEST_SCHEMAS: Record<string, ZodTypeAny> = {
  AlarmsController_acknowledge: alarmAckBodySchema,
  AlarmsController_upsertEnrichment: alarmEnrichmentUpsertBodySchema,
  AssetGroupMembersAdminController_setRole: setAssetGroupMemberRoleBodySchema,
  AssetPointCalcOverrideController_set: assetPointCalcOverrideBodySchema,
  AssetPointsAdminController_create: createAssetPointBodySchema,
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
  AssetHealthController_forAsset: assetHealthQuerySchema,
  AssetHealthController_summary: healthSummaryQuerySchema,
  AssetsAdminController_create: createAssetBodySchema,
  AssetsAdminController_update: updateAssetBodySchema,
  AssetTemplatesAdminController_create: createAssetTemplateBodySchema,
  AssetTemplatesAdminController_instantiate: instantiateAssetsBodySchema,
  AssetTemplatesAdminController_list: templateStatusQuerySchema,
  AssetTemplatesAdminController_migrate: migrateAssetsBodySchema,
  AssetTemplatesAdminController_previewMigration: migrateAssetsBodySchema,
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
  DashboardBuilderController_update: updateDashboardBodySchema,
  DashboardController_energyTopConsumers: locationDashboardQuerySchema,
  LocationsAdminController_create: createLocationBodySchema,
  LocationsAdminController_update: updateLocationBodySchema,
  MaintenanceController_convert: convertMaintenanceBodySchema,
  MaintenanceController_createSchedule: createMaintenanceScheduleBodySchema,
  MaintenanceController_listSchedules: listMaintenanceQuerySchema,
  MaintenanceController_updateSchedule: updateMaintenanceScheduleBodySchema,
  ManualReadingsController_create: manualReadingsBodySchema,
  NotificationsController_createChannel: createNotificationChannelBodySchema,
  NotificationsController_listDeliveries: listDeliveriesQuerySchema,
  NotificationsController_updateChannel: updateNotificationChannelBodySchema,
  OnboardingController_chat: chatBodySchema,
  OnboardingController_createSession: createSessionBodySchema,
  OnboardingController_patchDraft: patchDraftBodySchema,
  OnboardingController_setCredentials: setCredentialsBodySchema,
  OrganizationsAdminController_create: createOrganizationBodySchema,
  OrganizationsAdminController_update: updateOrganizationBodySchema,
  PointKeysAdminController_create: createPointKeyBodySchema,
  PointKeysAdminController_update: updatePointKeyBodySchema,
  ReportsController_energyCsv: energyReportQuerySchema,
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
  WorkOrdersController_close: closeWorkOrderBodySchema,
  WorkOrdersController_create: createWorkOrderBodySchema,
  WorkOrdersController_reorder: reorderWorkOrdersBodySchema,
  WorkOrdersController_updateStatus: updateWorkOrderStatusBodySchema,
};

/** Every operationId the registry describes. */
export const REGISTERED_OPERATION_IDS = Object.keys(REQUEST_SCHEMAS);
