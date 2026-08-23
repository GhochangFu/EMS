-- ADR 0041 — notification channels, the rule join, and the delivery ledger.
--
-- F3.8 sends an email or a webhook when a rule raises an alarm. Four tables:
-- the channel-kind vocabulary, the channels themselves, the rule↔channel join,
-- and a ledger row for every dispatch attempt.
--
-- Three decisions in this file are worth the reader's time.
--
-- **The kind vocabulary is data, the delivery status is a CHECK.** That looks
-- inconsistent and it is deliberate (ADR 0041 decision 3, plan D3). The kind
-- set is open — `F3.9` adds `sms` as a row, with no migration — so it follows
-- ADR 0031 A1 and 0032's `alarm_severities`: a lookup table and a foreign key.
-- The status set is closed and owned by `NotificationService`; a status this
-- repository's code cannot produce is a bug, not an extension, so a CHECK is
-- the right shape. An open vocabulary behind a closed switch is F4.43, which
-- 0029 and 0030 both record; a closed set behind an open table is the opposite
-- error — it invites a row nothing can ever write.
--
-- **`config` holds nothing secret** (plan D2). The webhook HMAC secret lives in
-- `secret_ciphertext` / `secret_iv` / `secret_key_version`, encrypted by
-- `CredentialCryptoService` the way ADR 0012 already does for RTU credentials.
-- `config` is returned by the API and appears in logs; splitting the secret out
-- means neither path can leak a credential, rather than relying on every future
-- caller to remember to strip a jsonb key (AGENTS.md §9.6).
--
-- **No rule is ever hard-deleted, so `notification_deliveries.rule_id` is
-- NO ACTION.** Verified rather than assumed: `apps/api/src/rules/` has no
-- `@Delete` handler at all, and `rules.service.ts` archives instead
-- (`lifecycleStatus: "archived"`, `archivedAt: new Date()`). A ledger is a
-- record of what happened; CASCADE would erase the evidence with the rule, and
-- SET NULL would quietly detach it. `rule_notifications.rule_id` DOES cascade —
-- that row is configuration, not history, and it has no meaning without its
-- rule. `notification_deliveries.channel_id` is likewise NO ACTION, the same
-- reasoning `alarms_severity_fk` records in 0030: deleting a channel that
-- history still references must fail loudly.
--
-- Forward-only and idempotent, like every migration here: `CREATE TABLE IF NOT
-- EXISTS`, `INSERT … ON CONFLICT DO NOTHING`, and every `ADD CONSTRAINT` behind
-- a `pg_constraint` guard. drizzle wraps the run in one transaction, so a
-- mis-ordered statement aborts the whole file rather than half-applying it.
--
-- No statement-breakpoint markers, following 0030 — the closest analogue here
-- (a vocabulary table plus guarded foreign keys) and the file this one is
-- modelled on. 0032 uses them; both shapes are applied on main and both work
-- with `packages/db/src/migrate.ts`.
--
-- Do not write that marker's literal text anywhere in this file, not even
-- inside a comment. drizzle splits the file on the raw string before Postgres
-- ever sees it, so a comment that merely NAMES the marker cuts the migration in
-- half and the tail arrives as its own statement. The first draft of this
-- header did exactly that and failed with `syntax error at or near "`"` at
-- position 1 — the remainder of the sentence, parsed as SQL.
--
-- **This migration seeds only `notification_channel_kinds`, deliberately.**
-- `pnpm db:migrate` runs BEFORE `pnpm db:seed`, so a migration that joins
-- `bms.assets` or `bms.automation_rules` is a silent no-op on a fresh database
-- — the F3.6 defect, named again in ADR 0041's Consequences. The kind
-- vocabulary joins nothing, so it is safe by construction. A demo channel, if
-- one is ever wanted, belongs beside the other seeds in `packages/db/src/`,
-- keyed on `code`, and must survive a second run.

-- 1. The channel-kind vocabulary, as data (ADR 0041 decision 3).
--
--    `code` is the primary key rather than a surrogate uuid, for the reason ADR
--    0031 A1.2 records and 0030 repeats: a code reference survives a JSON round
--    trip and a uuid does not.
--
--    `active` is here so a kind can be retired without deleting a row that live
--    channels still reference. There is no `rank` and no `tone`: unlike
--    severity, a kind carries no urgency and no colour — it selects a transport
--    implementation, and a kind with no transport is refused in code, not by
--    the schema.
--
--    `ON CONFLICT DO NOTHING` carries no conflict target, deliberately. 0030's
--    comment explains why: with a named target, a row that collides on a
--    DIFFERENT unique constraint raises instead of being skipped, and aborts
--    the whole migration. The bare form covers every unique constraint.
CREATE TABLE IF NOT EXISTS bms.notification_channel_kinds (
  code varchar(64) PRIMARY KEY,
  label varchar(128) NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO bms.notification_channel_kinds (code, label) VALUES
  ('email',   'Email'),
  ('webhook', 'Webhook')
ON CONFLICT DO NOTHING;

-- 2. Channels — one configured destination each.
--
--    `code` is UNIQUE and is what a seed or an operator keys on; `id` is what
--    the join and the ledger reference, so renaming a channel's code never
--    rewrites history.
--
--    The three secret columns are nullable together, and `secret_key_version`
--    is nullable rather than `NOT NULL DEFAULT 1`. That diverges from
--    `rtu_connection_configs.key_version` (0019), which does default to 1, and
--    the divergence is the point: there, every row has credentials. Here an
--    email channel has no secret at all, and a key version on a row with no
--    ciphertext would be a claim about a key that was never used. Null means
--    "no secret"; the three columns are read together or not at all.
CREATE TABLE IF NOT EXISTS bms.notification_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(64) NOT NULL UNIQUE,
  name varchar(128) NOT NULL,
  kind varchar(64) NOT NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  secret_ciphertext bytea,
  secret_iv bytea,
  secret_key_version integer,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 3. The join. A rule notifies zero or more channels; a channel serves zero or
--    more rules. The composite primary key is the whole row's identity — the
--    same pair twice is the same instruction, not a second one.
CREATE TABLE IF NOT EXISTS bms.rule_notifications (
  rule_id uuid NOT NULL,
  channel_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (rule_id, channel_id)
);

-- 4. The delivery ledger. Every attempt, INCLUDING every skip (ADR 0041
--    decision 4). A channel that sent nothing because it is unconfigured, or
--    deduped, or over its hourly ceiling, leaves a row saying so — otherwise
--    "no notification arrived" and "no notification was attempted" look
--    identical to an operator, which is the question this table exists to
--    answer.
--
--    `rule_id` and `alarm_id` are both nullable: a "send test" delivery has
--    neither, and a `skipped_unconfigured` row can be written before any alarm
--    exists. `channel_id` is NOT NULL — an attempt with no destination is not
--    an attempt.
--
--    `dedupe_key` is what decision 7's transition dedupe reads back. It is
--    nullable because a skip that never reached the dedupe check has none.
CREATE TABLE IF NOT EXISTS bms.notification_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id uuid,
  alarm_id uuid,
  channel_id uuid NOT NULL,
  status varchar(32) NOT NULL,
  dedupe_key varchar(255),
  attempted_at timestamptz NOT NULL DEFAULT now(),
  error text,
  CONSTRAINT notification_deliveries_status_check
    CHECK (status IN ('sent','failed','skipped_unconfigured',
                      'skipped_deduped','skipped_rate_limited'))
);

-- 5. The two reads this table serves.
--
--    The rate-limit check (decision 7) asks "how many deliveries on this
--    channel since now() - 1 hour", so it wants (channel_id, attempted_at
--    DESC). The dedupe check asks for one key, and only rows that have one —
--    hence the partial index, which stays small because most rows are sends.
CREATE INDEX IF NOT EXISTS notification_deliveries_channel_time_idx
  ON bms.notification_deliveries (channel_id, attempted_at DESC);

CREATE INDEX IF NOT EXISTS notification_deliveries_dedupe_idx
  ON bms.notification_deliveries (dedupe_key)
  WHERE dedupe_key IS NOT NULL;

-- 6. Foreign keys, each behind its own guard so the file re-runs clean.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'notification_channels_kind_fk'
      AND conrelid = 'bms.notification_channels'::regclass
  ) THEN
    ALTER TABLE bms.notification_channels
      ADD CONSTRAINT notification_channels_kind_fk
      FOREIGN KEY (kind) REFERENCES bms.notification_channel_kinds(code);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'rule_notifications_rule_id_fk'
      AND conrelid = 'bms.rule_notifications'::regclass
  ) THEN
    ALTER TABLE bms.rule_notifications
      ADD CONSTRAINT rule_notifications_rule_id_fk
      FOREIGN KEY (rule_id) REFERENCES bms.automation_rules(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'rule_notifications_channel_id_fk'
      AND conrelid = 'bms.rule_notifications'::regclass
  ) THEN
    ALTER TABLE bms.rule_notifications
      ADD CONSTRAINT rule_notifications_channel_id_fk
      FOREIGN KEY (channel_id) REFERENCES bms.notification_channels(id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'notification_deliveries_channel_id_fk'
      AND conrelid = 'bms.notification_deliveries'::regclass
  ) THEN
    ALTER TABLE bms.notification_deliveries
      ADD CONSTRAINT notification_deliveries_channel_id_fk
      FOREIGN KEY (channel_id) REFERENCES bms.notification_channels(id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'notification_deliveries_rule_id_fk'
      AND conrelid = 'bms.notification_deliveries'::regclass
  ) THEN
    ALTER TABLE bms.notification_deliveries
      ADD CONSTRAINT notification_deliveries_rule_id_fk
      FOREIGN KEY (rule_id) REFERENCES bms.automation_rules(id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'notification_deliveries_alarm_id_fk'
      AND conrelid = 'bms.notification_deliveries'::regclass
  ) THEN
    ALTER TABLE bms.notification_deliveries
      ADD CONSTRAINT notification_deliveries_alarm_id_fk
      FOREIGN KEY (alarm_id) REFERENCES bms.alarms(id);
  END IF;
END $$;
