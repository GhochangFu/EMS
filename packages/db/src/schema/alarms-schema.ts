import {
  boolean,
  doublePrecision,
  foreignKey,
  integer,
  jsonb,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import {
  alarmSeverities,
  assetTemplates,
  assets,
  bmsSchema,
  locations,
  organizations,
  ruleCategories,
  rtus,
  users,
} from "./bms-schema";
import { bytea } from "./column-types";

/**
 * Detection and response: automation rules, the alarms they raise, and the
 * notifications those alarms send.
 *
 * **Why these sixteen tables are one module and not three.** They form a cycle
 * that cannot be cut by domain. `alarms.rule_id` references
 * `automation_rules.id` (ADR 0032), and `notification_deliveries.alarm_id`
 * references `alarms.id` — so rules depend on alarms and alarms depend on
 * rules. Drizzle's `() =>` callbacks are lazy, so splitting them would compile
 * and would run; it would also leave two modules importing each other, which is
 * a hazard the next person has to re-derive. One module states the cycle once.
 * The four `alarm_escalation_*` tables (ADR 0057 decision 7, migration `0066`)
 * sit at the end of the file: they reference `notification_channels` and
 * `alarm_severities`, and nothing references them back. The two
 * `maintenance_window*` tables (ADR 0131, migration `0152`) close the file:
 * `alarms.suppressed_by_window_id` references a window, and a window's targets
 * reference assets, locations and rules.
 *
 * Every reference OUT of this module points at `bms-schema.ts`, never back.
 * That is what keeps the split acyclic at module level.
 *
 * Split out of `bms-schema.ts`, which stood at 999 of AGENTS.md §4.5's
 * 1000-line cap. No table, column, constraint or comment changed in the move.
 */

export const alarms = bmsSchema.table("alarms", {
  id: uuid("id").primaryKey().defaultRandom(),
  // E7.1b (ADR 0043 §5): NOT NULL — migration 0047 applied the SET NOT NULL.
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  // F3.16 / ADR 0127 decision 12 (migration 0151): nullable — a device alarm
  // (`source` 'rtu_comms' or 'ingest_host') has no asset.
  // `alarms_source_shape_check` (SQL-only) keeps it NOT NULL for a 'rule' alarm.
  assetId: uuid("asset_id").references(() => assets.id),
  ruleKey: varchar("rule_key", { length: 64 }),
  // ADR 0032: `alarms_severity_fk` (migration 0030) is what closes this column.
  // It was `varchar(32)` with no constraint, so the only thing keeping it clean
  // was that every writer happened to be well-behaved — `F4.46` found the page
  // reading it defensively for exactly that reason.
  // ADR 0032, and 64 rather than 32 on purpose: it must match
  // `alarm_severities.code`, or a long code passes `assertAlarmSeverity` and
  // then fails the write with SQLSTATE 22001 — a 500 on the exact path that
  // service exists to turn into a 400. Migration 0030 widens it.
  severity: varchar("severity", { length: 64 })
    .notNull()
    .references(() => alarmSeverities.code),
  message: text("message").notNull(),
  raisedAt: timestamp("raised_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  acknowledgedBy: uuid("acknowledged_by").references(() => users.id),
  // ADR 0057 decision 1 (F3.10, migration 0066). An alarm is ACTIVE while
  // `cleared_at IS NULL`; acknowledgement is an annotation, not a closure. The
  // lifecycle sweep is the one writer of both stamps (ADR 0033 keeps
  // `AlarmRaiser` the one raiser). `0066` backfilled `cleared_at =
  // acknowledged_at` on every row acknowledged under the old predicate.
  clearedAt: timestamp("cleared_at", { withTimezone: true }),
  // Decision 5: NULL while the latest sample matches (or is stale); the moment
  // the samples first went non-matching otherwise. `cleared_at` is stamped
  // once `now() - normal_since` reaches the rule's hold.
  normalSince: timestamp("normal_since", { withTimezone: true }),
  // ADR 0033 / F3.6, migration 0032. Nullable — a historical alarm raised
  // before this column existed, or by the pre-merge hardcoded ladder, cannot
  // always be attributed to a rule. `alarms_open_per_rule_uidx` (partial,
  // `WHERE cleared_at IS NULL AND rule_id IS NOT NULL` since `0066` — it was
  // `acknowledged_at IS NULL` from `0032` to `0065`) is what makes the
  // alarm-raise dedupe a constraint instead of a SELECT-then-INSERT race: an
  // acknowledged alarm whose condition still holds does not re-raise; a new
  // row opens only after the previous one clears.
  ruleId: uuid("rule_id").references(() => automationRules.id),
  // F3.16 / ADR 0127 decision 12 (migration 0151). 'rule', 'rtu_comms' or
  // 'ingest_host' (`alarms_source_check`); the shape per source is
  // `alarms_source_shape_check`. Both CHECKs and the per-device dedupe
  // `alarms_open_per_device_uidx` (partial, `cleared_at IS NULL AND source <>
  // 'rule'`, on `(organization_id, source, COALESCE(rtu_id, organization_id))`)
  // are SQL-only, like `alarms_open_per_rule_uidx`.
  source: varchar("source", { length: 32 }).notNull().default("rule"),
  // The silent RTU of an 'rtu_comms' alarm; keyed to `rtus (id,
  // organization_id)` below, so an alarm can only name an RTU of its own
  // organization.
  rtuId: uuid("rtu_id"),
  // F4.359 / ADR 0131 (migration 0152). When a maintenance window began to
  // suppress the alarm, and which window; `suppressedByWindowId` is kept after
  // the lift (history) and replaced by a later window's id. `unsuppressedAt`
  // (plan ruling Q2) is the lift: the alarm returns as new and its escalation
  // clock starts there. `alarms_suppressed_shape_check` (SQL-only) requires the
  // window id with `suppressed_at` and refuses it on an 'ingest_host' alarm.
  suppressedAt: timestamp("suppressed_at", { withTimezone: true }),
  suppressedByWindowId: uuid("suppressed_by_window_id"),
  unsuppressedAt: timestamp("unsuppressed_at", { withTimezone: true }),
}, (t) => {
  return {
    rtuOrganizationFk: foreignKey({
      name: "alarms_rtu_id_organization_id_fkey",
      columns: [t.rtuId, t.organizationId],
      foreignColumns: [rtus.id, rtus.organizationId],
    }),
    // Composite, so an alarm can only name a window of its own organization.
    suppressedByWindowOrganizationFk: foreignKey({
      name: "alarms_suppressed_by_window_id_organization_id_fkey",
      columns: [t.suppressedByWindowId, t.organizationId],
      foreignColumns: [maintenanceWindows.id, maintenanceWindows.organizationId],
    }),
  };
});

/**
 * ADR 0034 (`E2.1`) — a fourth open vocabulary, in the ADR 0031/0032 shape:
 * `INSERT`-able, not an enum. `sort_order`, not `rank`: a skill carries no
 * urgency the way severity does, and two may legitimately sort together —
 * this is `bms.asset_domains`'s half of the pattern, not severity's. No
 * `tone`: a skill drives no styling.
 */
export const alarmSkills = bmsSchema.table("alarm_skills", {
  code: varchar("code", { length: 64 }).primaryKey(),
  label: varchar("label", { length: 128 }).notNull(),
  sortOrder: integer("sort_order").notNull().default(100),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * ADR 0034 (`E2.1`) — one row per alarm, a companion table to `bms.alarms`
 * rather than new columns on it, so F3.10's `cleared_at` addition (which
 * landed in `0066`) and this one never touched the same table in parallel.
 *
 * `alarmId` is UNIQUE: exactly one enrichment per alarm instance, not a
 * history of edits — an edit overwrites the row; `updatedBy`/`updatedAt`
 * record who/when, not a version chain. `onDelete: "cascade"`, unlike
 * `alarms.ruleId`'s `NO ACTION` (ADR 0033 decision 5): no code deletes a
 * `bms.alarms` row today, and an enrichment has no independent meaning to
 * preserve without the alarm it describes.
 *
 * `skillCode` is varchar(64), matching `alarm_skills.code`'s width from
 * creation — unlike `alarms.severity`'s original varchar(32) that migration
 * 0030 step 4 had to widen after the fact. No `onDelete` on `skillCode`:
 * retiring a skill is `active = false`, not a delete.
 */
export const alarmEnrichments = bmsSchema.table("alarm_enrichments", {
  id: uuid("id").primaryKey().defaultRandom(),
  // E7.1b: audit-added tenant table (decision 5 "at minimum"). NOT NULL as of
  // 0047; org resolves via alarm_id -> alarms.
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  alarmId: uuid("alarm_id")
    .notNull()
    .unique()
    .references(() => alarms.id, { onDelete: "cascade" }),
  rootCause: text("root_cause"),
  impact: text("impact"),
  correctiveActions: text("corrective_actions"),
  energyImpact: text("energy_impact"),
  waterImpact: text("water_impact"),
  productionImpact: text("production_impact"),
  etrAt: timestamp("etr_at", { withTimezone: true }),
  skillCode: varchar("skill_code", { length: 64 }).references(() => alarmSkills.code),
  updatedBy: uuid("updated_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * ADR 0034 (`E2.1`) — affected assets as a join table, matching the existing
 * convention (`asset_group_members`) rather than a jsonb/array column, so a
 * deleted asset cannot leave a dangling reference silently.
 */
export const alarmAffectedAssets = bmsSchema.table(
  "alarm_affected_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    enrichmentId: uuid("enrichment_id")
      .notNull()
      .references(() => alarmEnrichments.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    enrichmentAssetUnique: unique("alarm_affected_assets_enrichment_asset_key").on(
      t.enrichmentId,
      t.assetId,
    ),
  }),
);

export const automationRules = bmsSchema.table("automation_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  // E7.1b (ADR 0043 §5/§6): nullable until migration 0047's SET NOT NULL.
  // Derived on write — asset for threshold rules, actor's tenant context for
  // time_window (a time_window create with no resolvable org returns 4xx).
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  // NOT `.unique()`: 0048 re-keyed identity to (organization_id, code) and
  // dropped the old global-unique `automation_rules_code_idx`, replacing it
  // with `automation_rules_org_code_idx` — a composite unique index the
  // migration owns and this file does not mirror (see notificationDeliveries'
  // comment below for the convention).
  code: varchar("code", { length: 64 }).notNull(),
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
  // ADR 0032, and it stays NULLABLE on purpose. `F4.46`'s write-path fix
  // established that a rule may hold no severity — the alarm engine only loads
  // `ruleType = 'threshold'`, so a time-window rule has nothing to be severe
  // about — and a nullable foreign key permits exactly that, since NULL is not
  // checked against the referenced table.
  severity: varchar("severity", { length: 64 }).references(() => alarmSeverities.code),
  // ADR 0057 decision 3 (F3.10, migration 0066). Nullable on purpose, the
  // `F4.46` null discipline: NULL means the 120 s default, substituted where
  // the value is consumed (`DEFAULT_CLEAR_HOLD_SECONDS`), never on the write
  // path. No CHECK — the 1..86 400 bound is the Zod schema's (0062's split).
  clearHoldSeconds: integer("clear_hold_seconds"),
  condition: jsonb("condition").notNull().default({}),
  action: jsonb("action").notNull().default({}),
  lastEvaluatedAt: timestamp("last_evaluated_at", { withTimezone: true }),
  lifecycleStatus: varchar("lifecycle_status", { length: 32 })
    .notNull()
    .default("published"),
  publishedAt: timestamp("published_at", { withTimezone: true }).defaultNow(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  duplicatedFromRuleId: uuid("duplicated_from_rule_id"),
  // ADR 0058 decision 5 (E2.4, migration 0067). All four NULL for every rule
  // not seeded from a template — which is every row that predates this
  // migration, and `duplicateRule`'s insert on purpose (blast radius table):
  // a duplicate is an operator rule, and its provenance stays NULL too.
  sourceTemplateId: uuid("source_template_id").references(() => assetTemplates.id),
  sourceTemplateVersion: integer("source_template_version"),
  sourceAlarmCode: varchar("source_alarm_code", { length: 64 }),
  seededBaseline: jsonb("seeded_baseline"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (t) => {
  // F4.359 (migration 0152). Only the target of `maintenance_window_targets_rule_fkey`;
  // never refuses a row (`id` is the PK). Block body so the text slices still end at
  // the first `});`.
  return {
    idOrganizationKey: unique("automation_rules_id_organization_id_key").on(t.id, t.organizationId),
  };
});

export const ruleExecutions = bmsSchema.table("rule_executions", {
  id: uuid("id").primaryKey().defaultRandom(),
  // E7.1b (ADR 0043 §5): NOT NULL — migration 0047 applied the SET NOT NULL.
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
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

/**
 * F3.8 notifications (ADR 0041) — mirrors migration
 * `0038_notification_channels.sql`. The migration is the source of truth; this
 * is the typed view of it. Read that file for why the kind vocabulary is a
 * table while the delivery status is a CHECK, and why no rule is ever deleted.
 */
export const notificationChannelKinds = bmsSchema.table("notification_channel_kinds", {
  code: varchar("code", { length: 64 }).primaryKey(),
  label: varchar("label", { length: 128 }).notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const notificationChannels = bmsSchema.table("notification_channels", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Stays NULLABLE — ADR 0043 Amendment 5 keeps this the fleet-managed-global
  // case (decision 7): a channel with no organization is legitimate, owned by
  // `bms_fleet`. `0048` role-scoped the WITH CHECK NULL branch `TO bms_fleet`
  // (every other role's write must now name a real organization); it did not
  // change the column's nullability.
  organizationId: uuid("organization_id").references(() => organizations.id),
  // NOT `.unique()`: 0048 dropped the old global-unique
  // `notification_channels_code_key` and replaced it with
  // `notification_channels_org_code_unique` — a composite
  // `(organization_id, code)` index (NULLS NOT DISTINCT) the migration owns
  // and this file does not mirror (see notificationDeliveries' comment below
  // for the convention).
  code: varchar("code", { length: 64 }).notNull(),
  name: varchar("name", { length: 128 }).notNull(),
  kind: varchar("kind", { length: 64 })
    .notNull()
    .references(() => notificationChannelKinds.code),
  // Never secret. The webhook HMAC secret is in the three columns below,
  // encrypted by `CredentialCryptoService` (ADR 0012) — `config` is returned by
  // the API and appears in logs, so nothing sensitive may live in it (§9.6).
  config: jsonb("config").notNull().default({}),
  secretCiphertext: bytea("secret_ciphertext"),
  secretIv: bytea("secret_iv"),
  // Nullable, unlike `rtuConnectionConfigs.keyVersion` which defaults to 1.
  // There every row has credentials; here an email channel has none, and a key
  // version on a row with no ciphertext would name a key that was never used.
  secretKeyVersion: integer("secret_key_version"),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Which channels a rule notifies. Configuration, so it cascades with the rule. */
export const ruleNotifications = bmsSchema.table(
  "rule_notifications",
  {
    ruleId: uuid("rule_id")
      .notNull()
      .references(() => automationRules.id, { onDelete: "cascade" }),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => notificationChannels.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.ruleId, table.channelId] })],
);

/**
 * One row per dispatch attempt, including every skip. History, not
 * configuration: nothing cascades into it. Four indexes, none mirrored
 * here, following `alarmSeverities` — the migrations own them:
 * `(channel_id, attempted_at DESC)` and `(attempted_at DESC)` from `0038`;
 * the partial `(channel_id, dedupe_key) WHERE dedupe_key IS NOT NULL`
 * (`notification_deliveries_channel_key_idx`) and the partial `(alarm_id)
 * WHERE alarm_id IS NOT NULL` (`notification_deliveries_alarm_idx`) from
 * `0066`, for `eventDeliveryBlocked` and `sentChannelIdsForAlarm` (`F3.10`,
 * 0038's own rule: the reader adds the index). `0065`'s
 * `(channel_id, dedupe_key) WHERE status = 'skipped_deduped'`, added for
 * `hasRecordedSkip` (`F3.46`), was dropped by `0066`: the channel-key index
 * has the same key columns and serves that read too.
 */
export const notificationDeliveries = bmsSchema.table("notification_deliveries", {
  id: uuid("id").primaryKey().defaultRandom(),
  // NOT NULL as of migration 0048 (ADR 0043 Amendment 5): unlike `users`,
  // `notification_channels` and `audit_log`, this table has no legitimate
  // PERMANENT NULL case — a dispatch always has a rule, and
  // `automationRules.organizationId` has been NOT NULL since 0047 — so the
  // WITH CHECK NULL branch was removed outright rather than narrowed
  // `TO bms_fleet`. `NotificationsService.record()` is the write path that
  // must supply it on every insert (a dispatch: its rule's org; a send test:
  // its channel's, refused with 400 for a global/NULL-org channel) — that
  // write-path change is E7.1c Task 8, tracked separately from this column
  // change (0048's own header explains why the two could land in either
  // order here, unlike `audit_log`'s writers, which had to move first).
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  ruleId: uuid("rule_id").references(() => automationRules.id),
  alarmId: uuid("alarm_id").references(() => alarms.id),
  channelId: uuid("channel_id")
    .notNull()
    .references(() => notificationChannels.id),
  // Closed set, enforced by `notification_deliveries_status_check`:
  // sent · failed · skipped_unconfigured · skipped_deduped · skipped_rate_limited ·
  // skipped_stale. `0038` created the constraint with the first five; `0068` widened it to
  // add the sixth (ADR 0041 Amendment 6 ruling 5 — a due escalation step abandoned for age).
  status: varchar("status", { length: 32 }).notNull(),
  dedupeKey: varchar("dedupe_key", { length: 255 }),
  attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull().defaultNow(),
  error: text("error"),
});

/**
 * F3.10 escalation profiles (ADR 0057 decision 7) — mirrors migration
 * `0066_alarm_lifecycle.sql`. The migration is the source of truth; this is
 * the typed view of it. Read that file for the policy legs (a parent leg on
 * `defaults.profile_id`, none on `step_channels.channel_id`) and the
 * foreign-key actions; constraint names below are the migration's, so a
 * service can translate a 23503/23505 by name.
 *
 * A profile is an ordered list of steps, attached by severity per
 * organization. Tenant-scoped with an own-column policy; unique per
 * organization and code (`alarm_escalation_profiles_org_code_key`).
 */
export const alarmEscalationProfiles = bmsSchema.table(
  "alarm_escalation_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    code: varchar("code", { length: 64 }).notNull(),
    name: varchar("name", { length: 128 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique("alarm_escalation_profiles_org_code_key").on(table.organizationId, table.code)],
);

/**
 * One step of a profile: after `afterMinutes` unacknowledged, notify the
 * step's channels once. Junction-shaped (no `organization_id`): its policy
 * reads through the profile, and it cascades with it — configuration follows
 * its parent, as `ruleNotifications` does.
 */
export const alarmEscalationSteps = bmsSchema.table(
  "alarm_escalation_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => alarmEscalationProfiles.id, { onDelete: "cascade" }),
    stepNo: integer("step_no").notNull(),
    afterMinutes: integer("after_minutes").notNull(),
  },
  (table) => [unique("alarm_escalation_steps_profile_step_key").on(table.profileId, table.stepNo)],
);

/**
 * Which channels a step notifies — the `ruleNotifications` join shape.
 * Cascades with the step; `channelId` is NO ACTION, so a channel a step still
 * names cannot be deleted (0038's reasoning). The channel's organization is
 * NOT in the policy: a fleet-wide NULL-org channel is a legitimate target,
 * and the service gates channel scope in code.
 */
export const alarmEscalationStepChannels = bmsSchema.table(
  "alarm_escalation_step_channels",
  {
    stepId: uuid("step_id")
      .notNull()
      .references(() => alarmEscalationSteps.id, { onDelete: "cascade" }),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => notificationChannels.id),
  },
  (table) => [primaryKey({ columns: [table.stepId, table.channelId] })],
);

/**
 * The per-organization severity map: which profile a severity escalates
 * through. `severity` references `alarm_severities.code`, so the database
 * validates it and `NotificationsModule` needs no `VocabulariesModule` import
 * (the edge stays acyclic). `profileId` is NO ACTION: a profile a severity
 * still maps to cannot be deleted. Own-column policy plus a parent leg on
 * `profileId` — a foreign key is checked with row security off.
 */
export const alarmEscalationDefaults = bmsSchema.table(
  "alarm_escalation_defaults",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    severity: varchar("severity", { length: 64 })
      .notNull()
      .references(() => alarmSeverities.code),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => alarmEscalationProfiles.id),
  },
  (table) => [primaryKey({ columns: [table.organizationId, table.severity] })],
);

/**
 * F4.359 / ADR 0131 decision 17 (migration `0152`) — a maintenance window: while
 * one covers an alarm, the alarm is written and listed but suppressed (no bar
 * count, popup, tone, notification or escalation). State is derived on the
 * database clock (plan D2): future, active (`starts_at <= now() < ends_at` and
 * `ended_at IS NULL`), past. `endedAt`/`endedBy` record an early end or a cancel.
 *
 * Tenant-scoped, strict `tenant_isolation` under FORCE. SQL-only, like this
 * file's other CHECKs and partial indexes: `maintenance_windows_reason_check`
 * (3..2000 characters after trim), `maintenance_windows_period_check` (`ends_at >
 * starts_at`; the 7-day bound is the service's), `maintenance_windows_ended_shape_check`
 * (`ended_at` and `ended_by` together) and `maintenance_windows_open_ends_at_idx`.
 *
 * **The two link keys are SQL-only on purpose.** `maintenance_windows_work_order_fkey`
 * and `maintenance_windows_maintenance_schedule_fkey` are composite on
 * `(organization_id, work_order_id)` / `(organization_id, maintenance_schedule_id)`
 * and point into `maintenance-schema.ts`, which imports this file. Mirroring them
 * would make the two modules import each other — the cycle this file's header
 * rules out.
 */
export const maintenanceWindows = bmsSchema.table("maintenance_windows", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  reason: text("reason").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  endedBy: uuid("ended_by").references(() => users.id),
  workOrderId: uuid("work_order_id"),
  maintenanceScheduleId: uuid("maintenance_schedule_id"),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => {
  return {
    // The target of the targets' and the alarms' composite window keys.
    idOrganizationKey: unique("maintenance_windows_id_organization_id_key").on(t.id, t.organizationId),
  };
});

/**
 * What a window covers: exactly one of an asset, a location (with its subtree) or
 * a rule per row (`maintenance_window_targets_one_target_check`, SQL-only, as are
 * the three partial unique indexes `maintenance_window_targets_{asset,location,rule}_uidx`).
 * Every key is composite on `organization_id` — the referential check runs with
 * row security off, so a single-column key would let a target name another
 * organization's row. The window key cascades (a target is part of its window);
 * the others are NO ACTION.
 */
export const maintenanceWindowTargets = bmsSchema.table("maintenance_window_targets", {
  id: uuid("id").primaryKey().defaultRandom(),
  windowId: uuid("window_id").notNull(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id),
  assetId: uuid("asset_id"),
  locationId: uuid("location_id"),
  ruleId: uuid("rule_id"),
}, (t) => {
  return {
    windowFk: foreignKey({
      name: "maintenance_window_targets_window_fkey",
      columns: [t.windowId, t.organizationId],
      foreignColumns: [maintenanceWindows.id, maintenanceWindows.organizationId],
    }).onDelete("cascade"),
    assetFk: foreignKey({
      name: "maintenance_window_targets_asset_fkey",
      columns: [t.assetId, t.organizationId],
      foreignColumns: [assets.id, assets.organizationId],
    }),
    locationFk: foreignKey({
      name: "maintenance_window_targets_location_fkey",
      columns: [t.locationId, t.organizationId],
      foreignColumns: [locations.id, locations.organizationId],
    }),
    ruleFk: foreignKey({
      name: "maintenance_window_targets_rule_fkey",
      columns: [t.ruleId, t.organizationId],
      foreignColumns: [automationRules.id, automationRules.organizationId],
    }),
  };
});
