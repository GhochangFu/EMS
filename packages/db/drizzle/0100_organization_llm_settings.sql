-- F3.21 / ADR 0090 Amendment 1 A3 — per-organization LLM settings.
--
-- `bms.organization_llm_settings` holds, for one organization, the LLM
-- provider and model of its onboarding agent and its own API key. The key is
-- encrypted with `CredentialCryptoService` (ADR 0012, rotation per ADR 0062)
-- into four columns: `key_ciphertext`, `key_iv`, `key_version`, and
-- `key_last4` (the only part a response ever shows). No row means the `.env`
-- platform default (A2); a row with `provider = 'off'` means the guided mode.
--
-- CONSTRAINTS. The primary key is the tenant column, so an organization has at
-- most one row, and `ON DELETE CASCADE` removes it with its organization.
--   - `organization_llm_settings_provider_check`: a CHECK and not a vocabulary
--     table, because every value needs an adapter in code (A3) — a row added
--     at run time could do nothing.
--   - `organization_llm_settings_model_check`: a model unless `off`.
--   - `organization_llm_settings_key_check`: the four key columns are all NULL
--     or all set, so a half-stored key cannot exist.
-- The drizzle mirror in `bms-schema.ts` does not repeat the CHECKs; this file
-- owns them and `tests/f3.21-organization-llm-settings-schema.test.ts` pins
-- each by name.
--
-- POLICY. `ENABLE` and `FORCE ROW LEVEL SECURITY`; the strict
-- `tenant_isolation` form with `USING` and `WITH CHECK`, no `IS NULL`
-- disjunct (the 0050 rule). No foreign-row leg: `bms.organizations` carries no
-- policy and the primary key is the tenant column itself. `updated_by`
-- references `bms.users`; Postgres runs foreign-key checks with row security
-- off, so that reference needs no leg either — it names an actor, not a tenant.
--
-- ROLE AND GRANTS. `pnpm db:migrate` connects as DATABASE_URL_SUPERUSER
-- (bms_app), so the table is created as bms_owner inside SET ROLE / RESET
-- ROLE. This file writes no GRANT and no REVOKE (plan ruling 7, the 0094
-- model): 0041's default privileges grant the pool roles. That includes
-- bms_fleet, which bypasses RLS and so can read the encrypted rows; it cannot
-- decrypt them without the credential key (ADR 0090 Amendment 1 A3, the
-- dated correction).

SET ROLE bms_owner;

CREATE TABLE IF NOT EXISTS bms.organization_llm_settings (
  organization_id uuid PRIMARY KEY REFERENCES bms.organizations(id) ON DELETE CASCADE,
  provider varchar(16) NOT NULL,
  model varchar(200),
  key_ciphertext bytea,
  key_iv bytea,
  key_version integer,
  key_last4 varchar(4),
  updated_by uuid REFERENCES bms.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_llm_settings_provider_check CHECK (provider IN ('off','openai','openrouter','anthropic')),
  CONSTRAINT organization_llm_settings_model_check CHECK (provider = 'off' OR model IS NOT NULL),
  CONSTRAINT organization_llm_settings_key_check CHECK (
    (key_ciphertext IS NULL) = (key_iv IS NULL) AND (key_ciphertext IS NULL) = (key_version IS NULL) AND (key_ciphertext IS NULL) = (key_last4 IS NULL))
);

ALTER TABLE bms.organization_llm_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms.organization_llm_settings FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON bms.organization_llm_settings;
CREATE POLICY tenant_isolation ON bms.organization_llm_settings
  USING (organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.current_organization', true), '')::uuid);

COMMENT ON TABLE bms.organization_llm_settings IS
  'One organization''s onboarding-agent LLM provider, model and encrypted API key; no row means the platform default (ADR 0090 Amendment 1 A3)';

RESET ROLE;
