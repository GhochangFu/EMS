-- F3.32f slice 3 / ADR 0086 decisions 1, 3 and 4 — organization symbol libraries, their
-- symbols, the per-organization switch for a global library, and a unit's reference to an
-- organization symbol.
--
-- Hand-written. Frozen once committed like every migration: a later change is a new file.
--
-- 1. THREE TENANT TABLES in the `bms.mimic_layouts` shape (0088), beside the global lookup tables
--    of 0090, because ADR 0043 Amendment 5 and ADR 0049 decision 3 reject a nullable
--    organization_id that means "global" (decision 1):
--    - `bms.mimic_org_symbol_libraries`: an organization's own library. `code` is a lower-case
--      letter and at most 26 more, so `org.<code>` fits the varchar(32) of
--      `mimic_layouts.symbol_libraries` (decision 2). UNIQUE (organization_id, code), and
--      UNIQUE (organization_id, id) as the target of the symbols' composite foreign key.
--    - `bms.mimic_org_symbols`: one uploaded symbol, stored as geometry only — `view_box` (four
--      numbers, positive width and height) and `shapes` (a jsonb array of at most 200
--      `[tag, attrs]` pairs), never the raw file (decision 6). `key` is `org.<code>:<name>`,
--      at most 64 characters, UNIQUE (organization_id, key). The composite foreign key
--      (organization_id, library_id) -> the library's (organization_id, id) keeps a symbol in
--      its own organization's library. `group_code` lists `MIMIC_SYMBOL_GROUP_CODES` in order.
--    - `bms.mimic_library_settings`: the switch (decision 4). One row per (organization, global
--      library); no row means enabled, so every organization keeps the libraries it has today.
--      `mimic_library_settings_core_check` refuses a disabled `core`.
--    The code and key CHECKs restate `MIMIC_ORG_LIBRARY_CODE` and `MIMIC_ORG_SYMBOL_KEY`
--    (`packages/shared/src/contracts/mimic-symbol-libraries.ts`).
--
-- 2. ROW SECURITY. ENABLE and FORCE on all three, and the strict `tenant_isolation` policy of
--    0088 in USING and WITH CHECK — the row's organization_id equals the GUC, no NULL disjunct.
--    The symbols' policy adds the 0088 node->layout leg: its library must belong to the same
--    organization. No GRANT and no REVOKE: 0041's default privileges give `bms_tenant` every
--    verb on a table `bms_owner` creates, and tenant writes are the point (an administrator
--    uploads through the tenant pool).
--
-- 3. A UNIT REFERENCES EXACTLY ONE SYMBOL TABLE (decision 3). `mimic_layout_nodes` gains
--    `org_symbol_key varchar(64)` and the composite foreign key
--    (organization_id, org_symbol_key) -> `bms.mimic_org_symbols` (organization_id, key), no
--    ON DELETE: a symbol in use cannot be removed, only retired. A foreign key check does not
--    apply row security, so the organization is in the key — that, not the policy, stops a
--    unit naming another organization's symbol. `mimic_layout_nodes_kind_fields_check` is
--    replaced (same name) so a unit carries `symbol` or `org_symbol_key`, never both and never
--    neither; a panel or a label carries neither. Every ADD follows a DROP IF EXISTS of the same
--    name, so a replay re-adds it (AGENTS.md §4.4).
--
-- WHO RUNS WHAT. The CREATEs, the row security and the policies run inside `SET ROLE bms_owner`,
-- so the three tables are owned by `bms_owner` and 0041's default privileges reach every pool
-- role. The ALTERs on `bms.mimic_layout_nodes`, a FORCE-RLS table, run after `RESET ROLE`, as the
-- migrator's superuser: under `SET ROLE bms_owner` with no `app.current_organization` a
-- validation scan could see zero rows and pass without checking one (0057/0085/0090's headers).
-- The new column is all NULL, so the new foreign key and CHECK validate every existing row as
-- before. The ALTERs change no owner. Nothing is seeded. The `DO $$` block asserts every effect,
-- per the 0059/0060/0085/0090 idiom, so a silent IF NOT EXISTS no-op cannot pass as success.

SET ROLE bms_owner;

CREATE TABLE IF NOT EXISTS bms.mimic_org_symbol_libraries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES bms.organizations(id),
  code varchar(32) NOT NULL,
  label varchar(64) NOT NULL,
  style varchar(8) NOT NULL,
  licence varchar(64) NOT NULL,
  attribution text NOT NULL DEFAULT '',
  source_url varchar(255),
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES bms.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mimic_org_symbol_libraries_code_check CHECK (code ~ '^[a-z][a-z0-9]{0,26}$'),
  CONSTRAINT mimic_org_symbol_libraries_style_check CHECK (style IN ('stroke', 'fill')),
  CONSTRAINT mimic_org_symbol_libraries_organization_code_key UNIQUE (organization_id, code),
  CONSTRAINT mimic_org_symbol_libraries_organization_id_key UNIQUE (organization_id, id)
);

CREATE TABLE IF NOT EXISTS bms.mimic_org_symbols (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES bms.organizations(id),
  library_id uuid NOT NULL,
  key varchar(64) NOT NULL,
  label varchar(64) NOT NULL,
  group_code varchar(16) NOT NULL,
  view_box double precision[] NOT NULL,
  shapes jsonb NOT NULL,
  source_filename varchar(255) NOT NULL,
  sha256 char(64) NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES bms.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mimic_org_symbols_key_check CHECK (key ~ '^org\.[a-z][a-z0-9]{0,26}:[a-z0-9][a-z0-9-]*$'),
  CONSTRAINT mimic_org_symbols_group_code_check CHECK (
    group_code IN ('water', 'electrical', 'it_ups', 'hvac', 'mechanical', 'environment', 'facility', 'general')
  ),
  CONSTRAINT mimic_org_symbols_view_box_check CHECK (cardinality(view_box) = 4 AND view_box[3] > 0 AND view_box[4] > 0),
  CONSTRAINT mimic_org_symbols_shapes_check CHECK (jsonb_typeof(shapes) = 'array' AND jsonb_array_length(shapes) <= 200),
  CONSTRAINT mimic_org_symbols_sha256_check CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT mimic_org_symbols_organization_key_key UNIQUE (organization_id, key),
  CONSTRAINT mimic_org_symbols_library_fkey FOREIGN KEY (organization_id, library_id)
    REFERENCES bms.mimic_org_symbol_libraries (organization_id, id)
);

CREATE INDEX IF NOT EXISTS mimic_org_symbols_library_idx ON bms.mimic_org_symbols (library_id, group_code, key);

CREATE TABLE IF NOT EXISTS bms.mimic_library_settings (
  organization_id uuid NOT NULL REFERENCES bms.organizations(id),
  library_code varchar(32) NOT NULL REFERENCES bms.mimic_symbol_libraries(code),
  enabled boolean NOT NULL DEFAULT true,
  updated_by uuid REFERENCES bms.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mimic_library_settings_pkey PRIMARY KEY (organization_id, library_code),
  CONSTRAINT mimic_library_settings_core_check CHECK (library_code <> 'core' OR enabled)
);

ALTER TABLE bms.mimic_org_symbol_libraries ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms.mimic_org_symbol_libraries FORCE ROW LEVEL SECURITY;
ALTER TABLE bms.mimic_org_symbols ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms.mimic_org_symbols FORCE ROW LEVEL SECURITY;
ALTER TABLE bms.mimic_library_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms.mimic_library_settings FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON bms.mimic_org_symbol_libraries;
CREATE POLICY tenant_isolation ON bms.mimic_org_symbol_libraries
  USING (
    organization_id = nullif(current_setting('app.current_organization', true), '')::uuid
  )
  WITH CHECK (
    organization_id = nullif(current_setting('app.current_organization', true), '')::uuid
  );

DROP POLICY IF EXISTS tenant_isolation ON bms.mimic_org_symbols;
CREATE POLICY tenant_isolation ON bms.mimic_org_symbols
  USING (
    organization_id = nullif(current_setting('app.current_organization', true), '')::uuid
    AND EXISTS (SELECT 1 FROM bms.mimic_org_symbol_libraries l
             WHERE l.id = mimic_org_symbols.library_id
               AND l.organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
  )
  WITH CHECK (
    organization_id = nullif(current_setting('app.current_organization', true), '')::uuid
    AND EXISTS (SELECT 1 FROM bms.mimic_org_symbol_libraries l
             WHERE l.id = mimic_org_symbols.library_id
               AND l.organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
  );

DROP POLICY IF EXISTS tenant_isolation ON bms.mimic_library_settings;
CREATE POLICY tenant_isolation ON bms.mimic_library_settings
  USING (
    organization_id = nullif(current_setting('app.current_organization', true), '')::uuid
  )
  WITH CHECK (
    organization_id = nullif(current_setting('app.current_organization', true), '')::uuid
  );

COMMENT ON TABLE bms.mimic_org_symbol_libraries IS 'An organization''s own mimic symbol library (ADR 0086 decision 1).';
COMMENT ON TABLE bms.mimic_org_symbols IS 'An uploaded mimic symbol, geometry only (ADR 0086 decisions 1 and 6).';
COMMENT ON TABLE bms.mimic_library_settings IS 'The per-organization switch for a global symbol library; no row is enabled (ADR 0086 decision 4).';

RESET ROLE;

ALTER TABLE bms.mimic_layout_nodes ADD COLUMN IF NOT EXISTS org_symbol_key varchar(64);

ALTER TABLE bms.mimic_layout_nodes DROP CONSTRAINT IF EXISTS mimic_layout_nodes_org_symbol_fkey;

ALTER TABLE bms.mimic_layout_nodes
  ADD CONSTRAINT mimic_layout_nodes_org_symbol_fkey FOREIGN KEY (organization_id, org_symbol_key)
    REFERENCES bms.mimic_org_symbols (organization_id, key);

ALTER TABLE bms.mimic_layout_nodes DROP CONSTRAINT IF EXISTS mimic_layout_nodes_kind_fields_check;

ALTER TABLE bms.mimic_layout_nodes
  ADD CONSTRAINT mimic_layout_nodes_kind_fields_check CHECK (
    (kind = 'unit'
      AND ((symbol IS NOT NULL AND org_symbol_key IS NULL) OR (symbol IS NULL AND org_symbol_key IS NOT NULL))
      AND tone IS NULL)
    OR (kind = 'panel' AND symbol IS NULL AND org_symbol_key IS NULL AND role_code IS NULL AND tone IS NOT NULL)
    OR (kind = 'label' AND symbol IS NULL AND org_symbol_key IS NULL AND role_code IS NULL AND tone IS NULL)
  );

CREATE INDEX IF NOT EXISTS mimic_layout_nodes_org_symbol_idx
  ON bms.mimic_layout_nodes (organization_id, org_symbol_key)
  WHERE org_symbol_key IS NOT NULL;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['mimic_org_symbol_libraries', 'mimic_org_symbols', 'mimic_library_settings'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'bms' AND c.relname = t AND c.relrowsecurity AND c.relforcerowsecurity
    ) THEN
      RAISE EXCEPTION 'migration 0093: bms.% is missing, or its row security is not enabled and forced', t;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_policy p
       WHERE p.polrelid = format('bms.%I', t)::regclass
         AND p.polname = 'tenant_isolation'
         AND p.polqual IS NOT NULL
         AND p.polwithcheck IS NOT NULL
         AND pg_get_expr(p.polqual, p.polrelid) NOT LIKE '%IS NULL%'
         AND pg_get_expr(p.polwithcheck, p.polrelid) NOT LIKE '%IS NULL%'
    ) THEN
      RAISE EXCEPTION 'migration 0093: bms.% has no strict tenant_isolation policy in USING and WITH CHECK', t;
    END IF;
    -- 0041's default privileges: a table created outside the bms_owner bracket would reach no
    -- pool role, and a tenant write would fail with 42501.
    IF NOT has_table_privilege('bms_tenant', format('bms.%I', t), 'INSERT')
       OR NOT has_table_privilege('bms_tenant', format('bms.%I', t), 'SELECT') THEN
      RAISE EXCEPTION 'migration 0093: bms_tenant cannot read and write bms.%', t;
    END IF;
  END LOOP;
  -- The symbols' policy carries the library leg.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy p
     WHERE p.polrelid = 'bms.mimic_org_symbols'::regclass
       AND p.polname = 'tenant_isolation'
       AND pg_get_expr(p.polqual, p.polrelid) LIKE '%mimic_org_symbol_libraries%'
       AND pg_get_expr(p.polwithcheck, p.polrelid) LIKE '%mimic_org_symbol_libraries%'
  ) THEN
    RAISE EXCEPTION 'migration 0093: the bms.mimic_org_symbols policy does not check its library';
  END IF;
  -- ADD COLUMN IF NOT EXISTS is silent when a column of that name already exists.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'bms' AND table_name = 'mimic_layout_nodes' AND column_name = 'org_symbol_key'
       AND data_type = 'character varying' AND character_maximum_length = 64
  ) THEN
    RAISE EXCEPTION 'migration 0093: bms.mimic_layout_nodes.org_symbol_key is not a varchar(64)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'bms.mimic_layout_nodes'::regclass
       AND conname = 'mimic_layout_nodes_org_symbol_fkey'
       AND contype = 'f'
       AND confrelid = 'bms.mimic_org_symbols'::regclass
       AND cardinality(conkey) = 2
  ) THEN
    RAISE EXCEPTION 'migration 0093: mimic_layout_nodes_org_symbol_fkey is not the two-column key to bms.mimic_org_symbols';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'bms.mimic_org_symbols'::regclass
       AND conname = 'mimic_org_symbols_library_fkey'
       AND contype = 'f'
       AND cardinality(conkey) = 2
  ) THEN
    RAISE EXCEPTION 'migration 0093: mimic_org_symbols_library_fkey is not the two-column key to its library';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'bms.mimic_layout_nodes'::regclass
       AND conname = 'mimic_layout_nodes_kind_fields_check'
       AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%org_symbol_key%'
  ) THEN
    RAISE EXCEPTION 'migration 0093: mimic_layout_nodes_kind_fields_check does not name org_symbol_key';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'bms.mimic_library_settings'::regclass
       AND conname = 'mimic_library_settings_core_check'
       AND contype = 'c'
  ) THEN
    RAISE EXCEPTION 'migration 0093: mimic_library_settings_core_check is missing';
  END IF;
END $$;
