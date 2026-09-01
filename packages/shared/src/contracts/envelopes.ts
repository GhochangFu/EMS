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
import { dashboardSummaryDtoSchema } from "./dashboard-builder";
import { dashboardTemplateSummaryDtoSchema, stockDashboardTemplateDtoSchema } from "./dashboard-templates";
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
 * Section dashboard templates (`F3.36` Part F, ADR 0049) — the same gap the
 * block above already names for asset templates. `GET /admin/dashboard-templates`
 * and `GET /admin/dashboard-templates/stock` had no envelope here until the web
 * surface needed one, for the identical reason: `adminFetch` requires a schema
 * argument, so a client for either route could not be written at all.
 *
 * `dashboardTemplateSummaryDtoSchema`, not the full `dashboardTemplateDtoSchema`
 * — the list route omits `content`, exactly as the asset-template list omits
 * `points`.
 */
export const dashboardTemplatesListResponseSchema = itemsOf(dashboardTemplateSummaryDtoSchema);
export const stockDashboardTemplatesListResponseSchema = itemsOf(stockDashboardTemplateDtoSchema);

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

// --- dashboards (`F3.1b`/`F3.1d`, ADR 0047) ---------------------------------
//
// `GET /dashboards` returns `{ items: DashboardSummaryDto[] }` and `DELETE
// /dashboards/:id` returns `{ deleted: true }` (`DashboardBuilderController`),
// but `F3.1b` shipped no envelope for either — `apps/web`'s response
// validator requires a schema argument, so a route without one cannot be
// called from the client at all (`assetTemplatesListResponseSchema`'s own
// comment above records the same gap for the same reason). The gap surfaced
// here, when `F3.1d` finally wrote the client.
export const dashboardsListResponseSchema = itemsOf(dashboardSummaryDtoSchema);

/** `DELETE /dashboards/:id` — `templateDraftDeletedResponseSchema`'s shape:
 * the route deletes the row or throws (a 404 for a dashboard it cannot find,
 * a 403 for one it may not manage), so it has no `false` to return. */
export const dashboardDeletedResponseSchema = z.object({ deleted: z.literal(true) });

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

/**
 * `GET /telemetry/points/:pointRef/aggregate` — `F3.35` Stage A, ADR 0048
 * decision 3's "one new read endpoint".
 *
 * The four existing aggregate reads on `@Controller("dashboard")` are fixed
 * shapes for fixed pages. This is the first general one: an arbitrary point, an
 * arbitrary window, answered from the ADR 0023 rollup relations.
 *
 * **`level` is deliberately absent.** Returning `"1m" | "5m" | "1h" | "1d"`
 * would put a second declaration of `AggregateLevel`
 * (`apps/api/src/telemetry/point-aggregates.ts`) in `packages/shared`, which
 * §4.8 forbids — and `bucketSeconds` is strictly more useful to a renderer,
 * which has to turn it into a human string either way.
 */
export const pointAggregateStatsSchema = z.object({
  sum: z.number().nullable(),
  /**
   * The weighted mean — `sum(sum_value) / sum(sample_count)`, computed by the
   * database.
   *
   * **Not the mean of `buckets[].v`**, and the two genuinely differ whenever the
   * samples per bucket differ. That is the ADR 0023 composition property, not a
   * rounding artefact: an average of bucket averages was wrong in 151 of 169
   * buckets on real pilot data. A consistency check comparing the two is the
   * defect, not the test.
   */
  average: z.number().nullable(),
  min: z.number().nullable(),
  max: z.number().nullable(),
  /**
   * When the peak occurred, as a **bucket start** rather than a sample time —
   * the rollup relations keep no sample timestamps. At `1h` this degrades to the
   * hour and at `1d` to the date, so the renderer formats it to the precision
   * `bucketSeconds` implies. `null` when the window holds no samples.
   */
  peakAt: z.string().nullable(),
  sampleCount: z.number().int(),
});

/**
 * One plotted bucket.
 *
 * **`{ t, v }` is byte-for-byte `WidgetSeriesPoint`** in
 * `apps/web/src/lib/widget-catalog.ts`, and that is a choice rather than a
 * coincidence: it is what lets `buildChartOption` stay untouched and keeps the
 * ECharts option builder free of a config-dependent branch.
 *
 * **The server resolves the function; the bucket carries the answer, not the
 * ingredients.** Returning `sample_count` alongside so a client could compute
 * `avg` itself would relocate the ADR 0023 mean division into the browser, where
 * no server test looks at it. `v` is `null` for a bucket with no samples, which
 * the existing gap path already renders.
 */
export const pointAggregateBucketSchema = z.object({
  t: z.string(),
  v: z.number().nullable(),
});

export const pointAggregateResponseSchema = z.object({
  pointRef: z.string(),
  from: z.string(),
  to: z.string(),
  /** The chosen level's bucket width. The renderer's granularity cell derives from this. */
  bucketSeconds: z.number().int().positive(),
  stats: pointAggregateStatsSchema,
  /**
   * The immediately preceding window of the same length — scalar only, and
   * **tile-only**. Nothing overlays yesterday behind today in Stage A, so this
   * never carries buckets. `null` unless the request asked for it.
   */
  compare: z
    .object({
      from: z.string(),
      to: z.string(),
      stats: pointAggregateStatsSchema,
    })
    .nullable(),
  /**
   * The plotted series — **chart-only**, and `null` unless the request named a
   * `bucketFunction`. A tile needs one number and must not pay for 2,880 rows.
   */
  buckets: z.array(pointAggregateBucketSchema).nullable(),
});
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
