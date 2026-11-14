import type { ZodTypeAny } from "zod";

import {
  listDashboardTemplatesQuerySchema,
  listCalcParametersQuerySchema,
  getDashboardQuerySchema,
  listDashboardsQuerySchema,
  pointAggregateQuerySchema,
  pointRawQuerySchema,
  energyReportQuerySchema,
  energyViewQuerySchema,
  siteTrendStripQuerySchema,
  siteSegmentViewsQuerySchema,
  assetHistoryExportQuerySchema,
  tariffCategoriesQuerySchema,
  tariffLineVersionsQuerySchema,
  deleteTariffVersionQuerySchema,
} from "@bms/shared";
import { locationEnergyBillQuerySchema } from "../tariffs/tariffs.schema";
import {
  mappingSheetQuerySchema,
} from "../admin/asset-points/asset-points.schema";
import {
  templateStatusQuerySchema,
} from "../admin/asset-templates/asset-templates.schema";
import {
  auditExportQuerySchema,
  auditListQuerySchema,
} from "../admin/audit/audit.schema";
import {
  mapSitesQuerySchema,
} from "../map/map.schema";
import {
  siteWidgetsQuerySchema,
} from "../dashboard-builder/site-widgets.schema";
import {
  mimicLayoutPreviewQuerySchema,
} from "../mimic-layouts/mimic-layouts.schema";
import {
  listMaintenanceQuerySchema,
} from "../maintenance/maintenance.schema";
import { maintenanceWindowListQuerySchema } from "../maintenance-windows/maintenance-windows.schema";
import {
  escalationDefaultsQuerySchema,
} from "../notifications/escalation-profiles.schema";
import {
  listDeliveriesQuerySchema,
} from "../notifications/notifications.schema";
import {
  listReportFilesQuerySchema,
} from "../reports/report-files.schema";
import {
  assetHealthQuerySchema,
  healthSummaryQuerySchema,
} from "../asset-health/asset-health.schema";
import {
  assetWindowsQuerySchema,
  pointsLatestQuerySchema,
  pointValuesAtQuerySchema,
} from "../telemetry/telemetry.schema";
import {
  alarmListQuerySchema,
  alarmSummaryQuerySchema,
} from "../alarms/alarm-list.schema";
import {
  assetKpisQuerySchema,
  assetRoleSummaryQuerySchema,
} from "../assets/assets.schema";
import {
  loadTrendQuerySchema,
  locationDashboardQuerySchema,
} from "../dashboard/dashboard.schema";
import {
  listRuleExecutionsQuerySchema,
  ruleListQuerySchema,
} from "../rules/rules.schema";

/**
 * The TEN registered **query** schemas — eight at `E7.1f`, plus two added by `F3.1b`.
 *
 * **Deliberately outside this item's audit, ruled by the repository owner on
 * 2026-08-28.** Amendment 3's title and the `E7.1f` row both say *mutating
 * body*, and the owner kept the audit to that boundary. They are listed here
 * rather than omitted so that `assertEveryRegisteredSchemaIsInTheLedger` still
 * sees the whole registry — an omission would make that assertion pass by
 * looking at less, which is the failure mode it exists to catch.
 *
 * Two of them are already `.strict()` for a reason worth reading:
 * `admin/audit/audit.schema.ts:8` — "an unknown query key is a caller error,
 * not a…". That precedent is the argument for widening the audit later; it was
 * put to the owner and not taken for `E7.1f`.
 *
 * **`F3.1b` widened eight to ten**, registering `listDashboardsQuerySchema`
 * (`GET /dashboards`) and `getDashboardQuerySchema` (`GET /dashboards/:slug`) —
 * both carry the single `organizationId` parameter D5 needs to disambiguate a
 * slug shared by more than one organization on the fleet pool. Leaving them
 * unregistered would have made that parameter undiscoverable from the served
 * document, which is the exact failure `F4.20` is in this repository's history
 * for: a green suite and a static invariant still let a served document be
 * wrong. This is the "deliberate act" `testEveryRegisteredSchemaIsUnderAudit`'s
 * own comment asks for, not the shortcut it exists to catch.
 *
 * **14 -> 15: `F2.7` registered `mappingSheetQuerySchema`** (ADR 0056 decision
 * 6), the single `locationId` all three mapping-sheet routes take. It is a
 * genuine query schema, not a body smuggled in here to dodge the audit: the
 * download it is registered against (`_exportMappingSheet`) is a GET returning
 * an `.xlsx` and has no body at all, and its two siblings carry the workbook as
 * a multipart `file` part rather than as JSON. It is `.strict()` anyway — a
 * caller who spells the parameter wrong must be told, not handed a whole
 * location's mappings — with the reasoning beside the schema in
 * `packages/shared/src/contracts/asset-point-writes.ts`. It carries **no** `STRICTNESS_LEDGER` entry, and
 * that is not an omission: the walker reads `BODY_SCHEMAS` only, so an entry
 * here would be a decision no gate holds, and
 * `testTheLedgerHasNoEntriesForNodesThatAreGone` refuses one.
 */
export const QUERY_SCHEMAS: Record<string, ZodTypeAny> = {
  // 18 -> 19: `F3.28` registered `alarmListQuerySchema` (`GET /alarms?cursor=
  // &limit=&state=&assetIds=`, ADR 0074 decision 4) — `.strict()`, no body, no
  // ledger entry, the `mappingSheetQuerySchema` precedent.
  alarmListQuerySchema,
  // 19 -> 20: `F3.28` registered `alarmSummaryQuerySchema`
  // (`GET /alarms/summary?assetIds=`, plan decision 7) — `.strict()`, no body.
  alarmSummaryQuerySchema,
  // 20 -> 21: `F3.28` registered `pointValuesAtQuerySchema`
  // (`GET /telemetry/points/at-instant?at=&refs=`, ADR 0074 decision 2 / plan
  // decision 2) — `.strict()`, no body, no ledger entry, the
  // `mappingSheetQuerySchema` precedent.
  pointValuesAtQuerySchema,
  // 21 -> 22: `F3.28` registered `assetRoleSummaryQuerySchema`
  // (`GET /assets/role-summary?assetIds=`, plan task 3.2) — `.strict()`, no
  // body, no ledger entry, the `mappingSheetQuerySchema` precedent.
  assetRoleSummaryQuerySchema,
  // 22 -> 23: `F4.176` registered `pointsLatestQuerySchema`
  // (`GET /telemetry/points/latest?assetIds=&pointKeys=&windowMinutes=`, ADR
  // 0074 Amendment 2) — `.strict()`, no body, no ledger entry, the same
  // precedent.
  pointsLatestQuerySchema,
  // 24 -> 25: `F3.73` registered `siteWidgetsQuerySchema`
  // (`GET /dashboards/:id/site-widgets?tab=`, plan D9) — `.strict()`, no body,
  // no ledger entry, the same precedent.
  siteWidgetsQuerySchema,
  // 25 -> 26: `F2.33` registered `assetKpisQuerySchema`
  // (`GET /assets/:assetId/kpis?windowMinutes=`, ADR 0097 decision 2) — `.strict()`,
  // no body, no ledger entry, the same precedent.
  assetKpisQuerySchema,
  // 26 -> 27: `F2.10` registered `mapSitesQuerySchema` (`GET /map/sites?parentLocationId=`,
  // ADR 0098 decision 11, B4) — `.strict()`, no body, no ledger entry, the same precedent.
  mapSitesQuerySchema,
  // 27 -> 28: F4.298 registered energyViewQuerySchema (GET /reports/energy/view) — .strict(), no body, no ledger entry, the same precedent.
  energyViewQuerySchema,
  // 28 -> 29: F4.297 registered pointRawQuerySchema (GET /telemetry/points/:pointRef/raw) — .strict(), no body, no ledger entry, the same precedent.
  pointRawQuerySchema,
  // 29 -> 30: F4.301 registered siteTrendStripQuerySchema (GET /control-room/sites/:locationId/trend-strip) — .strict(), no body, no ledger entry, the same precedent.
  siteTrendStripQuerySchema,
  siteSegmentViewsQuerySchema, // 30 -> 31: F4.302 (GET .../segment-views, Amendment 4 item 4) — .strict(), no body, no ledger entry.
  // 31 -> 32: F4.303 registered assetHistoryExportQuerySchema (GET /telemetry/assets/:assetId/history/export.*) — .strict(), no body, no ledger entry, the same precedent.
  assetHistoryExportQuerySchema,
  // 32 -> 33: F4.308 registered mimicLayoutPreviewQuerySchema (GET /mimic-layouts/:id/preview?assetGroupId=, ADR 0081 Amendment 2) — .strict(), no body, no ledger entry, the same precedent.
  mimicLayoutPreviewQuerySchema,
  mappingSheetQuerySchema,
  // `E4.1a`: `GET /admin/calc-parameters?organizationId=&key=` — `.strict()`,
  // no ledger entry, the `mappingSheetQuerySchema` precedent.
  listCalcParametersQuerySchema,
  // `F3.5a`: `GET /reports/files?limit=` — `.strict()`, no ledger entry, the
  // `mappingSheetQuerySchema` precedent.
  listReportFilesQuerySchema,
  listDashboardTemplatesQuerySchema,
  assetHealthQuerySchema,
  auditExportQuerySchema,
  auditListQuerySchema,
  energyReportQuerySchema,
  escalationDefaultsQuerySchema,
  getDashboardQuerySchema,
  listDashboardsQuerySchema,
  listDeliveriesQuerySchema,
  listMaintenanceQuerySchema,
  listRuleExecutionsQuerySchema,
  locationDashboardQuerySchema,
  loadTrendQuerySchema,
  healthSummaryQuerySchema,
  pointAggregateQuerySchema,
  templateStatusQuerySchema,
  // 33 -> 34: `F4.350` registered `assetWindowsQuerySchema` (`GET /telemetry/asset-windows?assetIds=`,
  // ADR 0075 Amendment 3 decision 7) — `.strict()`, no body, no ledger entry, the same precedent.
  assetWindowsQuerySchema,
  // 34 -> 35: `F4.359` registered `maintenanceWindowListQuerySchema` (`GET /maintenance-windows`, ADR 0131)
  // — `.strict()`, no body, no ledger entry, the same precedent.
  maintenanceWindowListQuerySchema,
  // 35 -> 36: `F4.361` registered `ruleListQuerySchema` (`GET /rules?organizationId=&locationId=&assetGroupId=&assetId=`,
  // ADR 0132 decision 4) — `.strict()`, no body, no ledger entry, the same precedent.
  ruleListQuerySchema,
  // 36 -> 39 (2026-11-14): `F4.365` U5 (ADR 0134, plan U5) registered three GET queries, each
  // `.strict()` with no body: `tariffCategoriesQuerySchema` (`GET /tariffs/categories`, four optional
  // narrowing filters), `tariffLineVersionsQuerySchema` (`GET /tariffs/lines/versions?key=`, Amendment 1)
  // and `locationEnergyBillQuerySchema` (`GET /locations/:locationId/energy-bill?month=`). The two
  // mapping bodies that row adds are in `BODY_SCHEMAS` with a decision each.
  tariffCategoriesQuerySchema,
  tariffLineVersionsQuerySchema,
  locationEnergyBillQuerySchema,
  // 39 -> 40 (2026-11-14): `F4.365` U6 registered `deleteTariffVersionQuerySchema`
  // (`DELETE /admin/tariffs/versions/:id?reason=`): one required reason, `.strict()`, no body — a
  // DELETE carries none, so the audit row's reason rides the query.
  deleteTariffVersionQuerySchema,
};
