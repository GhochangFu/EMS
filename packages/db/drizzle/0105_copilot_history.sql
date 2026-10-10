-- F3.85 PR 4 / ADR 0099 decisions 4 and 8 — the administrator copilot's
-- per-user tables.
--
--   - `bms.copilot_conversations`: one conversation of one user.
--     `organization_id` NULL is the global admin's cross-organization
--     conversation (decision 10); a scoped admin's binds the home organization.
--   - `bms.copilot_messages`: the turns of a conversation. `organization_ids`
--     records which organizations an assistant or action message's tools read
--     (the key-scope provenance); a user message has none.
--   - `bms.copilot_pending_changes`: a change the model proposed and the user
--     has not yet confirmed. The browser sends the real REST call with the
--     `X-Copilot-Change` header, and the global interceptor claims the row
--     atomically (`pending` -> `applying`) before the handler runs.
--     `organization_id` is NOT NULL: every release-1 target belongs to one
--     organization, so the interceptor's availability check can never be
--     skipped by a null. `conversation_id` is SET NULL, because applied and
--     failed rows outlive the 30-day erase of their conversation (drafter
--     choice 8).
--
-- CONSTRAINTS. A message and a pending change name their conversation by
-- `(conversation_id, user_id)` against the conversation's
-- `UNIQUE (id, user_id)`, so a row can only join a conversation of its own
-- user. A single-column key would not: foreign-key checks and their
-- referential actions run as the table owner with row security off, so one
-- user's row could point at another user's conversation and be erased with
-- it. The pending change's key is `ON DELETE SET NULL (conversation_id)`
-- (PostgreSQL 15+), which nulls only the conversation and keeps the NOT NULL
-- `user_id`. The three CHECKs are named.
--
-- POLICY (decision 8). Each row is its user's alone: `ENABLE` and `FORCE ROW
-- LEVEL SECURITY` with a strict `user_isolation` policy on the
-- `app.current_user` setting that `withUser` sets, `USING` and `WITH CHECK`,
-- no `IS NULL` disjunct. There is no `tenant_isolation` policy: an
-- organization admin does not read another user's conversations. The setting
-- is only read through `current_setting` — `current_user` is a reserved word,
-- so `SET LOCAL app.current_user` does not parse; `withUser` uses
-- `set_config`.
--
-- ROLE AND GRANTS. Created as bms_owner inside SET ROLE / RESET ROLE. No
-- GRANT: 0041's default privileges reach bms_tenant. bms_fleet reads across
-- organizations and must not read conversation text, so it loses every
-- privilege on the three tables (decision 8; the 0039 precedent). bms_owner
-- owns the tables and granted the defaults, so it can revoke them.
--
-- Forward-only. No seed rows.

SET ROLE bms_owner;

CREATE TABLE IF NOT EXISTS bms.copilot_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES bms.users(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES bms.organizations(id) ON DELETE CASCADE,
  title varchar(200),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_turn_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT copilot_conversations_id_user_key UNIQUE (id, user_id)
);

CREATE INDEX IF NOT EXISTS copilot_conversations_user_last_turn_idx
  ON bms.copilot_conversations (user_id, last_turn_at);

CREATE TABLE IF NOT EXISTS bms.copilot_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES bms.users(id) ON DELETE CASCADE,
  role varchar(16) NOT NULL,
  content text NOT NULL,
  organization_ids uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT copilot_messages_conversation_user_fkey FOREIGN KEY (conversation_id, user_id)
    REFERENCES bms.copilot_conversations (id, user_id) ON DELETE CASCADE,
  CONSTRAINT copilot_messages_role_check CHECK (role IN ('user','assistant','action'))
);

CREATE INDEX IF NOT EXISTS copilot_messages_conversation_created_idx
  ON bms.copilot_messages (conversation_id, created_at);

CREATE TABLE IF NOT EXISTS bms.copilot_pending_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES bms.users(id) ON DELETE CASCADE,
  conversation_id uuid,
  organization_id uuid NOT NULL REFERENCES bms.organizations(id) ON DELETE CASCADE,
  catalog_id varchar(64) NOT NULL,
  method varchar(8) NOT NULL,
  path varchar(512) NOT NULL,
  body jsonb NOT NULL,
  body_hash char(64) NOT NULL,
  summary text NOT NULL,
  risk varchar(16) NOT NULL,
  status varchar(16) NOT NULL,
  proposed_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  claimed_at timestamptz,
  finished_at timestamptz,
  result_status integer,
  resource_id varchar(128),
  CONSTRAINT copilot_pending_changes_conversation_user_fkey FOREIGN KEY (conversation_id, user_id)
    REFERENCES bms.copilot_conversations (id, user_id) ON DELETE SET NULL (conversation_id),
  CONSTRAINT copilot_pending_changes_risk_check CHECK (risk IN ('create','edit','deactivate','access')),
  CONSTRAINT copilot_pending_changes_status_check CHECK (status IN ('pending','applying','applied','failed','rejected'))
);

CREATE INDEX IF NOT EXISTS copilot_pending_changes_user_status_idx
  ON bms.copilot_pending_changes (user_id, status);
CREATE INDEX IF NOT EXISTS copilot_pending_changes_conversation_idx
  ON bms.copilot_pending_changes (conversation_id);

ALTER TABLE bms.copilot_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms.copilot_conversations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_isolation ON bms.copilot_conversations;
CREATE POLICY user_isolation ON bms.copilot_conversations
  USING (user_id = nullif(current_setting('app.current_user', true), '')::uuid)
  WITH CHECK (user_id = nullif(current_setting('app.current_user', true), '')::uuid);

ALTER TABLE bms.copilot_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms.copilot_messages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_isolation ON bms.copilot_messages;
CREATE POLICY user_isolation ON bms.copilot_messages
  USING (user_id = nullif(current_setting('app.current_user', true), '')::uuid)
  WITH CHECK (user_id = nullif(current_setting('app.current_user', true), '')::uuid);

ALTER TABLE bms.copilot_pending_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms.copilot_pending_changes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_isolation ON bms.copilot_pending_changes;
CREATE POLICY user_isolation ON bms.copilot_pending_changes
  USING (user_id = nullif(current_setting('app.current_user', true), '')::uuid)
  WITH CHECK (user_id = nullif(current_setting('app.current_user', true), '')::uuid);

REVOKE ALL ON bms.copilot_conversations, bms.copilot_messages, bms.copilot_pending_changes FROM bms_fleet;

COMMENT ON TABLE bms.copilot_conversations IS
  'One administrator-copilot conversation of one user; organization NULL is the global admin''s cross-organization view (ADR 0099 decisions 8, 10)';
COMMENT ON TABLE bms.copilot_messages IS
  'The turns of a copilot conversation, visible to their user only (ADR 0099 decision 8)';
COMMENT ON TABLE bms.copilot_pending_changes IS
  'A copilot-proposed API write awaiting Confirm; claimed atomically by the X-Copilot-Change interceptor (ADR 0099 decision 4)';

RESET ROLE;
