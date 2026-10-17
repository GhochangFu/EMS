-- F4.267 / ADR 0090 Amendment 3 C1 — the organization's vision model: the
-- model a copilot turn that carries an image uses.
--
--   - `bms.organization_llm_settings.vision_model`: nullable varchar(200), on
--     the same provider and key as `model`. NULL means no vision model — an
--     image turn goes to the main model (`LlmResolver.resolveForOrganization`).
--     No DEFAULT: the existing rows read NULL, which is that behaviour.
--   - CHECK `organization_llm_settings_vision_model_check`: an `off` row carries
--     no vision model, the same rule `organization_llm_settings_model_check`
--     states for `model` the other way round. Dropped first so a re-run is safe.
--
-- POLICY. Unchanged: the column is on a table whose tenant policy (0100)
-- already covers every row. No new table, so FORCED_TABLES is unchanged.
--
-- ROLE AND GRANTS. Run as bms_owner inside SET ROLE / RESET ROLE: it owns the
-- table. No GRANT — a new column inherits the table's privileges.
--
-- Forward-only. No seed rows, no backfill.

SET ROLE bms_owner;

ALTER TABLE bms.organization_llm_settings ADD COLUMN IF NOT EXISTS vision_model varchar(200);

ALTER TABLE bms.organization_llm_settings DROP CONSTRAINT IF EXISTS organization_llm_settings_vision_model_check;

ALTER TABLE bms.organization_llm_settings ADD CONSTRAINT organization_llm_settings_vision_model_check CHECK (provider <> 'off' OR vision_model IS NULL);

COMMENT ON COLUMN bms.organization_llm_settings.vision_model IS
  'ADR 0090 Amendment 3 C1: the model a copilot turn that carries an image uses, on the same provider and key; NULL sends image turns to model; NULL on an off row';

RESET ROLE;
