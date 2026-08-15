/**
 * Dashboard, telemetry and map contracts.
 *
 * `locationDashboardDtoSchema` is the one place ADR 0030 Amendment 1's first
 * authoring rule bites: the exported type is `LocationKpiSummary & { … }`, so
 * it is encoded with `z.intersection` and NOT `.merge()`. `.merge()` flattens
 * the two halves into a single object type, which is mutually assignable with
 * the exported type but is not the same type — measured, not assumed.
 */
import { z } from "zod";

import {
  CONTROL_ROOM_ELECTRICAL_POINT_KEYS,
  CONTROL_ROOM_ENVIRONMENT_POINT_KEYS,
  CONTROL_ROOM_IT_POINT_KEYS,
  CONTROL_ROOM_UPS_POINT_KEYS,
  ELECTRICAL_POINT_KEYS,
  HVAC_POINT_KEYS,
} from "../constants";

export const organizationRefSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
});

export const rtuSummarySchema = z.object({
  id: z.string(),
  code: z.string(),
  displayName: z.string(),
  sourceType: z.enum(["mqtt", "simulator", "catalog"]),
  domain: z.string().nullable(),
  ingestEnabled: z.boolean(),
  assetCount: z.number(),
  freshAssetCount: z.number(),
});

export const locationKpiSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(["smoc_campus", "rsmoc", "csmoc"]),
  province: z.string().nullable(),
  organization: organizationRefSchema,
  rtuCount: z.number(),
  assetCount: z.number(),
  freshAssetCount: z.number(),
  totalKw: z.number(),
  openAlarms: z.number(),
  criticalAlarms: z.number(),
  scopeLabel: z.enum(["full", "partial"]),
});

const dashboardAssetRowSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  domain: z.string(),
  // ADR 0018: null for a gateway-less asset. The dashboard LEFT JOINs rtus so
  // such an asset still appears with its alarms; declaring these non-null would
  // be a contract the query cannot honour.
  rtuId: z.string().nullable(),
  rtuDisplayName: z.string().nullable(),
  latestKw: z.number().nullable(),
  latestTelemetryAt: z.string().nullable(),
  freshness: z.enum(["live", "stale", "none"]),
  telemetry: z.array(
    z.object({
      pointKey: z.string(),
      value: z.number(),
      unit: z.string().nullable(),
      time: z.string(),
    }),
  ),
  openAlarmCount: z.number(),
  criticalAlarmCount: z.number(),
  warningAlarmCount: z.number(),
  latestAlarm: z
    .object({ severity: z.string(), message: z.string(), raisedAt: z.string() })
    .nullable(),
  openWorkOrderCount: z.number(),
});

const locationDashboardExtraSchema = z.object({
  rtus: z.array(rtuSummarySchema),
  assets: z.object({
    items: z.array(dashboardAssetRowSchema),
    page: z.number(),
    pageSize: z.number(),
    total: z.number(),
    totalPages: z.number(),
  }),
  topAssets: z.array(
    z.object({
      id: z.string(),
      code: z.string(),
      name: z.string(),
      domain: z.string(),
      kw: z.number().nullable(),
    }),
  ),
  workOrdersOpen: z.number(),
});

/** `z.intersection`, never `.merge()` — ADR 0030 Amendment 1, rule 1. */
export const locationDashboardDtoSchema = z.intersection(
  locationKpiSummarySchema,
  locationDashboardExtraSchema,
);

/** One telemetry sample (DB row / WebSocket payload). */
export const telemetryReadingSchema = z.object({
  time: z.string(),
  assetId: z.string(),
  pointKey: z.string(),
  value: z.number(),
  unit: z.string().nullable(),
});

/** Snapshot for Executive Dashboard KPI row (`GET /api/v1/dashboard/kpis`). */
export const dashboardKpisSchema = z.object({
  totalKw: z.number(),
  sitesOnline: z.number(),
  sitesTotal: z.number(),
  alarmsOpen: z.number(),
  alarmsCritical: z.number(),
  pueEstimate: z.number(),
  asOf: z.string(),
});

/** Aggregated load curve for trend chart. */
export const loadTrendPointSchema = z.object({
  t: z.string(),
  totalKw: z.number(),
});

export const mapSiteLiveSchema = z.object({
  status: z.enum(["healthy", "warning", "critical", "offline", "nominal", "unknown"]),
  openAlarms: z.number(),
  criticalAlarms: z.number(),
  assetsTotal: z.number(),
  assetsFresh: z.number(),
});

export const mapSiteDtoSchema = z.object({
  id: z.string(),
  canonicalLocationId: z.string().nullable(),
  slug: z.string(),
  name: z.string(),
  kind: z.enum(["eskom_station", "smoc_campus", "rsmoc", "csmoc"]),
  siteName: z.string().nullable(),
  organization: organizationRefSchema.nullable(),
  latitude: z.number(),
  longitude: z.number(),
  capacityMw: z.number().nullable(),
  stationType: z.string().nullable(),
  stationCategory: z.string().nullable(),
  province: z.string().nullable(),
  stationOperatingStatus: z.string().nullable(),
  live: mapSiteLiveSchema,
});

/**
 * Runtime enums over the point-key catalogues in `../constants`.
 *
 * The TYPES stay derived from the `as const` arrays — `(typeof ARR)[number]`
 * is already single-source, and routing them through Zod would add ceremony
 * without adding a source of truth. These exist for the other half: validating
 * a point key that arrived over the wire.
 */
export const electricalPointKeySchema = z.enum(ELECTRICAL_POINT_KEYS);
export const hvacPointKeySchema = z.enum(HVAC_POINT_KEYS);
export const controlRoomUpsPointKeySchema = z.enum(CONTROL_ROOM_UPS_POINT_KEYS);
export const controlRoomItPointKeySchema = z.enum(CONTROL_ROOM_IT_POINT_KEYS);
export const controlRoomEnvironmentPointKeySchema = z.enum(CONTROL_ROOM_ENVIRONMENT_POINT_KEYS);
export const controlRoomElectricalPointKeySchema = z.enum(CONTROL_ROOM_ELECTRICAL_POINT_KEYS);
