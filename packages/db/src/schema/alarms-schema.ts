import {
  boolean,
  doublePrecision,
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
  assets,
  bmsSchema,
  organizations,
  ruleCategories,
  users,
} from "./bms-schema";
import { bytea } from "./column-types";

/**
 * Detection and response: automation rules, the alarms they raise, and the
 * notifications those alarms send.
 *
 * **Why these ten tables are one module and not three.** They form a cycle that
 * cannot be cut by domain. `alarms.rule_id` references
 * `automation_rules.id` (ADR 0032), and `notification_deliveries.alarm_id`
 * references `alarms.id` — so rules depend on alarms and alarms depend on
 * rules. Drizzle's `() =>` callbacks are lazy, so splitting them would compile
 * and would run; it would also leave two modules importing each other, which is
 * a hazard the next person has to re-derive. One module states the cycle once.
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
  assetId: uuid("asset_id")
    .notNull()
    .references(() => assets.id),
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
  // ADR 0033 / F3.6, migration 0032. Nullable — a historical alarm raised
  // before this column existed, or by the pre-merge hardcoded ladder, cannot
  // always be attributed to a rule. `alarms_open_per_rule_uidx` (partial,
  // `WHERE acknowledged_at IS NULL AND rule_id IS NOT NULL`) is what makes the
  // alarm-raise dedupe a constraint instead of a SELECT-then-INSERT race.
  ruleId: uuid("rule_id").references(() => automationRules.id),
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
 * rather than new columns on it, so F3.10's pending `cleared_at` addition and
 * this one never touch the same table in parallel.
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
 * configuration: nothing cascades into it. The two indexes the migration
 * creates — `(channel_id, attempted_at DESC)` and the partial one on
 * `dedupe_key` — are not mirrored here, following `alarmSeverities`; the
 * migration owns them.
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
  // sent · failed · skipped_unconfigured · skipped_deduped · skipped_rate_limited.
  status: varchar("status", { length: 32 }).notNull(),
  dedupeKey: varchar("dedupe_key", { length: 255 }),
  attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull().defaultNow(),
  error: text("error"),
});

