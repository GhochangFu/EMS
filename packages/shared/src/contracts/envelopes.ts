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
  adminAssetTemplateSummaryDtoSchema,
  adminLocationDtoSchema,
  adminOrganizationDtoSchema,
  adminPointKeyDtoSchema,
  adminRtuDtoSchema,
  assetPointCalcConfigDtoSchema,
  templateMigrationAssetDtoSchema,
  templateMigrationRefusalDtoSchema,
  templateMigrationSkippedPointDtoSchema,
  templateVersionDeltaDtoSchema,
  templateVersionSummaryDtoSchema,
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
import {
  notificationChannelDtoSchema,
  notificationDeliveryDtoSchema,
  notificationReadinessDtoSchema,
  notificationTestResultSchema,
} from "./notifications";

/** `{ items: T[] }` — the shape every master-data list route returns. */
const itemsOf = <S extends z.ZodTypeAny>(item: S) => z.object({ items: z.array(item) });

// --- master data ------------------------------------------------------------
export const organizationsListResponseSchema = itemsOf(adminOrganizationDtoSchema);
export const locationsListResponseSchema = itemsOf(adminLocationDtoSchema);
export const rtusListResponseSchema = itemsOf(adminRtuDtoSchema);
export const assetsListResponseSchema = itemsOf(adminAssetDtoSchema);
export const assetPointsListResponseSchema = itemsOf(adminAssetPointDtoSchema);
export const pointKeysListResponseSchema = itemsOf(adminPointKeyDtoSchema);

/**
 * Asset templates — the two admin routes that had no envelope here.
 *
 * Added by `F2.5` (ADR 0038) and **not an API change**: no route, response
 * shape or validator moves. `adminFetch` requires a schema argument, so a
 * client for a route without one cannot be written at all, which is why the
 * gap only surfaced when `apps/web` finally grew a template UI.
 *
 * The row stays `adminAssetTemplateSummaryDtoSchema` — a `z.intersection` of
 * the full DTO minus `points`, and `{ pointCount }`. `itemsOf` accepts it
 * because `ContractSchema` is `z.ZodTypeAny`. Do not "simplify" it to a flat
 * `z.object` while wiring this envelope: that still typechecks, still passes
 * `itemsOf`, and silently stops enforcing `pointCount` (ADR 0030 Amendment 1,
 * rule 2 — the rule `tests/adr-0030-contract-derivation.test.ts` guards).
 */
export const assetTemplatesListResponseSchema = itemsOf(adminAssetTemplateSummaryDtoSchema);

/**
 * `DELETE /admin/asset-templates/:id` — deleting a draft.
 *
 * `z.literal(true)`, not `z.boolean()`. The route deletes the draft or throws
 * (it refuses a published version outright), so it has no `false` to return.
 * A `false` arriving here would mean the API changed what it returns, not that
 * the delete failed — and the contract should say so rather than accept it.
 */
export const templateDraftDeletedResponseSchema = z.object({ deleted: z.literal(true) });

/**
 * `F2.6` template version lifecycle (ADR 0039).
 *
 * These sit here rather than in `admin.ts` where the step-3 plan listed them,
 * because this module is where every response envelope in the package already
 * lives — `admin.ts` holds no `…ResponseSchema` at all. Splitting the rule
 * "row DTOs in `admin.ts`, envelopes in `envelopes.ts`" for four new routes
 * would leave the next reader guessing which file to look in. The DTOs
 * themselves are in `admin.ts` as the plan says.
 */
export const assetPointCalcConfigListResponseSchema = itemsOf(assetPointCalcConfigDtoSchema);
export const templateVersionsListResponseSchema = itemsOf(templateVersionSummaryDtoSchema);

/**
 * `POST /admin/asset-templates/:id/migration-preview` — decision 2's "no blind
 * apply". Writes nothing.
 *
 * `deltas` is an **array**, one per distinct source version, because the
 * selection is a set of asset ids and nothing stops those assets sitting on
 * different versions of the same code. Returning a single delta would force the
 * server to pick a source version and quietly misreport the others.
 *
 * `canApply` is the server's verdict, not the client's to compute:
 * `apply` re-runs this preview and refuses if it is not clean, so a client that
 * derived its own answer from `refusals` would be a second implementation of a
 * decision that only the server's copy is trusted with.
 */
export const templateMigrationPreviewResponseSchema = z.object({
  templateCode: z.string(),
  toVersionId: z.string(),
  toVersion: z.number(),
  assets: z.array(templateMigrationAssetDtoSchema),
  deltas: z.array(templateVersionDeltaDtoSchema),
  refusals: z.array(templateMigrationRefusalDtoSchema),
  canApply: z.boolean(),
});

/**
 * `POST /admin/asset-templates/:id/migrate` — decision 1's explicit, audited
 * act.
 *
 * `migratedAssetIds` is echoed rather than assumed from the request: the caller
 * asked for a set, and scope filtering or an already-on-target asset can make
 * the answer smaller. `pointsCreated` counts the measured additions decision 4
 * wires up.
 */
export const templateMigrationResultResponseSchema = z.object({
  templateCode: z.string(),
  toVersionId: z.string(),
  toVersion: z.number(),
  fromVersions: z.array(z.number()),
  migratedAssetIds: z.array(z.string()),
  assetCount: z.number(),
  pointsCreated: z.number(),
  skippedPoints: z.array(templateMigrationSkippedPointDtoSchema),
});

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

// --- notifications (`F3.8`, ADR 0041) ---------------------------------------
//
// Channels, deliveries and readiness all return the bare `{ items }` shape.
// That follows `ruleExecutionsResponseSchema` above rather than the alarm
// cursor shape, which is what ADR 0041 decision 4 asks for ("the same
// pagination shape `listExecutions` uses"): `RulesService.listExecutions`
// returns `{ items }` with a `limit` and no cursor, and the deliveries view is
// the same kind of read — a bounded recent-history list, not an infinite scroll.
export const notificationChannelsListResponseSchema = itemsOf(notificationChannelDtoSchema);
export const notificationDeliveriesResponseSchema = itemsOf(notificationDeliveryDtoSchema);
export const notificationReadinessResponseSchema = itemsOf(notificationReadinessDtoSchema);

// Not wrapped: a test is one dispatch, so the result is one object. `itemsOf`
// here would make every caller unwrap a single-element array to ask "did it
// send?".
export const notificationTestResultResponseSchema = notificationTestResultSchema;

// The three write routes. `POST /channels` and `PATCH /channels/:id` return the
// row they wrote, so they share the DTO — a separate schema per verb would be
// two descriptions of one shape.
//
// Added in the same unit as the routes rather than when `apps/web` needs them.
// The header of this file records what happens otherwise: `adminFetch` requires
// a schema argument, so a route without one cannot be called from the client at
// all, and the gap surfaces as a blocked UI commit rather than as a missing
// contract.
export const notificationChannelResponseSchema = notificationChannelDtoSchema;

/**
 * `DELETE /notifications/channels/:id`.
 *
 * `z.literal(true)`, following `templateDraftDeletedResponseSchema` above and
 * for the same reason: the route deletes the channel or throws — 404 when it
 * does not exist, and Postgres refuses one that history still references — so
 * it has no `false` to return.
 */
export const notificationChannelDeletedResponseSchema = z.object({
  deleted: z.literal(true),
});

/**
 * `GET` and `PUT /rules/:id/notifications` — plan D1.
 *
 * The same shape both ways round, because PUT replaces the whole set and
 * answers with what the set now is. A caller can therefore treat the response
 * as the new state rather than re-reading it.
 */
export const ruleNotificationsResponseSchema = z.object({
  channelIds: z.array(z.string()),
});
