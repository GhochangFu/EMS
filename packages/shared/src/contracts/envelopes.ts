/**
 * List and wrapper envelopes — the shapes routes actually return.
 *
 * **These were declared in `apps/web/src/api/`**, thirteen of them, each an
 * `export type XListResponse = { items: SomeDto[] }` beside the fetch that
 * cast to it. That is the same defect `F4.20` found when `statusQuerySchema`
 * turned up inside a controller: a response contract living where the registry
 * — and now the validator — cannot see it. A row type in `@bms/shared` while
 * the envelope around it sits in one app is a contract that is half shared.
 *
 * They keep their exported names, so no consumer's import changes; what
 * changes is that they are now `z.infer` of a schema like every other response
 * type, and therefore checkable at the boundary.
 *
 * `admin/*` list routes all return the bare `{ items }` shape, so those are
 * built from one generic helper rather than restated six times.
 */
import { z } from "zod";

import {
  adminAssetDtoSchema,
  adminAssetPointDtoSchema,
  adminLocationDtoSchema,
  adminOrganizationDtoSchema,
  adminPointKeyDtoSchema,
  adminRtuDtoSchema,
} from "./admin";
import {
  alarmListItemSchema,
  maintenanceScheduleItemSchema,
  ruleBuilderCatalogAssetSchema,
  ruleExecutionItemSchema,
  ruleListItemSchema,
  workOrderListItemSchema,
} from "./operations";
import {
  dashboardKpisSchema,
  loadTrendPointSchema,
  locationKpiSummarySchema,
  mapSiteDtoSchema,
  telemetryReadingSchema,
} from "./dashboard";
import {
  energySourceMixPointSchema,
  energyTopConsumerSchema,
} from "./operations";

/** `{ items: T[] }` — the shape every master-data list route returns. */
const itemsOf = <S extends z.ZodTypeAny>(item: S) => z.object({ items: z.array(item) });

// --- master data ------------------------------------------------------------
export const organizationsListResponseSchema = itemsOf(adminOrganizationDtoSchema);
export const locationsListResponseSchema = itemsOf(adminLocationDtoSchema);
export const rtusListResponseSchema = itemsOf(adminRtuDtoSchema);
export const assetsListResponseSchema = itemsOf(adminAssetDtoSchema);
export const assetPointsListResponseSchema = itemsOf(adminAssetPointDtoSchema);
export const pointKeysListResponseSchema = itemsOf(adminPointKeyDtoSchema);

// --- operations -------------------------------------------------------------

/** Alarms paginate by cursor; `nullable` is the end of the list, not an error. */
export const alarmsListResponseSchema = z.object({
  items: z.array(alarmListItemSchema),
  nextCursor: z.string().nullable(),
});

export const workOrdersListResponseSchema = itemsOf(workOrderListItemSchema);
export const maintenanceSchedulesResponseSchema = itemsOf(maintenanceScheduleItemSchema);
export const convertMaintenanceResponseSchema = z.object({
  workOrder: workOrderListItemSchema,
});

export const rulesResponseSchema = itemsOf(ruleListItemSchema);
export const ruleExecutionsResponseSchema = itemsOf(ruleExecutionItemSchema);
export const ruleBuilderCatalogResponseSchema = z.object({
  assets: z.array(ruleBuilderCatalogAssetSchema),
});

// --- dashboard, telemetry, map ----------------------------------------------
//
// **Not every route wraps its rows, and the wrappers do not agree.** Read off
// the call sites rather than assumed: `/dashboard/locations` returns
// `{ items }`, `/dashboard/load-trend` returns `{ points }`,
// `/dashboard/energy/top-consumers` returns `{ consumers }`, and `/map/sites`
// and the recent-telemetry route return a BARE ARRAY. A first draft of this
// file guessed `{ items }` for all of them and was wrong three times — which
// is the argument for these schemas existing at all.
export const locationsSummaryResponseSchema = itemsOf(locationKpiSummarySchema);
export const loadTrendResponseSchema = z.object({ points: z.array(loadTrendPointSchema) });
export const mapSitesResponseSchema = z.array(mapSiteDtoSchema);
export const recentTelemetryResponseSchema = z.array(telemetryReadingSchema);
export const energySourceMixResponseSchema = z.object({
  points: z.array(energySourceMixPointSchema),
});
export const energyTopConsumersResponseSchema = z.object({
  consumers: z.array(energyTopConsumerSchema),
});

/** Re-exported for symmetry — `GET /dashboard/kpis` returns the DTO unwrapped. */
export const dashboardKpisResponseSchema = dashboardKpisSchema;

/**
 * `GET /api/v1/assets` — the asset picker's row.
 *
 * Found in `apps/web/src/api/assets.ts` as a local `AssetRow`, with **no
 * counterpart in `@bms/shared` at all**: not a row type shared and an envelope
 * stranded, but a whole response contract that only one app had ever written
 * down. Named `assetPickerRow` here rather than `AssetRow` because the bare
 * name says nothing about which of the several asset shapes it is.
 */
export const assetPickerRowSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  siteName: z.string(),
  domain: z.string(),
});

export const assetPickerResponseSchema = z.array(assetPickerRowSchema);
