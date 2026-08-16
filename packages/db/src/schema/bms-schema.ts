import {
  boolean,
  customType,
  doublePrecision,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const bmsSchema = pgSchema("bms");

export const organizations = bmsSchema.table("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 64 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  active: boolean("active").notNull().default(true),
  meta: jsonb("meta"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const users = bmsSchema.table("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  displayName: varchar("display_name", { length: 255 }).notNull(),
  role: varchar("role", { length: 64 }).notNull(),
  oidcSubject: varchar("oidc_subject", { length: 255 }),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const locations = bmsSchema.table("locations", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  code: varchar("code", { length: 64 }).notNull(),
  slug: varchar("slug", { length: 64 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  type: varchar("type", { length: 32 }).notNull(),
  province: varchar("province", { length: 64 }),
  capital: varchar("capital", { length: 128 }),
  latitude: doublePrecision("latitude").notNull(),
  longitude: doublePrecision("longitude").notNull(),
  active: boolean("active").notNull().default(true),
  meta: jsonb("meta"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** RTU / gateway under a location (PHE EdgeRTU or Eskom domain simulator). */
export const rtus = bmsSchema.table("rtus", {
  id: uuid("id").primaryKey().defaultRandom(),
  locationId: uuid("location_id")
    .notNull()
    .references(() => locations.id),
  code: varchar("code", { length: 64 }).notNull(),
  displayName: varchar("display_name", { length: 255 }).notNull(),
  sourceType: varchar("source_type", { length: 32 }).notNull().default("catalog"),
  domain: varchar("domain", { length: 64 }),
  externalRtuId: integer("external_rtu_id"),
  rtuCode: varchar("rtu_code", { length: 64 }),
  mqttTopic: varchar("mqtt_topic", { length: 255 }),
  stationCode: varchar("station_code", { length: 64 }),
  stationName: varchar("station_name", { length: 255 }),
  ingestEnabled: boolean("ingest_enabled").notNull().default(false),
  active: boolean("active").notNull().default(true),
  meta: jsonb("meta"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * The plant-domain vocabulary (ADR 0031 Amendment 1) — **data, not DDL**.
 *
 * `assets.domain` and `asset_templates.domain` are foreign keys into this
 * table, so the axis is still referentially closed, but adding a sector is an
 * `INSERT` a domain pack can ship in its own seed rather than a migration and a
 * deploy. `E5.1` (water-treatment), `E5.2` (mechanical/utility) and `E5.3`
 * (facility/smart-building) are all on the roadmap, which is what makes a fixed
 * list the wrong shape here.
 *
 * `code` is the primary key rather than a surrogate uuid: domain packs
 * round-trip through JSON, which code references survive and uuids do not —
 * the same reasoning `templatePoints.pointKey` records.
 *
 * Retire a value with `active = false`, never `DELETE`. The foreign keys carry
 * no `ON DELETE` clause precisely so a delete that plant still references
 * fails loudly.
 */
export const assetDomains = bmsSchema.table("asset_domains", {
  code: varchar("code", { length: 64 }).primaryKey(),
  label: varchar("label", { length: 128 }).notNull(),
  sortOrder: integer("sort_order").notNull().default(100),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * The rule-concern vocabulary (ADR 0031 Amendment 1) — also data.
 *
 * Four rows today, and unlike `assetDomains` this one is not expected to grow
 * with sectors: a water-treatment plant has the same comfort/energy/safety/
 * operations concerns as a substation. It is a table anyway so that "not
 * expected to" can never again mean "cannot" — which is the assumption
 * `electrical` violated for as long as migration 0022 had been deployed.
 *
 * `tone` drives the badge styling. It has to be data for the same reason the
 * vocabulary does: `categoryStyle` in the web app was an exhaustive `switch`,
 * and an open vocabulary would have made a new category render unstyled, which
 * is precisely the `F4.43` failure. It is a *presentation* vocabulary owned by
 * the frontend, and that one is genuinely closed, so it keeps a SQL `CHECK`
 * (`rule_categories_tone_check`, migration 0029) rather than a table of its own.
 */
export const ruleCategories = bmsSchema.table("rule_categories", {
  code: varchar("code", { length: 64 }).primaryKey(),
  label: varchar("label", { length: 128 }).notNull(),
  tone: varchar("tone", { length: 32 }).notNull().default("neutral"),
  sortOrder: integer("sort_order").notNull().default(100),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const assets = bmsSchema.table("assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 64 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  siteName: varchar("site_name", { length: 255 }).notNull(),
  // ADR 0018: an asset must be somewhere, and need not be wired. `location_id`
  // is the column every scoped authorization check filters on, so a nullable
  // one made an asset silently invisible to location-scoped users. `rtu_id` is
  // a communications reference, not a containment edge — telemetry provenance
  // lives on `asset_points` so one asset can mix measured, manual and computed
  // points. Do not restore NOT NULL here without reading ADR 0018.
  locationId: uuid("location_id")
    .notNull()
    .references(() => locations.id),
  rtuId: uuid("rtu_id").references(() => rtus.id),
  // ADR 0031: the plant axis, and a foreign key rather than a fixed vocabulary
  // (Amendment 1) — the roadmap schedules three domain packs, so adding a
  // sector must be an INSERT, not a migration. `assets_domain_fk` in migration
  // 0029 is the enforcement, and it is stronger than the CHECK it replaced.
  //
  // The `DEFAULT 'electrical'` was dropped there too. A default that silently
  // classifies unstated plant is how `automation_rules.category` acquired the
  // drift F4.43 found; the column is NOT NULL, so an INSERT that omits a domain
  // must fail rather than be assigned one.
  domain: varchar("domain", { length: 64 })
    .notNull()
    .references(() => assetDomains.code),
  // ADR 0015: pins the exact template *version* this asset was built from,
  // because a row in `asset_templates` IS a version. Null means hand-created,
  // which every seeded asset is. Publishing a newer version never touches it.
  templateId: uuid("template_id").references(() => assetTemplates.id),
  active: boolean("active").notNull().default(true),
  meta: jsonb("meta"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const assetGroups = bmsSchema.table("asset_groups", {
  id: uuid("id").primaryKey().defaultRandom(),
  locationId: uuid("location_id")
    .notNull()
    .references(() => locations.id),
  code: varchar("code", { length: 64 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const assetGroupMembers = bmsSchema.table("asset_group_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  assetGroupId: uuid("asset_group_id")
    .notNull()
    .references(() => assetGroups.id),
  assetId: uuid("asset_id")
    .notNull()
    .references(() => assets.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Registered telemetry points per asset (source DataKey → BMS point_key). */
export const assetPoints = bmsSchema.table("asset_points", {
  id: uuid("id").primaryKey().defaultRandom(),
  assetId: uuid("asset_id")
    .notNull()
    .references(() => assets.id),
  pointKey: varchar("point_key", { length: 128 }).notNull(),
  sourceDataKey: varchar("source_data_key", { length: 128 }).notNull(),
  // ADR 0018: telemetry provenance binds at the point, not the asset. A null
  // `rtuId` is ambiguous on its own — `sourceKind` says whether the point is
  // unmapped, hand-entered or derived. Enforced by asset_points_source_ref_check:
  // `measured` requires an rtuId; `manual`/`computed` require none.
  rtuId: uuid("rtu_id").references(() => rtus.id),
  sourceKind: varchar("source_kind", { length: 16 }).notNull().default("unmapped"),
  sensorCode: varchar("sensor_code", { length: 64 }),
  unit: varchar("unit", { length: 32 }),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const userLocationAccess = bmsSchema.table("user_location_access", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  locationId: uuid("location_id")
    .notNull()
    .references(() => locations.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const userOrganizationAccess = bmsSchema.table("user_organization_access", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Org-scoped telemetry point key catalog for asset mapping. */
export const pointKeys = bmsSchema.table("point_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  code: varchar("code", { length: 128 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  domain: varchar("domain", { length: 64 }),
  unit: varchar("unit", { length: 32 }),
  description: text("description"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Asset templates (ADR 0015) — one row per template *version*.
 *
 * Identity is `(organizationId, code, version)`, and `assets.templateId` points
 * at this row, so the pin and the version can never disagree. Published rows
 * are immutable except `status -> archived`: editing one creates a new draft at
 * `max(version) + 1`. That is not ceremony — instantiated `asset_points` are
 * physical wiring that `apps/ingest` and the rule engine read, so a template
 * edit must never reach assets already built from it.
 */
export const assetTemplates = bmsSchema.table("asset_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  code: varchar("code", { length: 64 }).notNull(),
  version: integer("version").notNull().default(1),
  name: varchar("name", { length: 255 }).notNull(),
  assetType: varchar("asset_type", { length: 64 }).notNull(),
  // ADR 0031 Amendment 1: instantiating a template copies this straight onto
  // the asset it creates, so it shares the asset's vocabulary — otherwise an
  // unconstrained value here becomes a foreign-key violation one hop later, at
  // instantiation time, far from the form that caused it.
  domain: varchar("domain", { length: 64 })
    .notNull()
    .references(() => assetDomains.code),
  description: text("description"),
  // draft | published | archived — mirrors automation_rules.lifecycle_status.
  // A two-state `active` boolean cannot express "drafted, not yet publishable".
  status: varchar("status", { length: 32 }).notNull().default("draft"),
  // The E1.7 overlay (ADR 0019): KPIs, alarms with their philosophy, class-level
  // maintenance plans, and dashboard point ordering. Contracted by
  // `apps/api/src/admin/asset-templates/asset-templates-content.schema.ts` — NOT
  // by @bms/shared, which ADR 0015 named but which is types-only (a Zod schema
  // there is a runtime dependency, AGENTS.md §9.4); the DTO types live there and
  // ADR 0019 §8 ratifies the split. Rows written before that contract may hold
  // arbitrary JSON: they still read, and are rejected on the next write or
  // publish rather than by a migration.
  content: jsonb("content").notNull().default({}),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Points a template declares (ADR 0015).
 *
 * `pointKey` is a code resolved against the org's `point_keys` catalog, exactly
 * like `assetPoints.pointKey` — deliberately not a FK. A composite FK would
 * need a denormalized `organization_id` here, creating a second source of truth
 * that can drift, and domain packs (E5.1) must round-trip through JSON, which
 * code references survive and uuids do not.
 */
export const templatePoints = bmsSchema.table("template_points", {
  id: uuid("id").primaryKey().defaultRandom(),
  templateId: uuid("template_id")
    .notNull()
    .references(() => assetTemplates.id, { onDelete: "cascade" }),
  pointKey: varchar("point_key", { length: 128 }).notNull(),
  label: varchar("label", { length: 255 }),
  // An *override*, not a copy. Null means "use the catalog unit", which is
  // already what resolveCatalogPointKey returns as the fallback.
  unit: varchar("unit", { length: 32 }),
  // measured | derived. Load-bearing for F2.2: a derived point is computed by
  // the calc engine (F2.6), so instantiation must not emit an asset_points row
  // for it — asset_points.source_data_key is NOT NULL and there is no honest
  // source key for a computed tag.
  kind: varchar("kind", { length: 32 }).notNull().default("measured"),
  sourceDataKeyPattern: varchar("source_data_key_pattern", { length: 128 }),
  required: boolean("required").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  meta: jsonb("meta").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** AI onboarding wizard draft session. */
export const onboardingSessions = bmsSchema.table("onboarding_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  status: varchar("status", { length: 32 }).notNull().default("draft"),
  currentPhase: varchar("current_phase", { length: 32 }).notNull().default("location"),
  draft: jsonb("draft").notNull().default({}),
  messages: jsonb("messages").notNull().default([]),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  committedAt: timestamp("committed_at", { withTimezone: true }),
  result: jsonb("result"),
});

/** Canonical protocol definitions for onboarding and RTU connection config. */
export const protocolCatalog = bmsSchema.table("protocol_catalog", {
  code: varchar("code", { length: 32 }).primaryKey(),
  label: varchar("label", { length: 128 }).notNull(),
  description: text("description"),
  ingestWired: boolean("ingest_wired").notNull().default(false),
  exampleConfig: jsonb("example_config").notNull().default({}),
  sortOrder: integer("sort_order").notNull().default(0),
});

/** Per-RTU protocol connection config and encrypted credentials. */
export const rtuConnectionConfigs = bmsSchema.table("rtu_connection_configs", {
  id: uuid("id").primaryKey().defaultRandom(),
  rtuId: uuid("rtu_id")
    .notNull()
    .unique()
    .references(() => rtus.id, { onDelete: "cascade" }),
  protocol: varchar("protocol", { length: 32 }).notNull(),
  config: jsonb("config").notNull().default({}),
  credentialsCiphertext: bytea("credentials_ciphertext"),
  credentialsIv: bytea("credentials_iv"),
  keyVersion: integer("key_version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const userAssetGroupAccess = bmsSchema.table("user_asset_group_access", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  assetGroupId: uuid("asset_group_id")
    .notNull()
    .references(() => assetGroups.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const alarms = bmsSchema.table("alarms", {
  id: uuid("id").primaryKey().defaultRandom(),
  assetId: uuid("asset_id")
    .notNull()
    .references(() => assets.id),
  ruleKey: varchar("rule_key", { length: 64 }),
  severity: varchar("severity", { length: 32 }).notNull(),
  message: text("message").notNull(),
  raisedAt: timestamp("raised_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  acknowledgedBy: uuid("acknowledged_by").references(() => users.id),
});

export const workOrders = bmsSchema.table("work_orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  assetId: uuid("asset_id")
    .notNull()
    .references(() => assets.id),
  alarmId: uuid("alarm_id").references(() => alarms.id),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  status: varchar("status", { length: 32 }).notNull().default("open"),
  priority: varchar("priority", { length: 32 }).notNull().default("medium"),
  sortOrder: integer("sort_order").notNull().default(0),
  assignedTo: uuid("assigned_to").references(() => users.id),
  createdBy: uuid("created_by").references(() => users.id),
  dueAt: timestamp("due_at", { withTimezone: true }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const workOrderTasks = bmsSchema.table("work_order_tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  workOrderId: uuid("work_order_id")
    .notNull()
    .references(() => workOrders.id),
  title: varchar("title", { length: 255 }).notNull(),
  status: varchar("status", { length: 32 }).notNull().default("open"),
  sortOrder: integer("sort_order").notNull().default(0),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const maintenanceTaskTemplates = bmsSchema.table(
  "maintenance_task_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id),
    title: varchar("title", { length: 255 }).notNull(),
    description: text("description"),
    category: varchar("category", { length: 64 }).notNull().default("preventive"),
    generationMode: varchar("generation_mode", { length: 32 })
      .notNull()
      .default("calendar"),
    ownerTeam: varchar("owner_team", { length: 128 }),
    vendorName: varchar("vendor_name", { length: 128 }),
    complianceRef: varchar("compliance_ref", { length: 128 }),
    triggerSummary: text("trigger_summary"),
    safetyCritical: boolean("safety_critical").notNull().default(false),
    priority: varchar("priority", { length: 32 }).notNull().default("medium"),
    estimatedMinutes: integer("estimated_minutes").notNull().default(60),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

export const maintenanceSchedules = bmsSchema.table("maintenance_schedules", {
  id: uuid("id").primaryKey().defaultRandom(),
  templateId: uuid("template_id")
    .notNull()
    .references(() => maintenanceTaskTemplates.id),
  intervalDays: integer("interval_days").notNull(),
  nextDueAt: timestamp("next_due_at", { withTimezone: true }).notNull(),
  lastCompletedAt: timestamp("last_completed_at", { withTimezone: true }),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const maintenanceHistory = bmsSchema.table("maintenance_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  templateId: uuid("template_id")
    .notNull()
    .references(() => maintenanceTaskTemplates.id),
  scheduleId: uuid("schedule_id")
    .notNull()
    .references(() => maintenanceSchedules.id),
  assetId: uuid("asset_id")
    .notNull()
    .references(() => assets.id),
  workOrderId: uuid("work_order_id").references(() => workOrders.id),
  eventType: varchar("event_type", { length: 32 }).notNull(),
  notes: text("notes"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const automationRules = bmsSchema.table("automation_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 64 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  // ADR 0031: a **concern**, not a plant domain. `automation_rules_category_fk`
  // (migration 0029) is what stops this column holding the other axis again —
  // it held `electrical` on 48 rows for as long as migration 0022 had been
  // deployed, and nothing noticed until F4.23 put a validator on the boundary.
  category: varchar("category", { length: 64 })
    .notNull()
    .default("operations")
    .references(() => ruleCategories.code),
  ruleType: varchar("rule_type", { length: 32 }).notNull(),
  source: varchar("source", { length: 64 }).notNull().default("operator_rule"),
  enabled: boolean("enabled").notNull().default(true),
  assetId: uuid("asset_id").references(() => assets.id),
  pointKey: varchar("point_key", { length: 128 }),
  operator: varchar("operator", { length: 16 }),
  thresholdValue: doublePrecision("threshold_value"),
  severity: varchar("severity", { length: 32 }),
  condition: jsonb("condition").notNull().default({}),
  action: jsonb("action").notNull().default({}),
  lastEvaluatedAt: timestamp("last_evaluated_at", { withTimezone: true }),
  lifecycleStatus: varchar("lifecycle_status", { length: 32 })
    .notNull()
    .default("published"),
  publishedAt: timestamp("published_at", { withTimezone: true }).defaultNow(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  duplicatedFromRuleId: uuid("duplicated_from_rule_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const ruleExecutions = bmsSchema.table("rule_executions", {
  id: uuid("id").primaryKey().defaultRandom(),
  ruleId: uuid("rule_id")
    .notNull()
    .references(() => automationRules.id),
  evaluatedAt: timestamp("evaluated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  status: varchar("status", { length: 32 }).notNull(),
  matched: boolean("matched").notNull().default(false),
  observedValue: doublePrecision("observed_value"),
  message: text("message"),
  trace: jsonb("trace"),
});

export const auditLog = bmsSchema.table("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  actorId: uuid("actor_id").references(() => users.id),
  action: varchar("action", { length: 64 }).notNull(),
  entityType: varchar("entity_type", { length: 64 }).notNull(),
  entityId: uuid("entity_id"),
  reason: text("reason"),
  payload: jsonb("payload"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Eskom stations + SMOC campuses for the world map (`ESKOM_STATIONS` shape + campuses). */
export const mapLocations = bmsSchema.table("map_locations", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: varchar("slug", { length: 64 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  kind: varchar("kind", { length: 32 }).notNull(),
  siteName: varchar("site_name", { length: 255 }),
  latitude: doublePrecision("latitude").notNull(),
  longitude: doublePrecision("longitude").notNull(),
  capacityMw: integer("capacity_mw"),
  stationType: varchar("station_type", { length: 32 }),
  stationCategory: varchar("station_category", { length: 64 }),
  province: varchar("province", { length: 64 }),
  stationOperatingStatus: varchar("station_operating_status", { length: 16 }),
  meta: jsonb("meta"),
});
