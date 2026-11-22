import {
  addAssetGroupMemberBodySchema,
  addUserGrantBodySchema,
  createAssetGroupBodySchema,
  createUserBodySchema,
  temporaryPasswordBodySchema,
  updateAssetGroupBodySchema,
  updateUserBodySchema,
  assetPointCalcOverrideBodySchema,
  createDashboardTemplateBodySchema,
  importStockTemplateBodySchema,
  instantiateSectionTemplateBodySchema,
  updateDashboardTemplateBodySchema,
  createCalcParameterBodySchema,
  commitOnboardingBodySchema,
  copilotCreateConversationBodySchema,
  copilotStartOnboardingSkillBodySchema,
  copilotTurnBodySchema,
  updateCalcParameterBodySchema,
  createLocationTariffBodySchema,
  updateLocationTariffBodySchema,
  createTariffVersionBodySchema,
  updateTariffVersionBodySchema,
  createDashboardBodySchema,
  putDashboardWidgetsBodySchema,
  appendWidgetBodySchema,
  updateDashboardBodySchema,
  createAssetRoleBodySchema,
  updateAssetRoleBodySchema,
  createLocationTypeBodySchema,
  updateLocationTypeBodySchema,
  updateAssetDomainBodySchema,
  createMimicLayoutBodySchema,
  createMimicOrgSymbolLibraryBodySchema,
  putMimicLayoutBodySchema,
  putMimicLibrarySettingBodySchema,
  updateMimicOrgSymbolBodySchema,
  updateMimicOrgSymbolLibraryBodySchema,
  ruleBatchBodySchema,
  ruleDraftBodySchema,
  ruleLifecycleBodySchema,
  ruleToggleBodySchema,
  ruleUpdateBodySchema,
  createEscalationProfileBodySchema,
  createNotificationChannelBodySchema,
  setEscalationDefaultsBodySchema,
  setRuleNotificationsBodySchema,
  updateEscalationProfileBodySchema,
  updateNotificationChannelBodySchema,
  // `F4.281` (ADR 0030): the maintenance schedule write bodies.
  createMaintenanceScheduleBodySchema,
  updateMaintenanceScheduleBodySchema,
  // `F4.300` (ADR 0108 decision 3.7): the replace-all trend-point body.
  putOrgTrendPointsBodySchema,
  adoptAssetsBodySchema,
  setOrganizationColourProfileBodySchema,
  // `F4.341` (ADR 0118 decision 10): the three appearance write bodies.
  setPortalAppearanceBodySchema,
  setOrganizationAppearanceBodySchema,
  setMyAppearanceBodySchema,
  setOrganizationEnergySettingsBodySchema,
  // `F4.309` (ADR 0088 Amendment 3): the state-label write bodies.
  createPointKeyStateBodySchema,
  updatePointKeyStateBodySchema,
  // `F4.317` task 4.2 (ADR 0112 decision 4).
  putOrganizationControlRoomViewBodySchema,
  // `E7.2` (ADR 0123 decision 12): the edge gateway write bodies.
  createEdgeGatewayBodySchema,
  putEdgeGatewayRtusBodySchema,
  updateEdgeGatewayBodySchema,
  // `F1.2` (ADR 0141 decisions 12-14): the device profile bodies.
  copyDeviceProfileBodySchema,
  createDeviceProfileBodySchema,
  importStockDeviceProfileBodySchema,
  saveDeviceProfileVersionBodySchema,
} from "@bms/shared";
import type { ZodTypeAny } from "zod";

import { setAssetGroupMemberRoleBodySchema } from "../admin/asset-groups/asset-groups.schema";
import {
  assetPointBulkUpdateBodySchema,
  createAssetPointBodySchema,
  updateAssetPointBodySchema,
} from "../admin/asset-points/asset-points.schema";
import { migrateAssetsBodySchema } from "../admin/asset-templates/asset-templates-migrate.schema";
import {
  createAssetTemplateBodySchema,
  instantiateAssetsBodySchema,
  reapplySeededRulesBodySchema,
  updateAssetTemplateBodySchema,
} from "../admin/asset-templates/asset-templates.schema";
import {
  createAssetBodySchema,
  updateAssetBodySchema,
} from "../admin/assets/assets.schema";
import {
  createLocationBodySchema,
  updateLocationBodySchema,
} from "../admin/locations/locations.schema";
import { putSiteControlRoomViewBodySchema } from "../control-room/site-control-room-view.schema";
import { siteLayoutBodySchema } from "../control-room/site-layout.schema";
import {
  createSessionBodySchema,
  patchDraftBodySchema,
  rollbackBodySchema,
  setCredentialsBodySchema,
} from "../admin/onboarding/onboarding.schema";
import {
  createOrganizationBodySchema,
  updateOrganizationBodySchema,
} from "../admin/organizations/organizations.schema";
import {
  putAiAssistantSettingsBodySchema,
  testAiAssistantBodySchema,
} from "../admin/ai-assistant/ai-assistant-settings.schema";
import { putCopilotAccessBodySchema } from "../copilot/copilot-access.schema";
import {
  createPointKeyBodySchema,
  updatePointKeyBodySchema,
} from "../admin/point-keys/point-keys.schema";
import {
  createRtuBodySchema,
  replaceRtuCredentialsBodySchema,
  updateRtuBodySchema,
} from "../admin/rtus/rtus.schema";
import { manualReadingsBodySchema } from "../admin/telemetry-entry/manual-readings.schema";
import { loginBodySchema } from "../auth/login.schema";
// `F4.280` (ADR 0030): the report write bodies and the energy query live in `@bms/shared`;
// `F4.284`: the alarm, work-order and convert bodies too.
import {
  alarmAckBodySchema,
  alarmEnrichmentUpsertBodySchema,
  closeWorkOrderBodySchema,
  convertMaintenanceBodySchema,
  createWorkOrderBodySchema,
  createWorkOrderChecklistTemplateBodySchema,
  createWorkOrderTaskBodySchema,
  putWorkOrderRootCauseBodySchema,
  putWorkOrderSlaPoliciesBodySchema,
  rejectWorkOrderBodySchema,
  cancelWorkOrderBodySchema,
  reorderWorkOrdersBodySchema,
  updateWorkOrderChecklistTemplateBodySchema,
  updateWorkOrderTaskBodySchema,
  updateWorkOrderStatusBodySchema,
  createReportScheduleBodySchema,
  saveEnergyReportFileBodySchema,
  updateReportScheduleBodySchema,
  closeMaintenanceWindowBodySchema,
  createMaintenanceWindowBodySchema,
  extendMaintenanceWindowBodySchema,
} from "@bms/shared";
import { rulePreviewBodySchema } from "../rules/rules.schema";

/**
 * `F1.2` — the strictness ledger's BODY list, moved out of `strict-body-ledger.spec.ts` on the
 * model of `strict-body-ledger.query-schemas.ts`: the spec sat at 995 of the AGENTS.md §4.5
 * 1000-line cap, and every new body costs this list an import and an entry. Nothing in the move
 * changed but the location; the device profile entries went back to one per line.
 */

/**
 * Keyed by **export name**, not by `operationId`, and the difference is not
 * cosmetic.
 *
 * `REQUEST_SCHEMAS` is keyed by `operationId`, and three schemas serve more
 * than one route: `migrateAssetsBodySchema` (×2), `ruleLifecycleBodySchema`
 * (×3) and `energyReportQuerySchema` (×3). A registry-keyed ledger would ask
 * for the same judgement three times and let the copies drift apart — a second
 * place to record the same decision, which is the shape AGENTS.md §4.4 exists
 * to refuse.
 *
 * The cost of the second import list is that it can fall behind the registry.
 * `assertEveryRegisteredSchemaIsInTheLedger` is what stops that, by object
 * identity rather than by name.
 */
export const BODY_SCHEMAS: Record<string, ZodTypeAny> = {
  alarmAckBodySchema,
  alarmEnrichmentUpsertBodySchema,
  assetPointBulkUpdateBodySchema,
  assetPointCalcOverrideBodySchema,
  closeWorkOrderBodySchema,
  convertMaintenanceBodySchema,
  createAssetBodySchema,
  createAssetPointBodySchema,
  createAssetTemplateBodySchema,
  createDashboardBodySchema,
  // `F3.36` (ADR 0049). All four are `.strict()` — the PATCH body most
  // deliberately, because `F3.37`'s review found a permissive one that let a
  // field be stripped and silently cleared a value at 200, and `content` here is
  // the whole authored canvas.
  createDashboardTemplateBodySchema,
  importStockTemplateBodySchema,
  instantiateSectionTemplateBodySchema,
  updateDashboardTemplateBodySchema,
  // `F3.10` (ADR 0057 decision 7). All three are `.strict()` at every node,
  // and the nested ones say so themselves — `.strict()` does not descend, so
  // the step object and the severity-map item carry their own.
  createEscalationProfileBodySchema,
  setEscalationDefaultsBodySchema,
  updateEscalationProfileBodySchema,
  // `F3.40`. Both are `.strict()`, and the decision is the same one
  // `createPointKeyBodySchema` records for the sibling global vocabulary: a
  // caller sending a field this table does not have — `organizationId`, the
  // obvious one — must get a 400 rather than have it dropped. `code` is absent
  // from the update body on purpose; it is the primary key and the target of
  // `asset_group_members_role_fkey`, so a rename is not an edit.
  createAssetRoleBodySchema,
  updateAssetRoleBodySchema,
  // `E4.1a` (ADR 0070 decision 2). Both `.strict()`: a caller sending a field
  // the store does not have — or, on PATCH, one of the three immutable fields
  // `key`/`organizationId`/scope — must get a 400 rather than have it dropped.
  createCalcParameterBodySchema,
  updateCalcParameterBodySchema,
  // `F4.365` U5 (ADR 0134 decision 3). Both `.strict()`: `organizationId` and `locationId` come from the
  // path's location and `tariffKey` is immutable on PATCH, so any of them sent must be a 400, never dropped.
  createLocationTariffBodySchema,
  updateLocationTariffBodySchema,
  // `F4.365` U6 (ADR 0134 Amendment 1). Both `.strict()` at the version level, each union arm too: a
  // revision's descriptive columns are copied on the server, so a `state` or `name` sent on one must be a
  // 400, never dropped. The slab item stays open; its ledger entry says why.
  createTariffVersionBodySchema,
  updateTariffVersionBodySchema,
  createLocationBodySchema,
  // `F4.162`. Both `.strict()`: `bms.location_types` is global vocabulary, so
  // an `organizationId` must be a 400, and `code` on the PATCH is a rename of
  // the primary key `locations.type` references — refused, never dropped.
  createLocationTypeBodySchema,
  updateLocationTypeBodySchema,
  updateAssetDomainBodySchema,
  createMaintenanceScheduleBodySchema,
  createNotificationChannelBodySchema,
  createOrganizationBodySchema,
  createPointKeyBodySchema,
  createPointKeyStateBodySchema,
  // `F3.21` (ADR 0090 Amendment 1 A5). Both `.strict()`: the response's own
  // fields (`keyLast4`, `source`, `platform`) sent back must be a 400, never
  // silently dropped.
  putAiAssistantSettingsBodySchema,
  testAiAssistantBodySchema,
  // `F3.85` PR 3 (ADR 0099 decision 5). Strict at every level: the response's own
  // fields (`organizationId`, `overrides`) sent back must be a 400.
  putCopilotAccessBodySchema,
  // `F3.85` PR 5 (ADR 0099 decision 8). Strict: the response's own fields
  // (`id`, `title`) sent back must be a 400.
  copilotCreateConversationBodySchema,
  // `F3.85` PR 7. Strict: a body naming an organization must be a 400 — the turn's
  // organization is the conversation row's alone (decision 10).
  copilotTurnBodySchema,
  // `F3.86` PR 5. Strict: a session id sent with the organization must be a 400 — the
  // route creates the session; it never binds one the caller names.
  copilotStartOnboardingSkillBodySchema,
  // `F3.86` PR 5. Strict: a key beside `draftHash` must be a 400, and `draftHash` is required.
  commitOnboardingBodySchema,
  createRtuBodySchema,
  // `F4.333` (ADR 0129 decision 2). Strict: a `host` or `config` key must be a 400 —
  // the route writes the credential columns only, never the broker it connects to.
  replaceRtuCredentialsBodySchema,
  createSessionBodySchema,
  createWorkOrderBodySchema,
  instantiateAssetsBodySchema,
  loginBodySchema,
  manualReadingsBodySchema,
  migrateAssetsBodySchema,
  // `F4.312` (ADR 0109 Amendment 1). Strict: a plan echoed back must be a 400 (owner ruling 1).
  adoptAssetsBodySchema,
  patchDraftBodySchema,
  putDashboardWidgetsBodySchema,
  appendWidgetBodySchema,
  // `F3.67` U4 (ADR 0076 decision 5, plan D4). `.strict()`: `kind` and
  // `builtinKey` are closed vocabularies with no `z.record` escape, and a PUT
  // states the whole kind — a stray field silently dropped is exactly the
  // pair rule going unchecked.
  // `F3.32c` (ADR 0081 decision 3). `.strict()` at every level: a layout is an
  // authoring shape with no `z.record` escape, so an unknown key is a typo.
  createMimicLayoutBodySchema,
  putMimicLayoutBodySchema,
  putSiteControlRoomViewBodySchema,
  // `F4.300` (ADR 0108 decision 3.7). `.strict()`: one replace-all list, no `z.record` escape.
  putOrgTrendPointsBodySchema,
  // `F3.73` plan D6. `.strict()`: both keys are optional, so a misspelt `tabGroup` dropped
  // silently would run the copy with no choice and answer 409 for a reason the caller cannot see.
  siteLayoutBodySchema,
  // `F4.317` task 4.2. `.strict()`: one optional key, so a misspelt `templateID` dropped silently
  // would copy the newest template instead of the one the caller named.
  putOrganizationControlRoomViewBodySchema,
  // `E3.1` (ADR 0122 decision 3.2, plan D8). `.strict()` at both levels: a replace-all set, so a
  // misspelt key dropped silently would reset that priority to its default at 200.
  putWorkOrderSlaPoliciesBodySchema,
  // `E3.1` (ADR 0122 decision 4). `.strict()`: a checklist item and a template are closed shapes; a
  // stray `mandatory` on a task update, or a stray `organizationId` on a template update, dropped
  // silently would answer 200 for a change that never happened.
  createWorkOrderTaskBodySchema,
  updateWorkOrderTaskBodySchema,
  createWorkOrderChecklistTemplateBodySchema,
  updateWorkOrderChecklistTemplateBodySchema,
  // `E3.1` (ADR 0122 decisions 5 and 5a). `.strict()`: a replace-all set, and the door an
  // `alarmRootCause` sent by a browser must not get through as a dropped key.
  putWorkOrderRootCauseBodySchema,
  // `E3.1` (ADR 0122 decisions 6.4 and 6.8). `.strict()`: a reason only, on an approval-class write.
  rejectWorkOrderBodySchema,
  cancelWorkOrderBodySchema,
  // `E7.2` (ADR 0123 decision 12). `.strict()`: closed shapes, so an unknown key is a caller error.
  createEdgeGatewayBodySchema,
  updateEdgeGatewayBodySchema,
  putEdgeGatewayRtusBodySchema,
  // `F1.2` (ADR 0141 decisions 12-14). `.strict()`: the server sets version, verified and createdBy.
  createDeviceProfileBodySchema,
  saveDeviceProfileVersionBodySchema,
  copyDeviceProfileBodySchema,
  importStockDeviceProfileBodySchema,
  // `F3.32f` slice 3 (ADR 0086 decisions 4, 6, 7). `.strict()`: a library, a symbol patch and the
  // switch are closed authoring shapes with no `z.record` escape, so an unknown key is a typo.
  createMimicOrgSymbolLibraryBodySchema,
  updateMimicOrgSymbolLibraryBodySchema,
  updateMimicOrgSymbolBodySchema,
  putMimicLibrarySettingBodySchema,
  // `E2.4` (ADR 0058 decision 8). `.strict()`: the body names rule ids and
  // nothing else — a `{ all: true }` silently dropped and answered 200 would
  // read as the republish-moves-live-rules outcome decision 1 refuses.
  reapplySeededRulesBodySchema,
  reorderWorkOrdersBodySchema,
  // `F3.5a` (ADR 0071 decision 11). `.strict()`: the body names the period,
  // the format and, for a global or multi-organization admin, the organization
  // — a fourth key (`locationIds`, the obvious one, which the server stamps
  // from the actor's grants) must be a 400 rather than dropped at 201.
  saveEnergyReportFileBodySchema,
  // `F3.5b` (ADR 0071 decision 11). Both `.strict()`: `nextRunAt` is the key
  // a client would send and the server computes — a 400, never dropped at 201.
  createReportScheduleBodySchema,
  updateReportScheduleBodySchema,
  // `F4.289`: `.strict()` at the top and in every row (each row is `ruleDraftBodySchema`).
  ruleBatchBodySchema,
  ruleDraftBodySchema,
  ruleLifecycleBodySchema,
  rulePreviewBodySchema,
  ruleToggleBodySchema,
  ruleUpdateBodySchema,
  setAssetGroupMemberRoleBodySchema,
  // `F3.78` (ADR 0089). Seven bodies, all `.strict()`; three by the F4.189 ruling (2026-10-04).
  addAssetGroupMemberBodySchema,
  addUserGrantBodySchema,
  createAssetGroupBodySchema,
  createUserBodySchema,
  temporaryPasswordBodySchema,
  updateAssetGroupBodySchema,
  updateUserBodySchema,
  // F3.25 (ADR 0094 decision 6): `.strict()` — a stray key beside the hash is a caller error.
  rollbackBodySchema,
  setCredentialsBodySchema,
  setRuleNotificationsBodySchema,
  updateAssetBodySchema,
  updateAssetPointBodySchema,
  updateAssetTemplateBodySchema,
  updateDashboardBodySchema,
  updateLocationBodySchema,
  updateMaintenanceScheduleBodySchema,
  updateNotificationChannelBodySchema,
  updateOrganizationBodySchema,
  // `F4.310` (ADR 0110 decision 7): `.strict()`, so a stray field is a 400.
  setOrganizationColourProfileBodySchema,
  // `F4.341` (ADR 0118 decision 10): `.strict()`, so a stray field (another row's id) is a 400.
  setPortalAppearanceBodySchema,
  setOrganizationAppearanceBodySchema,
  setMyAppearanceBodySchema,
  setOrganizationEnergySettingsBodySchema,
  updatePointKeyBodySchema,
  updatePointKeyStateBodySchema,
  updateRtuBodySchema,
  updateWorkOrderStatusBodySchema,
  // `F4.359` (ADR 0131). All `.strict()`, the target union's three arms too: the organization is the
  // targets' (D1), so an `organizationId` or a `createdBy` sent must be a 400, never dropped at 201.
  closeMaintenanceWindowBodySchema,
  createMaintenanceWindowBodySchema,
  extendMaintenanceWindowBodySchema,
};
