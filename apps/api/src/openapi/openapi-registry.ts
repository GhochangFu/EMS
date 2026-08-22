import type { ZodTypeAny } from "zod";

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
  createRtuBodySchema,
  updateRtuBodySchema,
} from "../admin/rtus/rtus.schema";
import { manualReadingsBodySchema } from "../admin/telemetry-entry/manual-readings.schema";
import { alarmAckBodySchema } from "../alarms/ack.schema";
import { alarmEnrichmentUpsertBodySchema } from "../alarms/enrichment.schema";
import { loginBodySchema } from "../auth/login.schema";
import { locationDashboardQuerySchema } from "../dashboard/dashboard.schema";
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
  AssetPointCalcOverrideController_set: assetPointCalcOverrideBodySchema,
  AssetPointsAdminController_create: createAssetPointBodySchema,
  AssetPointsAdminController_update: updateAssetPointBodySchema,
  AssetsAdminController_create: createAssetBodySchema,
  AssetsAdminController_update: updateAssetBodySchema,
  AssetTemplatesAdminController_create: createAssetTemplateBodySchema,
  AssetTemplatesAdminController_instantiate: instantiateAssetsBodySchema,
  AssetTemplatesAdminController_list: templateStatusQuerySchema,
  AssetTemplatesAdminController_migrate: migrateAssetsBodySchema,
  AssetTemplatesAdminController_previewMigration: migrateAssetsBodySchema,
  AssetTemplatesAdminController_update: updateAssetTemplateBodySchema,
  AuditAdminController_export: auditExportQuerySchema,
  AuditAdminController_list: auditListQuerySchema,
  AuthController_login: loginBodySchema,
  DashboardController_energyTopConsumers: locationDashboardQuerySchema,
  LocationsAdminController_create: createLocationBodySchema,
  LocationsAdminController_update: updateLocationBodySchema,
  MaintenanceController_convert: convertMaintenanceBodySchema,
  MaintenanceController_createSchedule: createMaintenanceScheduleBodySchema,
  MaintenanceController_listSchedules: listMaintenanceQuerySchema,
  MaintenanceController_updateSchedule: updateMaintenanceScheduleBodySchema,
  ManualReadingsController_create: manualReadingsBodySchema,
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
  RulesController_updateRule: ruleUpdateBodySchema,
  WorkOrdersController_close: closeWorkOrderBodySchema,
  WorkOrdersController_create: createWorkOrderBodySchema,
  WorkOrdersController_reorder: reorderWorkOrdersBodySchema,
  WorkOrdersController_updateStatus: updateWorkOrderStatusBodySchema,
};

/** Every operationId the registry describes. */
export const REGISTERED_OPERATION_IDS = Object.keys(REQUEST_SCHEMAS);
