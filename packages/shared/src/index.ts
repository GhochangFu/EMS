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

/** Control Room UPS/battery points used by the 2D IBMS screens. */
export const CONTROL_ROOM_UPS_POINT_KEYS = [
  "load_pct",
  "output_voltage_v",
  "output_freq_hz",
  "battery_v",
  "battery_temp_c",
  "backup_min",
  "health_pct",
] as const;

export type ControlRoomUpsPointKey =
  (typeof CONTROL_ROOM_UPS_POINT_KEYS)[number];

/** Control Room rack/PDU points used by the 2D IBMS screens. */
export const CONTROL_ROOM_IT_POINT_KEYS = [
  "rack_kw",
  "rack_temp_c",
  "pdu_a_status",
  "pdu_b_status",
  "pdu_util_pct",
  "outlets_used",
] as const;

export type ControlRoomItPointKey = (typeof CONTROL_ROOM_IT_POINT_KEYS)[number];

/** Control Room electrical points beyond the generic SLD set. */
export const CONTROL_ROOM_ELECTRICAL_POINT_KEYS = [
  ...ELECTRICAL_POINT_KEYS,
  "frequency_hz",
  "kwh_today",
] as const;

export type ControlRoomElectricalPointKey =
  (typeof CONTROL_ROOM_ELECTRICAL_POINT_KEYS)[number];

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

export type EnergyReportTemplate = {
  id: "energy_consumption";
  title: string;
  description: string;
  formats: string[];
  active: boolean;
};

export type EnergyReportSourceTotals = {
  gridKwh: number;
  solarKwh: number;
  dgKwh: number;
};

/** Preview payload for Phase 5 Sprint E Energy Consumption reports. */
export type EnergyReportPreview = {
  template: EnergyReportTemplate;
  range: {
    startDate: string;
    endDate: string;
    durationHours: number;
  };
  generatedAt: string;
  summary: EnergyCentreSummary;
  sourceTotals: EnergyReportSourceTotals;
  topConsumers: EnergyTopConsumer[];
  notes: string[];
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

export type WorkOrderStatus =
  | "open"
  | "assigned"
  | "in_progress"
  | "resolved"
  | "closed";

export type WorkOrderPriority = "low" | "medium" | "high" | "critical";

export type MaintenanceDueState = "overdue" | "upcoming";

export type MaintenanceScheduleCategory =
  | "preventive"
  | "predictive"
  | "condition_based"
  | "compliance"
  | "amc"
  | "calibration"
  | "runtime_based"
  | "seasonal"
  | "inspection_round"
  | "corrective_follow_up"
  | "deferred_backlog"
  | "shutdown_outage"
  | "energy_optimization"
  | "safety_critical";

export type MaintenanceGenerationMode =
  | "manual"
  | "calendar"
  | "runtime"
  | "condition"
  | "predictive";

export type AutomationRuleType = "threshold" | "time_window";
export type AutomationRuleCategory = "comfort" | "energy" | "safety" | "operations";
export type AutomationRuleOperator = "gt" | "gte" | "lt" | "lte" | "eq";
export type RuleExecutionStatus = "matched" | "not_matched" | "skipped" | "error";

export type AutomationRuleCondition =
  | {
      window: "latest";
      unit?: string;
    }
  | {
      days: string[];
      startTime: string;
      endTime: string;
    };

export type AutomationRuleAction = {
  type: "notify" | "review" | "trace_only";
  target: string;
};

/** Basic automation rule row for Phase 5 Sprint D Rule Engine responses. */
export type RuleListItem = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  category: AutomationRuleCategory;
  ruleType: AutomationRuleType;
  source: "operator_rule" | "simulator_threshold";
  enabled: boolean;
  assetId: string | null;
  assetCode: string | null;
  assetName: string | null;
  siteName: string | null;
  pointKey: string | null;
  operator: AutomationRuleOperator | null;
  thresholdValue: number | null;
  severity: string | null;
  condition: AutomationRuleCondition;
  action: AutomationRuleAction;
  lastEvaluatedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/** One evaluation trace row for the Phase 5 Sprint D Rule Engine. */
export type RuleExecutionItem = {
  id: string;
  ruleId: string;
  ruleCode: string;
  ruleName: string;
  evaluatedAt: string;
  status: RuleExecutionStatus;
  matched: boolean;
  observedValue: number | null;
  message: string | null;
  trace: Record<string, unknown> | null;
};

/** One work order row for Phase 5 Sprint A API responses. */
export type WorkOrderListItem = {
  id: string;
  assetId: string;
  alarmId: string | null;
  title: string;
  description: string | null;
  status: WorkOrderStatus;
  priority: WorkOrderPriority;
  sortOrder: number;
  assignedTo: string | null;
  createdBy: string | null;
  dueAt: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  assetCode: string;
  assetName: string;
  siteName: string;
};

/** Maintenance schedule item shown in the Phase 5 Sprint C Schedule Centre. */
export type MaintenanceScheduleItem = {
  id: string;
  templateId: string;
  assetId: string;
  title: string;
  description: string | null;
  category: MaintenanceScheduleCategory;
  generationMode: MaintenanceGenerationMode;
  ownerTeam: string | null;
  vendorName: string | null;
  complianceRef: string | null;
  triggerSummary: string | null;
  safetyCritical: boolean;
  priority: WorkOrderPriority;
  estimatedMinutes: number;
  intervalDays: number;
  nextDueAt: string;
  lastCompletedAt: string | null;
  dueState: MaintenanceDueState;
  assetCode: string;
  assetName: string;
  siteName: string;
  activeWorkOrderId: string | null;
};

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
