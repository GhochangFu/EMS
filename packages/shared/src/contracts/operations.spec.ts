import {
  alarmAffectedAssetDtoSchema,
  alarmDetailsResponseSchema,
  alarmListItemSchema,
  alarmSeverityCountSchema,
  alarmSocketEventSchema,
  energyTopConsumerSchema,
  maintenanceScheduleItemSchema,
  ruleListItemSchema,
  vocabulariesResponseSchema,
  workOrderListItemSchema,
} from "./operations";

/**
 * `E4.3` (ADR 0073 decision 1) — the seventh open vocabulary,
 * `waterBalanceRoles`, on `GET /api/v1/vocabularies`.
 *
 * One claim per exported function; `operations.test.ts` is the vitest entry
 * point (ADR 0014). Modelled on the other contract specs in this directory.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const OTHER_SIX = {
  ruleCategories: [],
  assetDomains: [],
  alarmSeverities: [],
  alarmSkills: [],
  assetRoles: [],
  dashboardSections: [],
  // `F4.309` (owner ruling Q5): required, so every fixture carries it.
  switchingStates: [],
};

/** A response missing `waterBalanceRoles` is refused — the seventh field is required. */
export function assertRefusesResponseWithoutWaterBalanceRoles(): void {
  const result = vocabulariesResponseSchema.safeParse(OTHER_SIX);
  assert(
    result.success === false,
    "vocabulariesResponseSchema accepted a response with no waterBalanceRoles — the field " +
      "must be required, not optional, so a caller cannot silently render six vocabularies.",
  );
}

/**
 * `F4.309` / ADR 0088 Amendment 3 decision 5 (owner ruling Q5 (a)) — a response missing
 * `switchingStates` is refused; with it, empty or with a row, it parses.
 */
export function assertRequiresSwitchingStates(): void {
  const { switchingStates: _dropped, ...withoutSwitchingStates } = OTHER_SIX;
  const missing = vocabulariesResponseSchema.safeParse({ ...withoutSwitchingStates, waterBalanceRoles: [] });
  assert(missing.success === false, "vocabulariesResponseSchema accepted a response with no switchingStates");
  const withRow = vocabulariesResponseSchema.safeParse({
    ...OTHER_SIX,
    waterBalanceRoles: [],
    switchingStates: [{ pointKey: "breaker_main", value: 1, label: "CLOSED", tone: "closed" }],
  });
  assert(
    withRow.success === true,
    `vocabulariesResponseSchema refused a well-formed switchingStates row: ${JSON.stringify(
      !withRow.success ? withRow.error.issues : undefined,
    )}`,
  );
  const badTone = vocabulariesResponseSchema.safeParse({
    ...OTHER_SIX,
    waterBalanceRoles: [],
    switchingStates: [{ pointKey: "breaker_main", value: 1, label: "CLOSED", tone: "earthed" }],
  });
  assert(badTone.success === false, "vocabulariesResponseSchema accepted a switching state with tone 'earthed'");
}

/** A response with an empty `waterBalanceRoles` array parses. */
export function assertAcceptsEmptyWaterBalanceRoles(): void {
  const result = vocabulariesResponseSchema.safeParse({ ...OTHER_SIX, waterBalanceRoles: [] });
  assert(
    result.success === true,
    `vocabulariesResponseSchema refused an empty waterBalanceRoles array: ${JSON.stringify(
      !result.success ? result.error.issues : undefined,
    )}`,
  );
}

/** A response with a well-formed waterBalanceRoles row parses. */
export function assertAcceptsWaterBalanceRoleRow(): void {
  const result = vocabulariesResponseSchema.safeParse({
    ...OTHER_SIX,
    waterBalanceRoles: [{ code: "intake", label: "Intake", sortOrder: 10, active: true }],
  });
  assert(
    result.success === true,
    `vocabulariesResponseSchema refused a well-formed waterBalanceRoles row: ${JSON.stringify(
      !result.success ? result.error.issues : undefined,
    )}`,
  );
}

/**
 * `F3.28` (ADR 0074 decision 3 / plan decision 7) — `alarmSeverityCountSchema`
 * allows a `count` of zero. Every active severity is represented, whether or
 * not it currently has an alarm, so a zero row is not an anomaly.
 */
export function assertAlarmSeverityCountAllowsZero(): void {
  const result = alarmSeverityCountSchema.safeParse({
    code: "critical",
    label: "Critical",
    tone: "critical",
    rank: 30,
    count: 0,
  });
  assert(
    result.success === true,
    `alarmSeverityCountSchema refused a zero count: ${JSON.stringify(
      !result.success ? result.error.issues : undefined,
    )}`,
  );
}

/** A negative count is never a valid severity count. */
export function assertAlarmSeverityCountRefusesNegative(): void {
  const result = alarmSeverityCountSchema.safeParse({
    code: "critical",
    label: "Critical",
    tone: "critical",
    rank: 30,
    count: -1,
  });
  assert(
    result.success === false,
    "alarmSeverityCountSchema accepted a negative count",
  );
}

// ---------------------------------------------------------------------------
// `F4.316` PR 2 (ADR 0111) — the alarm schemas name the asset's RTU and location.
// Both fields are required-nullable: an absent key is refused, `null` parses.
// ---------------------------------------------------------------------------

const ALARM_LIST_ITEM = {
  id: "a1",
  assetId: "30000000-0000-4000-8000-000000000001",
  ruleKey: null,
  ruleId: null,
  severity: "critical",
  message: "High temperature",
  raisedAt: "2026-11-05T00:00:00.000Z",
  acknowledgedAt: null,
  acknowledgedBy: null,
  clearedAt: null,
  assetCode: "CR-Q1",
  assetRtuName: "RTU 1",
  assetLocationName: "Plant A",
  assetName: "Chiller Q1",
  siteName: "Site A",
  // F3.16 / ADR 0127 decision 12.
  source: "rule",
  rtuId: null,
  rtuCode: null,
};

const AFFECTED_ASSET = {
  assetId: "30000000-0000-4000-8000-000000000002",
  assetCode: "CR-Q2",
  assetRtuName: "RTU 1",
  assetLocationName: "Plant A",
  assetName: "Chiller Q2",
};

const ALARM_DETAILS = {
  id: "a1",
  assetId: "30000000-0000-4000-8000-000000000001",
  organizationId: "10000000-0000-4000-8000-000000000001",
  source: "rule",
  rtuId: null,
  rtuCode: null,
  assetCode: "CR-Q1",
  assetRtuName: "RTU 1",
  assetLocationName: "Plant A",
  assetName: "Chiller Q1",
  assetDomain: "hvac",
  locationName: "Plant A",
  siteName: "Site A",
  severity: "critical",
  message: "High temperature",
  raisedAt: "2026-11-05T00:00:00.000Z",
  acknowledgedAt: null,
  acknowledgedBy: null,
  clearedAt: null,
  ruleId: null,
  rulePointKey: null,
  thresholdOperator: null,
  thresholdValue: null,
  currentValue: null,
  currentValueUnit: null,
  currentValueAt: null,
  enrichment: null,
  classPhilosophy: null,
};

type LabelSchema = { safeParse(value: unknown): { success: boolean; error?: { issues: unknown } } };

function assertRefusesWithout(schema: LabelSchema, fixture: Record<string, unknown>, key: string, name: string): void {
  assert(schema.safeParse(fixture).success, `${name}: the positive neighbour must parse: ${JSON.stringify(schema.safeParse(fixture).error?.issues)}`);
  const { [key]: _dropped, ...without } = fixture;
  assert(schema.safeParse(without).success === false, `${name} accepted a row with no ${key} — it must be required-nullable`);
}

function assertAcceptsNullParts(schema: LabelSchema, fixture: Record<string, unknown>, name: string): void {
  const parsed = schema.safeParse({ ...fixture, assetRtuName: null, assetLocationName: null });
  assert(parsed.success, `${name} refused null assetRtuName/assetLocationName: ${JSON.stringify(parsed.error?.issues)}`);
}

export const assertAlarmListItemRequiresAssetRtuName = (): void =>
  assertRefusesWithout(alarmListItemSchema, ALARM_LIST_ITEM, "assetRtuName", "alarmListItemSchema");
export const assertAlarmListItemRequiresAssetLocationName = (): void =>
  assertRefusesWithout(alarmListItemSchema, ALARM_LIST_ITEM, "assetLocationName", "alarmListItemSchema");
export const assertAlarmListItemAcceptsNullParts = (): void =>
  assertAcceptsNullParts(alarmListItemSchema, ALARM_LIST_ITEM, "alarmListItemSchema");

/**
 * `F3.16` / ADR 0127 decision 12 — a device alarm has no asset: an `rtu_comms`
 * row names its RTU, an `ingest_host` row names neither. Both parse, on the list
 * and on the socket payload.
 */
export function assertAlarmListItemAcceptsDeviceAlarms(): void {
  const noAsset = { ...ALARM_LIST_ITEM, assetId: null, assetCode: null, assetName: null, siteName: null, assetRtuName: null, assetLocationName: null };
  const comms = { ...noAsset, source: "rtu_comms", rtuId: "40000000-0000-4000-8000-000000000001", rtuCode: "RTU-7" };
  const host = { ...noAsset, source: "ingest_host" };
  for (const [label, row] of [["rtu_comms", comms], ["ingest_host", host]] as const) {
    const parsed = alarmListItemSchema.safeParse(row);
    assert(parsed.success, `alarmListItemSchema refused an ${label} alarm: ${JSON.stringify(parsed.error?.issues)}`);
    assert(alarmSocketEventSchema.safeParse({ type: "created", alarm: row }).success, `the created event refused an ${label} alarm`);
  }
}

/** `source` is required and closed to the three sources; `rtuId` and `rtuCode` are required-nullable. */
export function assertAlarmListItemRequiresSourceAndRtu(): void {
  for (const key of ["source", "rtuId", "rtuCode"]) {
    assertRefusesWithout(alarmListItemSchema, ALARM_LIST_ITEM, key, "alarmListItemSchema");
  }
  assert(
    alarmListItemSchema.safeParse({ ...ALARM_LIST_ITEM, source: "edge_gateway" }).success === false,
    "alarmListItemSchema accepted an unknown source",
  );
}

/** The socket payload wraps the list item, so it inherits the requirement. */
export function assertAlarmSocketEventRequiresAssetRtuName(): void {
  const { assetRtuName: _dropped, ...without } = ALARM_LIST_ITEM;
  assert(alarmSocketEventSchema.safeParse({ type: "cleared", alarm: ALARM_LIST_ITEM }).success, "the cleared event must parse");
  assert(
    alarmSocketEventSchema.safeParse({ type: "cleared", alarm: without }).success === false,
    "alarmSocketEventSchema accepted an alarm with no assetRtuName",
  );
}

export const assertAlarmDetailsRequiresAssetRtuName = (): void =>
  assertRefusesWithout(alarmDetailsResponseSchema, ALARM_DETAILS, "assetRtuName", "alarmDetailsResponseSchema");
export const assertAlarmDetailsRequiresAssetLocationName = (): void =>
  assertRefusesWithout(alarmDetailsResponseSchema, ALARM_DETAILS, "assetLocationName", "alarmDetailsResponseSchema");
export const assertAlarmDetailsAcceptsNullParts = (): void =>
  assertAcceptsNullParts(alarmDetailsResponseSchema, ALARM_DETAILS, "alarmDetailsResponseSchema");

/**
 * `F3.16` / ADR 0127 decision 14 — a device alarm's details carry no asset:
 * every asset field is null, `source`/`rtuId`/`rtuCode` are required.
 */
export function assertAlarmDetailsAcceptsDeviceAlarms(): void {
  const noAsset = {
    ...ALARM_DETAILS,
    assetId: null,
    assetCode: null,
    assetRtuName: null,
    assetLocationName: null,
    assetName: null,
    assetDomain: null,
    locationName: null,
    siteName: null,
  };
  const comms = { ...noAsset, source: "rtu_comms", rtuId: "40000000-0000-4000-8000-000000000001", rtuCode: "RTU-7" };
  const host = { ...noAsset, source: "ingest_host" };
  for (const [label, row] of [["rtu_comms", comms], ["ingest_host", host]] as const) {
    const parsed = alarmDetailsResponseSchema.safeParse(row);
    assert(parsed.success, `alarmDetailsResponseSchema refused an ${label} alarm: ${JSON.stringify(parsed.error?.issues)}`);
  }
  for (const key of ["source", "rtuId", "rtuCode"]) {
    assertRefusesWithout(alarmDetailsResponseSchema, ALARM_DETAILS, key, "alarmDetailsResponseSchema");
  }
}

export const assertAffectedAssetRequiresAssetRtuName = (): void =>
  assertRefusesWithout(alarmAffectedAssetDtoSchema, AFFECTED_ASSET, "assetRtuName", "alarmAffectedAssetDtoSchema");
export const assertAffectedAssetRequiresAssetLocationName = (): void =>
  assertRefusesWithout(alarmAffectedAssetDtoSchema, AFFECTED_ASSET, "assetLocationName", "alarmAffectedAssetDtoSchema");
export const assertAffectedAssetAcceptsNullParts = (): void =>
  assertAcceptsNullParts(alarmAffectedAssetDtoSchema, AFFECTED_ASSET, "alarmAffectedAssetDtoSchema");

const WORK_ORDER_LIST_ITEM = {
  id: "w1",
  assetId: "30000000-0000-4000-8000-000000000001",
  alarmId: null,
  title: "Replace bearing",
  description: null,
  status: "open",
  priority: "medium",
  sortOrder: 0,
  assignedTo: null,
  createdBy: null,
  dueAt: null,
  resolvedAt: null,
  closedAt: null,
  reference: "GEN-000001",
  slaMinutes: null,
  slaDueAt: null,
  slaState: "none",
  checklistDone: 0,
  checklistTotal: 0,
  causeCode: null,
  approvedAt: null,
  createdAt: "2026-11-05T00:00:00.000Z",
  updatedAt: "2026-11-05T00:00:00.000Z",
  assetCode: "CR-Q1",
  assetRtuName: "RTU 1",
  assetLocationName: "Plant A",
  assetName: "Chiller Q1",
  siteName: "Site A",
};

const MAINTENANCE_SCHEDULE_ITEM = {
  id: "m1",
  templateId: "t1",
  assetId: "30000000-0000-4000-8000-000000000001",
  title: "Quarterly scan",
  description: null,
  category: "preventive",
  generationMode: "calendar",
  ownerTeam: null,
  vendorName: null,
  complianceRef: null,
  triggerSummary: null,
  safetyCritical: false,
  priority: "medium",
  estimatedMinutes: 60,
  intervalDays: 90,
  nextDueAt: "2026-12-01T00:00:00.000Z",
  lastCompletedAt: null,
  dueState: "upcoming",
  assetCode: "CR-Q1",
  assetRtuName: "RTU 1",
  assetLocationName: "Plant A",
  assetName: "Chiller Q1",
  siteName: "Site A",
  activeWorkOrderId: null,
  active: true,
};

export const assertWorkOrderRequiresAssetRtuName = (): void =>
  assertRefusesWithout(workOrderListItemSchema, WORK_ORDER_LIST_ITEM, "assetRtuName", "workOrderListItemSchema");
export const assertWorkOrderRequiresAssetLocationName = (): void =>
  assertRefusesWithout(workOrderListItemSchema, WORK_ORDER_LIST_ITEM, "assetLocationName", "workOrderListItemSchema");
export const assertWorkOrderAcceptsNullParts = (): void =>
  assertAcceptsNullParts(workOrderListItemSchema, WORK_ORDER_LIST_ITEM, "workOrderListItemSchema");

export const assertScheduleRequiresAssetRtuName = (): void =>
  assertRefusesWithout(maintenanceScheduleItemSchema, MAINTENANCE_SCHEDULE_ITEM, "assetRtuName", "maintenanceScheduleItemSchema");
export const assertScheduleRequiresAssetLocationName = (): void =>
  assertRefusesWithout(maintenanceScheduleItemSchema, MAINTENANCE_SCHEDULE_ITEM, "assetLocationName", "maintenanceScheduleItemSchema");
export const assertScheduleAcceptsNullParts = (): void =>
  assertAcceptsNullParts(maintenanceScheduleItemSchema, MAINTENANCE_SCHEDULE_ITEM, "maintenanceScheduleItemSchema");

// `F4.316` PR 4b (ADR 0111) — the rule row names its asset's RTU and location; nullable like `assetCode`.
const RULE_LIST_ITEM = {
  id: "r1",
  code: "CHILLER_HIGH_TEMP",
  name: "Chiller high temperature",
  description: null,
  category: "hvac",
  ruleType: "threshold",
  source: "operator_rule",
  enabled: true,
  assetId: "30000000-0000-4000-8000-000000000001",
  assetCode: "CR-Q1",
  assetRtuName: "RTU 1",
  assetLocationName: "Plant A",
  assetName: "Chiller Q1",
  siteName: "Site A",
  assetDomain: "hvac",
  pointKey: "supply_temp_c",
  operator: "gte",
  thresholdValue: 12,
  severity: "warning",
  clearHoldSeconds: null,
  lifecycleStatus: "published",
  condition: { window: "latest" },
  action: { type: "notify", target: "Operations" },
  lastEvaluatedAt: null,
  publishedAt: null,
  archivedAt: null,
  duplicatedFromRuleId: null,
  createdAt: "2026-11-05T00:00:00.000Z",
  updatedAt: "2026-11-05T00:00:00.000Z",
};

export const assertRuleRequiresAssetRtuName = (): void =>
  assertRefusesWithout(ruleListItemSchema, RULE_LIST_ITEM, "assetRtuName", "ruleListItemSchema");
export const assertRuleRequiresAssetLocationName = (): void =>
  assertRefusesWithout(ruleListItemSchema, RULE_LIST_ITEM, "assetLocationName", "ruleListItemSchema");
export const assertRuleAcceptsNullParts = (): void =>
  assertAcceptsNullParts(ruleListItemSchema, RULE_LIST_ITEM, "ruleListItemSchema");

/** `F4.316` PR 6 (ADR 0111, Q1) — a top consumer keeps its `code` field and gains the two label parts. */
const ENERGY_TOP_CONSUMER = {
  assetId: "30000000-0000-4000-8000-000000000001",
  code: "PHE-MFM-000000003",
  assetRtuName: "Lotapata I",
  assetLocationName: "Lotapata",
  name: "Main meter",
  siteName: "Lotapata",
  avgKw: 12.5,
  estimatedKwh: 300,
};

export const assertTopConsumerRequiresAssetRtuName = (): void =>
  assertRefusesWithout(energyTopConsumerSchema, ENERGY_TOP_CONSUMER, "assetRtuName", "energyTopConsumerSchema");
export const assertTopConsumerRequiresAssetLocationName = (): void =>
  assertRefusesWithout(energyTopConsumerSchema, ENERGY_TOP_CONSUMER, "assetLocationName", "energyTopConsumerSchema");
export const assertTopConsumerAcceptsNullParts = (): void =>
  assertAcceptsNullParts(energyTopConsumerSchema, ENERGY_TOP_CONSUMER, "energyTopConsumerSchema");
