/** Prototype role slugs stored in `bms.users.role`. */
export type UserRole =
  | "admin"
  | "organization_admin"
  | "location_admin"
  | "asset_group_admin"
  | "operator"
  | "viewer";

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

export type AccessScopeKind = "global" | "location" | "asset_group" | "none";

export type AccessLocation = {
  id: string;
  code: string;
  slug: string;
  name: string;
  type: "smoc_campus" | "rsmoc" | "csmoc";
  province: string | null;
};

export type AccessAssetGroup = {
  id: string;
  locationId: string;
  code: string;
  name: string;
};

export type AccessibleScope = {
  kind: AccessScopeKind;
  locations: AccessLocation[];
  assetGroups: AccessAssetGroup[];
  assetIds: string[];
};

export type CurrentUserResponse = {
  user: LoginResponse["user"];
  scope: AccessibleScope;
};

export type OrganizationRef = {
  id: string;
  code: string;
  name: string;
};

export type RtuSummary = {
  id: string;
  code: string;
  displayName: string;
  sourceType: "mqtt" | "simulator" | "catalog";
  domain: string | null;
  ingestEnabled: boolean;
  assetCount: number;
  freshAssetCount: number;
};

export type LocationKpiSummary = {
  id: string;
  name: string;
  type: "smoc_campus" | "rsmoc" | "csmoc";
  province: string | null;
  organization: OrganizationRef;
  rtuCount: number;
  assetCount: number;
  freshAssetCount: number;
  totalKw: number;
  openAlarms: number;
  criticalAlarms: number;
  scopeLabel: "full" | "partial";
};

export type LocationDashboardDto = LocationKpiSummary & {
  rtus: RtuSummary[];
  assets: {
    items: Array<{
      id: string;
      code: string;
      name: string;
      domain: string;
      // ADR 0018: null for a gateway-less asset. The dashboard LEFT JOINs rtus
      // so such an asset still appears with its alarms; declaring these
      // non-null would be a contract the query cannot honour.
      rtuId: string | null;
      rtuDisplayName: string | null;
      latestKw: number | null;
      latestTelemetryAt: string | null;
      freshness: "live" | "stale" | "none";
      telemetry: Array<{
        pointKey: string;
        value: number;
        unit: string | null;
        time: string;
      }>;
      openAlarmCount: number;
      criticalAlarmCount: number;
      warningAlarmCount: number;
      latestAlarm: {
        severity: string;
        message: string;
        raisedAt: string;
      } | null;
      openWorkOrderCount: number;
    }>;
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  topAssets: Array<{
    id: string;
    code: string;
    name: string;
    domain: string;
    kw: number | null;
  }>;
  workOrdersOpen: number;
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

/** Control Room environment points used by the 2D IBMS screens. */
export const CONTROL_ROOM_ENVIRONMENT_POINT_KEYS = [
  "temperature_c",
  "humidity_pct",
  "leak_state",
  "smoke_state",
] as const;

export type ControlRoomEnvironmentPointKey =
  (typeof CONTROL_ROOM_ENVIRONMENT_POINT_KEYS)[number];

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
export type AutomationRuleSeverity = "info" | "warning" | "critical";
export type AutomationRuleLifecycleStatus = "draft" | "published" | "archived";
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
  lifecycleStatus: AutomationRuleLifecycleStatus;
  condition: AutomationRuleCondition;
  action: AutomationRuleAction;
  lastEvaluatedAt: string | null;
  publishedAt: string | null;
  archivedAt: string | null;
  duplicatedFromRuleId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type RuleBuilderCatalogAsset = {
  id: string;
  code: string;
  name: string;
  siteName: string;
  domain: string;
  pointKeys: string[];
};

export type RulePreviewResult = {
  status: RuleExecutionStatus;
  matched: boolean;
  observedValue: number | null;
  message: string;
  trace: Record<string, unknown>;
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
  canonicalLocationId: string | null;
  slug: string;
  name: string;
  kind: "eskom_station" | "smoc_campus" | "rsmoc" | "csmoc";
  siteName: string | null;
  organization: OrganizationRef | null;
  latitude: number;
  longitude: number;
  capacityMw: number | null;
  stationType: string | null;
  stationCategory: string | null;
  province: string | null;
  stationOperatingStatus: string | null;
  live: MapSiteLive;
};

/** Active filter for master-data list endpoints. */
export type MasterDataActiveFilter = "true" | "false" | "all";

export type AdminOrganizationDto = {
  id: string;
  code: string;
  name: string;
  active: boolean;
  meta: Record<string, unknown> | null;
  createdAt: string;
};

export type AdminLocationDto = {
  id: string;
  organizationId: string;
  organizationCode: string;
  organizationName: string;
  code: string;
  slug: string;
  name: string;
  type: "smoc_campus" | "rsmoc" | "csmoc";
  province: string | null;
  capital: string | null;
  latitude: number;
  longitude: number;
  active: boolean;
  meta: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminRtuDto = {
  id: string;
  locationId: string;
  locationName: string;
  organizationCode: string;
  code: string;
  displayName: string;
  sourceType: "mqtt" | "simulator" | "catalog";
  domain: string | null;
  externalRtuId: number | null;
  rtuCode: string | null;
  mqttTopic: string | null;
  stationCode: string | null;
  stationName: string | null;
  ingestEnabled: boolean;
  active: boolean;
  meta: Record<string, unknown> | null;
  createdAt: string;
};

export type AdminAssetDto = {
  id: string;
  code: string;
  name: string;
  siteName: string;
  // ADR 0018: location is mandatory, gateway is optional. An asset with no
  // gateway is a first-class asset whose points are hand-entered or computed.
  locationId: string;
  locationName: string | null;
  organizationCode: string | null;
  rtuId: string | null;
  rtuDisplayName: string | null;
  domain: string;
  active: boolean;
  meta: Record<string, unknown> | null;
  createdAt: string;
};

export type AdminAssetPointDto = {
  id: string;
  assetId: string;
  assetCode: string;
  assetName: string;
  locationId: string | null;
  locationName: string | null;
  pointKey: string;
  sourceDataKey: string;
  sensorCode: string | null;
  unit: string | null;
  active: boolean;
  createdAt: string;
};

export type AdminPointKeyDto = {
  id: string;
  organizationId: string;
  organizationCode: string;
  organizationName: string;
  code: string;
  name: string;
  domain: string | null;
  unit: string | null;
  description: string | null;
  active: boolean;
  createdAt: string;
};

/**
 * One `bms.audit_log` row as returned by the read API (ADR 0021, `F4.14`).
 *
 * `actorId`/`actorEmail` are nullable: the writer resolves the actor by id or
 * email and stores `null` when neither matches, which is preserved rather than
 * rendered as a fabricated identity. `payload` is the verbatim request body of
 * the audited mutation — see ADR 0021 decision 6 before adding a field to any
 * audited request schema.
 */
export type AuditLogEntryDto = {
  id: string;
  createdAt: string;
  actorId: string | null;
  actorEmail: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  reason: string | null;
  payload: unknown;
};

/** Offset-paginated audit list. `F4.22` adds a cursor without removing these. */
export type AuditLogListResponse = {
  items: AuditLogEntryDto[];
  total: number;
  limit: number;
  offset: number;
};

/** Lifecycle of an asset template version (ADR 0015). */
export type AssetTemplateStatus = "draft" | "published" | "archived";

/**
 * Whether instantiation emits an `asset_points` row for this point.
 *
 * `derived` points are computed by the calc engine (F2.6) and deliberately
 * produce no mapping row — `asset_points.source_data_key` is NOT NULL and there
 * is no honest source key for a computed tag.
 */
export type TemplatePointKind = "measured" | "derived";

/**
 * The `asset_templates.content` overlay model (ADR 0019, backlog `E1.7`) —
 * `TemplateContent` and its sections. Split into its own module because this
 * file is at the AGENTS.md §4.5 1000-line cap.
 */
export type * from "./asset-template-content";

/**
 * Ingest data contracts (ADR 0016 §8). Re-exported here, not only under the
 * `./ingest` subpath, because `apps/api` compiles with `moduleResolution:
 * "node"` (node10), which ignores the `exports` map entirely — and the
 * `/admin/*` RTU screens are one of the two consumers §8 cites. The type-only
 * import back from `./index` inside `ingest.ts` is erased at emit, so there is
 * no runtime cycle.
 */
export * from "./ingest";

export type AdminTemplatePointDto = {
  id: string;
  templateId: string;
  pointKey: string;
  label: string | null;
  /** Override; `null` means "use the point-key catalog's unit". */
  unit: string | null;
  kind: TemplatePointKind;
  sourceDataKeyPattern: string | null;
  required: boolean;
  sortOrder: number;
  createdAt: string;
};

/**
 * One template *version* (ADR 0015) — a row is a version, so
 * `assets.templateId` pins it exactly and the two can never disagree.
 */
export type AdminAssetTemplateDto = {
  id: string;
  organizationId: string;
  organizationCode: string;
  organizationName: string;
  code: string;
  version: number;
  name: string;
  assetType: string;
  domain: string;
  description: string | null;
  status: AssetTemplateStatus;
  /**
   * The `E1.7` overlay. Typed as a bare record rather than `TemplateContent`
   * on purpose: `F2.1` shipped this column behind `z.record(z.unknown())`, so a
   * deployment may hold rows written before ADR 0019 tightened it. Those rows
   * still read and still instantiate — nothing consumes `content` — and are
   * rejected only when someone next writes or publishes them. A DTO claiming
   * `TemplateContent` would be lying about them.
   */
  content: Record<string, unknown>;
  publishedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  points: AdminTemplatePointDto[];
};

/** List rows omit `points` — the editor fetches them per template. */
export type AdminAssetTemplateSummaryDto = Omit<AdminAssetTemplateDto, "points"> & {
  pointCount: number;
};

/**
 * One asset built by `F2.2` instantiation (ADR 0015 §6).
 *
 * `skippedPoints` names the optional measured points that produced no
 * `asset_points` row because their `sourceDataKeyPattern` did not resolve.
 * Required points abort the batch instead, so anything listed here was
 * explicitly declared optional — surfaced because "12 points in, 10 rows out"
 * is otherwise indistinguishable from a bug.
 */
export type InstantiatedAssetDto = {
  id: string;
  code: string;
  name: string;
  locationId: string;
  rtuId: string | null;
  pointCount: number;
  skippedPoints: string[];
};

/** The result of one instantiate call — the whole batch or nothing. */
export type AssetInstantiationResultDto = {
  templateId: string;
  templateCode: string;
  templateVersion: number;
  locationId: string;
  rtuId: string | null;
  /** `measured` when instantiated through an RTU, `unmapped` through a location. */
  sourceKind: "measured" | "unmapped";
  assets: InstantiatedAssetDto[];
  assetCount: number;
  pointCount: number;
};

export type AdminOrganizationSummaryDto = {
  id: string;
  code: string;
  name: string;
};

export type AdminLocationSummaryDto = {
  id: string;
  code: string;
  name: string;
  organizationId: string;
  organizationCode: string;
  organizationName: string;
};

export type AdminRtuSummaryDto = {
  id: string;
  code: string;
  displayName: string;
  locationId: string;
  locationName: string;
  organizationId: string;
  organizationCode: string;
};

export type AdminAssetSummaryDto = {
  id: string;
  code: string;
  name: string;
  locationId: string;
  locationName: string | null;
  rtuId: string | null;
  rtuDisplayName: string | null;
  organizationId: string | null;
  organizationCode: string | null;
};

/** Onboarding wizard phase tracked by the AI bot. */
export type OnboardingPhase =
  | "location"
  | "rtu"
  | "point_keys"
  | "assets"
  | "mappings"
  | "review";

export type OnboardingProtocol =
  | "mqtt"
  | "simulator"
  | "catalog"
  | "modbus_tcp"
  | "bacnet"
  | "opc_ua"
  | "snmp"
  | "rest_poller";

export type OnboardingSessionStatus = "draft" | "committed" | "abandoned";

export type OnboardingChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
};

export type OnboardingFieldError = {
  path: string;
  message: string;
};

export type OnboardingAutoOpenReason =
  | "review"
  | "validation_errors"
  | "ready_to_commit";

export type OnboardingDraftLocation = {
  code: string;
  slug: string;
  name: string;
  type: "smoc_campus" | "rsmoc" | "csmoc";
  latitude: number;
  longitude: number;
  province?: string;
  capital?: string;
  meta?: Record<string, unknown>;
};

export type OnboardingDraftRtu = {
  code: string;
  displayName: string;
  protocol: OnboardingProtocol;
  config: Record<string, unknown>;
  credentialsSet?: boolean;
  domain?: string;
  externalRtuId?: number;
  rtuCode?: string;
  stationCode?: string;
  stationName?: string;
  ingestEnabled?: boolean;
  meta?: Record<string, unknown>;
};

export type OnboardingDraftPointKey = {
  code: string;
  name: string;
  domain?: string;
  unit?: string;
  description?: string;
};

export type OnboardingDraftAsset = {
  rtuIndex: number;
  code: string;
  name: string;
  siteName: string;
  domain: string;
  meta?: Record<string, unknown>;
};

export type OnboardingDraftAssetPoint = {
  assetIndex: number;
  pointKey: string;
  sourceDataKey: string;
  sensorCode?: string;
  unit?: string;
};

export type OnboardingDraftMeta = {
  rtuTargetCount?: number;
  importedFromExcel?: boolean;
  /** Point keys step satisfied using org catalog (no new keys in draft). */
  useExistingPointKeys?: boolean;
};

export type OnboardingDraft = {
  location?: OnboardingDraftLocation;
  rtus?: OnboardingDraftRtu[];
  pointKeys?: OnboardingDraftPointKey[];
  assets?: OnboardingDraftAsset[];
  assetPoints?: OnboardingDraftAssetPoint[];
  onboardingMeta?: OnboardingDraftMeta;
};

export type OnboardingSessionDto = {
  id: string;
  organizationId: string;
  organizationCode: string;
  organizationName: string;
  status: OnboardingSessionStatus;
  currentPhase: OnboardingPhase;
  draft: OnboardingDraft;
  messages: OnboardingChatMessage[];
  createdAt: string;
  updatedAt: string;
  committedAt: string | null;
  result: Record<string, unknown> | null;
};

export type OnboardingChatResponseDto = {
  assistantMessage: string;
  session: OnboardingSessionDto;
  suggestedReplies?: string[];
  validationErrors?: OnboardingFieldError[];
  readyToCommit?: boolean;
  autoOpenPreview?: boolean;
  autoOpenReason?: OnboardingAutoOpenReason;
};

export type OnboardingValidateResponseDto = {
  valid: boolean;
  errors: OnboardingFieldError[];
  preview: OnboardingDraft;
  readyToCommit: boolean;
  autoOpenPreview: boolean;
  autoOpenReason?: OnboardingAutoOpenReason;
};

export type OnboardingCommitResponseDto = {
  sessionId: string;
  locationId: string;
  rtuIds: string[];
  assetIds: string[];
  pointKeyIds: string[];
  assetPointIds: string[];
};
