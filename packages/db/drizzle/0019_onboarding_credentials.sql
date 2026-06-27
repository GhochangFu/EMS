-- Onboarding sessions and per-RTU encrypted connection credentials

CREATE TABLE IF NOT EXISTS bms.onboarding_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES bms.organizations(id),
  status varchar(32) NOT NULL DEFAULT 'draft',
  current_phase varchar(32) NOT NULL DEFAULT 'location',
  draft jsonb NOT NULL DEFAULT '{}'::jsonb,
  messages jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid REFERENCES bms.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  committed_at timestamptz,
  result jsonb
);

CREATE INDEX IF NOT EXISTS onboarding_sessions_org_status_idx
  ON bms.onboarding_sessions (organization_id, status);

CREATE TABLE IF NOT EXISTS bms.rtu_connection_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rtu_id uuid NOT NULL UNIQUE REFERENCES bms.rtus(id) ON DELETE CASCADE,
  protocol varchar(32) NOT NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  credentials_ciphertext bytea,
  credentials_iv bytea,
  key_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rtu_connection_configs_protocol_idx
  ON bms.rtu_connection_configs (protocol);
