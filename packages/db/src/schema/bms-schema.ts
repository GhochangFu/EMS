import {
  boolean,
  doublePrecision,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { bytea } from "./column-types";

/**
 * The core of the `bms` schema: identity, the location/RTU/asset hierarchy,
 * the global vocabularies, asset templates, onboarding and the audit log.
 *
 * **This file no longer holds every `bms.*` table.** It stood at 999 lines
 * against AGENTS.md §4.5's 1000-line cap, so two domains moved to siblings:
 * `alarms-schema.ts` (automation rules, alarms, notifications) and
 * `maintenance-schema.ts` (work orders, planned maintenance). They already had
 * company — `dashboard-schema.ts` and `telemetry-schema.ts` split out earlier.
 * Import from `./schema` rather than from this file directly; the barrel
 * re-exports all five and is what every consumer outside `packages/db` uses.
 *
 * The split direction is deliberate: this module references nothing in any
 * sibling, and every sibling references back into it. A new table belongs here
 * only if something in this file must reference it.
 */

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
  // E7.1b / ADR 0043 Amendment 4: the user's HOME org. Permanently nullable —
  // a global `admin` (Ion Exchange / the Euphoria operator) belongs to no
  // organization and resolves to bms_fleet. A NULL on any scoped role is a
  // defect the 0046 backfill aborts on. See migration 0046.
  organizationId: uuid("organization_id").references(() => organizations.id),
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
  // E7.1b (ADR 0043 §5): NOT NULL — migration 0047 applied the SET NOT NULL.
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
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

/**
 * The alarm severity vocabulary (ADR 0032, migration 0030).
 *
 * `F4.46` asserted this column wanted a `CHECK`, citing ADR 0031. That citation
 * does not hold — ADR 0031 does not mention severity, and its Amendment 1 moved
 * the opposite way. Client ask `B9` may add a fourth level (`high`), and
 * migrations here are forward-only, so a frozen set costs a migration and a
 * deploy the week the answer arrives.
 *
 * **`rank` is what makes an open set safe for a column with behaviour attached.**
 * Unlike `category`, which ADR 0031 checked and found inert, severity orders by
 * urgency and selects a colour. A value declared with neither would arrive
 * unsortable and unstyled — the `F4.43` failure again — so the table carries
 * both and a level cannot be declared without them. Higher `rank` is more
 * urgent, and the seeded values are spaced by ten (10/20/30) so `high` fits at
 * 25 without renumbering live rows. `UNIQUE`: two levels with the same urgency
 * have no defined order.
 *
 * `tone` is a *presentation* vocabulary owned by the frontend, and that one is
 * genuinely closed, so it keeps a SQL `CHECK` (`alarm_severities_tone_check`)
 * rather than a table of its own — the same line ADR 0031 drew for
 * `rule_categories.tone`. Its five values are the `StatusPill` palette.
 */
export const alarmSeverities = bmsSchema.table("alarm_severities", {
  code: varchar("code", { length: 64 }).primaryKey(),
  label: varchar("label", { length: 128 }).notNull(),
  // No default: see migration 0030. `info` would be a claim, and a level
  // seeded without a tone must fail rather than quietly become the calmest one.
  tone: varchar("tone", { length: 32 }).notNull(),
  // Named to match the raw SQL. `.unique()` with no argument makes drizzle
  // derive `alarm_severities_rank_unique`, so `\d` and this file would describe
  // the same object under two names.
  rank: integer("rank").notNull().unique("alarm_severities_rank_key"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * The asset role vocabulary (ADR 0049 decision 5) — what part a member plays
 * **in that group**, so it hangs off `assetGroupMembers` and not off `assets`.
 * Open, on ADR 0032's test: a role's behaviour is "match this member", which
 * *is* the code. Global — no `organizationId`, no RLS, the class `0047` left
 * alone. Retire with `active = false`, never `DELETE`.
 *
 * Migration `0051`'s header carries the full record, including why ADR 0049's
 * "both tenant-scoped" Consequences line does not describe this table.
 */
export const assetRoles = bmsSchema.table("asset_roles", {
  code: varchar("code", { length: 64 }).primaryKey(),
  label: varchar("label", { length: 128 }).notNull(),
  sortOrder: integer("sort_order").notNull().default(100),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const assets = bmsSchema.table("assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  // E7.1b (ADR 0043 §5): NOT NULL — migration 0047 applied the SET NOT NULL.
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
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
  // 0029 is the enforcement.
  //
  // It replaced **no constraint at all**: before 0029 this was a bare varchar
  // with `DEFAULT 'electrical'` and nothing checking it, which is how the
  // vocabulary drifted unnoticed in the first place (F4.43).
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
  // E7.1b (ADR 0043 §5): NOT NULL — migration 0047 applied the SET NOT NULL.
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
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
  // ADR 0049 decision 5 (migration 0051). Nullable: every membership written
  // before 0051 has no role, and a default would be a claim — the reason 0029
  // dropped `assets.domain`'s. NOT unique per (group, role): the mock's nodes
  // are plural ("Chillers 2 of 3"), and one role still maps to one widget.
  role: varchar("role", { length: 64 }).references(() => assetRoles.code),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Registered telemetry points per asset (source DataKey → BMS point_key). */
export const assetPoints = bmsSchema.table("asset_points", {
  id: uuid("id").primaryKey().defaultRandom(),
  // E7.1b (ADR 0043 §5): NOT NULL — migration 0047 applied the SET NOT NULL.
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
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
  // ADR 0039 decisions 6 and 7: this asset's override of the calc config its
  // pinned template version declares, mirroring `templatePoints` column for
  // column. NULL means "inherit", which is what every row written before
  // migration 0037 already did implicitly — hence five nullable columns rather
  // than one jsonb blob, so a partial override restates one field, not a point.
  // Resolution is `coalesce(assetPoints.<col>, templatePoints.<col>)` per
  // column. Only a `sourceKind = 'computed'` row ever carries a value here.
  //
  // No DB CHECK, and *not* for migrations 0035/0036's reason — this table does
  // carry CHECKs. The trigger/interval invariants constrain the **resolved**
  // value, which depends on the template version `assets.templateId` pins, so a
  // row-level CHECK cannot see it. Enforced in apps/api's Zod layer, which
  // validates the merge and names the inherited value it conflicts with; see
  // migration 0037's header.
  formula: text("formula"),
  formulaDialect: varchar("formula_dialect", { length: 32 }),
  calcTrigger: varchar("calc_trigger", { length: 16 }),
  calcIntervalSeconds: integer("calc_interval_seconds"),
  maxInputAgeSeconds: integer("max_input_age_seconds"),
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

/**
 * Fleet-wide telemetry point key catalog. **`F3.39` — no `organizationId`**:
 * `0057` makes this a global vocabulary beside `asset_roles`, and
 * `asset_points.point_key` references `code`. That migration's header is why.
 */
export const pointKeys = bmsSchema.table("point_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
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
 * physical wiring that `apps/ingest` and the rule engine read.
 *
 * So a template *edit* never reaches assets already built from it, and a
 * published version stays immutable. An asset's pin changes only through the
 * explicit, previewed and audited migration ADR 0039 defines — never as a side
 * effect of publishing a new version.
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
 * `pointKey` is a code resolved against the fleet-wide `point_keys` catalog,
 * exactly like `assetPoints.pointKey`, and **`F3.42` gives it the same foreign
 * key** — ADR 0051 Amendment 3, migration `0058`. ADR 0015 §3's reason for
 * refusing one is void since `0057`: `code` is unique alone, so no denormalized
 * `organization_id` is needed here. Domain packs still round-trip through JSON.
 */
export const templatePoints = bmsSchema.table("template_points", {
  id: uuid("id").primaryKey().defaultRandom(),
  // E7.1b: audit-added tenant table (decision 5 "at minimum"). NOT NULL as of
  // 0047; org resolves via template_id -> asset_templates (already org-scoped).
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  templateId: uuid("template_id")
    .notNull()
    .references(() => assetTemplates.id, { onDelete: "cascade" }),
  pointKey: varchar("point_key", { length: 128 }).notNull(),
  label: varchar("label", { length: 255 }),
  // An *override*, not a copy. Null means "use the catalog unit", which is
  // already what resolveCatalogPointKey returns as the fallback.
  unit: varchar("unit", { length: 32 }),
  // measured | derived. Load-bearing for F2.2: a derived point is computed by
  // the calc engine (F2.4), so instantiation must not emit an asset_points row
  // for it — asset_points.source_data_key is NOT NULL and there is no honest
  // source key for a computed tag.
  kind: varchar("kind", { length: 32 }).notNull().default("measured"),
  sourceDataKeyPattern: varchar("source_data_key_pattern", { length: 128 }),
  // ADR 0036 decisions 5 and 7: how a derived point is computed. Nullable —
  // the kind/formula exclusivity (derived requires both set, measured
  // requires both absent) is enforced in apps/api's Zod layer, not a DB
  // CHECK; see migration 0035's header for why.
  formula: text("formula"),
  formulaDialect: varchar("formula_dialect", { length: 32 }),
  // ADR 0037 decision 4: when the formula above runs, and how stale its
  // inputs may be. Nullable for the same reason and by the same rule as
  // formula/formulaDialect above — enforced in apps/api's Zod layer, not a
  // DB CHECK; see migration 0036's header.
  calcTrigger: varchar("calc_trigger", { length: 16 }),
  calcIntervalSeconds: integer("calc_interval_seconds"),
  maxInputAgeSeconds: integer("max_input_age_seconds"),
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
  // E7.1b: audit-added tenant table (decision 5 "at minimum"). Holds encrypted
  // RTU credentials — leaving it unpoliced is the exact cross-org read RLS
  // closes. NOT NULL as of 0047; org resolves via rtu_id -> rtus.
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
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

export const auditLog = bmsSchema.table("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  // E7.1b / ADR 0043 decision 5: permanently NULLABLE — a platform event
  // ("organization X created") belongs to no tenant and is visible only under
  // bms_fleet. A tenant-scoped action must still set it; a NULL on such a row is
  // a defect, not a platform event.
  organizationId: uuid("organization_id").references(() => organizations.id),
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
