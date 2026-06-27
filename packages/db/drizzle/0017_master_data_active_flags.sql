-- Phase 5 master data admin: active flags for soft deactivate
ALTER TABLE bms.organizations
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;

ALTER TABLE bms.rtus
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;

ALTER TABLE bms.assets
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
