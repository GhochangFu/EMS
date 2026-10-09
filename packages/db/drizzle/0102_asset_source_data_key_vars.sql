-- F2.29 / ADR 0039 Amendment 1 decision 1 — the asset stores its pattern variables.
--
-- `bms.assets.source_data_key_vars` holds the `{token}` variables an
-- instantiation request supplied (`sourceDataKeyVars`), without the reserved
-- `asset_code` key, which is `assets.code`. Written once, at instantiation; no
-- API path writes it again. Read by the template-version migration and by the
-- mapping sheet's pre-fill. Nullable with no default: NULL means the asset was
-- built before this migration or with no variables, and every existing row
-- stays valid. There is no backfill — the variables of an earlier asset exist
-- nowhere to recover.
--
-- NO POLICY OR PRIVILEGE CHANGE. The table's row level security (enabled and
-- forced in 0047) is table-level and already gates the new column; the pool
-- roles reach it through the existing table privileges. The column is never
-- mapped into an API response.
--
-- RE-RUNNABLE. The column is `ADD COLUMN IF NOT EXISTS`; the CHECK is guarded
-- by a `pg_constraint` probe (the `0098` idiom), because `ADD CONSTRAINT` has
-- no `IF NOT EXISTS`; `COMMENT ON` repeats harmlessly. The `SET ROLE` bracket
-- keeps the `0101` shape. Forward-only, no down migration (AGENTS.md §4.4).
SET ROLE bms_owner;

ALTER TABLE bms.assets ADD COLUMN IF NOT EXISTS source_data_key_vars jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'assets_source_data_key_vars_object_check'
      AND conrelid = 'bms.assets'::regclass
  ) THEN
    ALTER TABLE bms.assets
      ADD CONSTRAINT assets_source_data_key_vars_object_check
      CHECK (source_data_key_vars IS NULL OR jsonb_typeof(source_data_key_vars) = 'object');
  END IF;
END $$;

COMMENT ON COLUMN bms.assets.source_data_key_vars IS 'ADR 0039 Amendment 1: the {token} variables supplied at instantiation, without asset_code; write-once; NULL = built before F2.29 or with none';

RESET ROLE;
