/** Prototype role slugs stored in `bms.users.role`. */
export type UserRole = "admin" | "operator" | "viewer";

/** JWT payload claims issued by `apps/api` (prototype). */
export type JwtPayload = {
  sub: string;
  email: string;
  name: string;
  role: UserRole;
};

/** Successful login response body from `POST /api/v1/auth/login`. */
export type LoginResponse = {
  accessToken: string;
  tokenType: "Bearer";
  expiresIn: string;
  user: {
    id: string;
    email: string;
    displayName: string;
    role: UserRole;
  };
};

/** Separator between asset UUID and point key in `pointRef` URLs. */
export const TELEMETRY_POINT_REF_SEP = "::";

/** Electrical domain point keys written by `apps/sim` (keep in sync with simulator). */
export const ELECTRICAL_POINT_KEYS = [
  "voltage_l1_v",
  "current_a",
  "kw",
  "kvar",
  "pf",
  "breaker_main",
] as const;

export type ElectricalPointKey = (typeof ELECTRICAL_POINT_KEYS)[number];

/** HVAC / CRAC point keys written by `apps/sim` for `domain = hvac` assets. */
export const HVAC_POINT_KEYS = [
  "supply_air_temp_c",
  "return_air_temp_c",
  "fan_rpm",
  "fan_speed_pct",
  "chw_flow_lps",
  "chw_supply_temp_c",
  "chw_return_temp_c",
  "compressor_ok",
  "cooling_kw",
] as const;

export type HvacPointKey = (typeof HVAC_POINT_KEYS)[number];

/** One telemetry sample (DB row / WebSocket payload). */
export type TelemetryReading = {
  time: string;
  assetId: string;
  pointKey: string;
  value: number;
  unit: string | null;
};

/** Builds the REST path segment for `GET .../points/:pointRef/recent`. */
export function encodePointRef(assetId: string, pointKey: string): string {
  return encodeURIComponent(
    `${assetId}${TELEMETRY_POINT_REF_SEP}${pointKey}`,
  );
}

/** Parses `encodePointRef` output from a route param (already URL-decoded by Nest/Express). */
export function decodePointRefParam(param: string): {
  assetId: string;
  pointKey: string;
} {
  const decoded = decodeURIComponent(param);
  const i = decoded.indexOf(TELEMETRY_POINT_REF_SEP);
  if (i < 0) {
    throw new Error("Invalid point reference");
  }
  return {
    assetId: decoded.slice(0, i),
    pointKey: decoded.slice(i + TELEMETRY_POINT_REF_SEP.length),
  };
}

/** Snapshot for Executive Dashboard KPI row (`GET /api/v1/dashboard/kpis`). */
export type DashboardKpis = {
  totalKw: number;
  sitesOnline: number;
  sitesTotal: number;
  alarmsOpen: number;
  alarmsCritical: number;
  pueEstimate: number;
  asOf: string;
};

/** Aggregated load curve for trend chart. */
export type LoadTrendPoint = {
  t: string;
  totalKw: number;
};

/** Energy Centre KPI row (`GET /api/v1/dashboard/energy/summary`). */
export type EnergyCentreSummary = {
  window: string;
  totalKwh: number;
  peakKw: number;
  pueEstimate: number;
  indicativeCostZar: number;
  tariffZarPerKwh: number;
  asOf: string;
};

/** Stacked source mix (grid / solar / nominal DG slice) per time bucket. */
export type EnergySourceMixPoint = {
  t: string;
  gridKw: number;
  solarKw: number;
  dgKw: number;
};

/** Top consumers by average kW in the window. */
export type EnergyTopConsumer = {
  assetId: string;
  code: string;
  name: string;
  siteName: string;
  avgKw: number;
  estimatedKwh: number;
};

/** One alarm row for list / WebSocket payloads (`GET /api/v1/alarms`). */
export type AlarmListItem = {
  id: string;
  assetId: string;
  ruleKey: string | null;
  severity: string;
  message: string;
  raisedAt: string;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  assetCode: string;
  assetName: string;
  siteName: string;
};

/** Socket.IO `/ws/alarms` event payload. */
export type AlarmSocketEvent =
  | { type: "created"; alarm: AlarmListItem }
  | { type: "acknowledged"; alarm: AlarmListItem };

/** Live map marker (`GET /api/v1/map/sites`). */
export type MapSiteLive = {
  status:
    | "healthy"
    | "warning"
    | "critical"
    | "offline"
    | "nominal"
    | "unknown";
  openAlarms: number;
  criticalAlarms: number;
  assetsTotal: number;
  assetsFresh: number;
};

export type MapSiteDto = {
  id: string;
  slug: string;
  name: string;
  kind: "eskom_station" | "smoc_campus";
  siteName: string | null;
  latitude: number;
  longitude: number;
  capacityMw: number | null;
  stationType: string | null;
  stationCategory: string | null;
  province: string | null;
  stationOperatingStatus: string | null;
  live: MapSiteLive;
};
