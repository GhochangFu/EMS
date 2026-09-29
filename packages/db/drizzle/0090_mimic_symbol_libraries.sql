-- F3.32e / ADR 0084 decisions 1, 2, 3 and 8 — preloaded mimic symbol libraries.
--
-- GENERATED ONCE by scripts/mimic-symbols/generate.mjs --migration, then frozen like every
-- committed migration: a later curation change is a new migration, written by hand.
--
-- 1. TWO GLOBAL LOOKUP TABLES in the `bms.asset_roles` shape (0051): no organization_id and no
--    row security, because every organization reads the same libraries (ADR 0084 decision 1).
--    `bms.mimic_symbol_libraries` holds one row per library with its source, version, licence
--    and draw style; `bms.mimic_symbols` one row per symbol key with its label and palette
--    group. A core key is bare; every other key is `<library>:<name>` (decision 2), and
--    `mimic_symbols_key_names_library_check` holds that with a regular expression, not a LIKE
--    (an `_` in a library code would be a wildcard); `mimic_symbol_libraries_code_check`
--    keeps a library code to lower-case letters and digits.
--
-- 2. THE ROWS are the 29 core symbols (ADR 0082, in `mimicCoreSymbolSchema`'s order) and the
--    curated keys of `scripts/mimic-symbols/curation/*.json`, in curation order.
--    `tests/f3.32e-mimic-symbol-libraries.test.ts` compares them with the shared and the web
--    generated modules, both ways. Bare ON CONFLICT DO NOTHING (no arbiter), for the
--    0030/0034/0051 reason.
--
-- 3. A FOREIGN KEY REPLACES THE SYMBOL CHECK (decision 3). The rows go in first, so the
--    existing core values validate. `0088` and `0089` are frozen, so this file drops
--    `mimic_layout_nodes_symbol_check` (IF EXISTS) and widens `symbol` to varchar(64). The
--    foreign key has no ON DELETE: a symbol in use cannot be removed, only made inactive. The
--    ADD follows a DROP IF EXISTS of the same name, so a replay re-adds it (AGENTS.md §4.4); a
--    failed ADD is a real fault and aborts the migration.
--
-- 4. A LAYOUT CHOOSES ITS LIBRARIES (decision 8): `mimic_layouts.symbol_libraries`, default
--    `{core}`, at least one member. An existing layout reads as `{core}` and draws as before.
--
-- 5. BMS_TENANT CANNOT WRITE THE LIBRARIES (owner ruling 2026-09-29, ADR 0084 decision 1 as
--    amended). `0041`'s default privileges grant every verb to `bms_tenant`; the libraries are
--    fleet-wide master data, the line `0059` drew for `bms.point_keys` and `0085` for
--    `bms.location_types`. The REVOKE runs as the grantor (`bms_owner`): a superuser issuing
--    it removes nothing and reports success (`0059`'s header). `bms_fleet` keeps its verbs.
--
-- WHO RUNS WHAT. The CREATEs, the INSERTs and the REVOKE run inside `SET ROLE bms_owner`, so
-- `0041`'s default privileges apply to the new tables and the REVOKE has its grantor. The ALTERs
-- on the two FORCE-RLS tables run after `RESET ROLE`, as the migrator's superuser: under
-- `SET ROLE bms_owner` with no `app.current_organization` a validation scan could see zero
-- rows and pass without checking one (`0057`/`0085`'s headers). The ALTERs change no owner.
-- No policy. The `DO $$` block asserts the effect, per the 0059/0060/0085/0087 idiom, so a
-- silent IF-NOT-EXISTS or ON CONFLICT no-op cannot pass as success.

SET ROLE bms_owner;

CREATE TABLE IF NOT EXISTS bms.mimic_symbol_libraries (
  code varchar(32) PRIMARY KEY,
  label varchar(64) NOT NULL,
  source varchar(120) NOT NULL,
  version varchar(32) NOT NULL,
  licence varchar(64) NOT NULL,
  attribution_url varchar(255) NOT NULL,
  style varchar(8) NOT NULL,
  sort_order integer NOT NULL DEFAULT 100,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mimic_symbol_libraries_code_check CHECK (code ~ '^[a-z][a-z0-9]*$'),
  CONSTRAINT mimic_symbol_libraries_style_check CHECK (style IN ('stroke', 'fill'))
);

CREATE TABLE IF NOT EXISTS bms.mimic_symbols (
  key varchar(64) PRIMARY KEY,
  library_code varchar(32) NOT NULL REFERENCES bms.mimic_symbol_libraries(code),
  label varchar(64) NOT NULL,
  group_code varchar(16) NOT NULL,
  sort_order integer NOT NULL DEFAULT 100,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mimic_symbols_group_code_check CHECK (group_code IN ('water', 'electrical', 'it_ups', 'hvac', 'mechanical', 'environment', 'facility', 'general')),
  CONSTRAINT mimic_symbols_key_names_library_check CHECK (
    CASE WHEN library_code = 'core' THEN key ~ '^[a-z][a-z0-9-]*$'
         ELSE starts_with(key, library_code || ':') AND key ~ '^[a-z][a-z0-9]*:[a-z0-9][a-z0-9-]*$'
    END
  )
);

CREATE INDEX IF NOT EXISTS mimic_symbols_library_idx ON bms.mimic_symbols (library_code, group_code, sort_order);

INSERT INTO bms.mimic_symbol_libraries (code, label, source, version, licence, attribution_url, style, sort_order) VALUES
  ('core', 'Core', 'Built in', '1', 'Own drawings', '', 'stroke', 10),
  ('tabler', 'Tabler Icons', '@tabler/icons', '3.48.0', 'MIT', 'https://tabler.io/icons', 'stroke', 20),
  ('lucide', 'Lucide', 'lucide-static', '1.48.0', 'ISC', 'https://lucide.dev', 'stroke', 30),
  ('mdi', 'Material Design Icons', '@mdi/svg', '7.4.47', 'Apache 2.0', 'https://pictogrammers.com/library/mdi/', 'fill', 40)
ON CONFLICT DO NOTHING;

INSERT INTO bms.mimic_symbols (key, library_code, label, group_code, sort_order) VALUES
  ('tank', 'core', 'Tank', 'water', 10),
  ('clarifier', 'core', 'Clarifier', 'water', 20),
  ('membrane', 'core', 'Membrane', 'water', 30),
  ('vessel', 'core', 'Vessel', 'water', 40),
  ('tower', 'core', 'Tower', 'hvac', 50),
  ('aeration', 'core', 'Aeration', 'water', 60),
  ('dosing', 'core', 'Dosing', 'water', 70),
  ('pump', 'core', 'Pump', 'general', 80),
  ('discharge', 'core', 'Discharge', 'water', 90),
  ('valve', 'core', 'Valve', 'general', 100),
  ('filter', 'core', 'Filter', 'water', 110),
  ('unit', 'core', 'Unit', 'general', 120),
  ('transformer', 'core', 'Transformer', 'electrical', 130),
  ('breaker', 'core', 'Breaker', 'electrical', 140),
  ('switchboard', 'core', 'Switchboard', 'electrical', 150),
  ('generator', 'core', 'Generator', 'electrical', 160),
  ('meter', 'core', 'Meter', 'electrical', 170),
  ('motor', 'core', 'Motor', 'electrical', 180),
  ('ups', 'core', 'UPS', 'it_ups', 190),
  ('battery', 'core', 'Battery', 'it_ups', 200),
  ('rack', 'core', 'Rack', 'it_ups', 210),
  ('chiller', 'core', 'Chiller', 'hvac', 220),
  ('ahu', 'core', 'AHU', 'hvac', 230),
  ('fan', 'core', 'Fan', 'hvac', 240),
  ('compressor', 'core', 'Compressor', 'mechanical', 250),
  ('boiler', 'core', 'Boiler', 'mechanical', 260),
  ('sensor', 'core', 'Sensor', 'environment', 270),
  ('lamp', 'core', 'Lamp', 'facility', 280),
  ('lift', 'core', 'Lift', 'facility', 290),
  ('tabler:droplet', 'tabler', 'Droplet', 'water', 10),
  ('tabler:droplet-half', 'tabler', 'Droplet half', 'water', 20),
  ('tabler:droplets', 'tabler', 'Droplets', 'water', 30),
  ('tabler:bucket', 'tabler', 'Bucket', 'water', 40),
  ('tabler:bucket-droplet', 'tabler', 'Bucket droplet', 'water', 50),
  ('tabler:barrel', 'tabler', 'Barrel', 'water', 60),
  ('tabler:ripple', 'tabler', 'Ripple', 'water', 70),
  ('tabler:wave-sine', 'tabler', 'Wave sine', 'water', 80),
  ('tabler:filter', 'tabler', 'Filter', 'water', 90),
  ('tabler:test-pipe', 'tabler', 'Test pipe', 'water', 100),
  ('tabler:flask', 'tabler', 'Flask', 'water', 110),
  ('tabler:pool', 'tabler', 'Pool', 'water', 120),
  ('tabler:bath', 'tabler', 'Bath', 'water', 130),
  ('tabler:wash-machine', 'tabler', 'Wash machine', 'water', 140),
  ('tabler:fountain', 'tabler', 'Fountain', 'water', 150),
  ('tabler:container', 'tabler', 'Container', 'water', 160),
  ('tabler:bolt', 'tabler', 'Bolt', 'electrical', 170),
  ('tabler:plug', 'tabler', 'Plug', 'electrical', 180),
  ('tabler:plug-connected', 'tabler', 'Plug connected', 'electrical', 190),
  ('tabler:power', 'tabler', 'Power', 'electrical', 200),
  ('tabler:charging-pile', 'tabler', 'Charging pile', 'electrical', 210),
  ('tabler:circuit-switch-open', 'tabler', 'Circuit switch open', 'electrical', 220),
  ('tabler:circuit-switch-closed', 'tabler', 'Circuit switch closed', 'electrical', 230),
  ('tabler:circuit-battery', 'tabler', 'Circuit battery', 'electrical', 240),
  ('tabler:circuit-capacitor', 'tabler', 'Circuit capacitor', 'electrical', 250),
  ('tabler:circuit-resistor', 'tabler', 'Circuit resistor', 'electrical', 260),
  ('tabler:circuit-ground', 'tabler', 'Circuit ground', 'electrical', 270),
  ('tabler:circuit-motor', 'tabler', 'Circuit motor', 'electrical', 280),
  ('tabler:circuit-bulb', 'tabler', 'Circuit bulb', 'electrical', 290),
  ('tabler:circuit-cell', 'tabler', 'Circuit cell', 'electrical', 300),
  ('tabler:circuit-diode', 'tabler', 'Circuit diode', 'electrical', 310),
  ('tabler:circuit-inductor', 'tabler', 'Circuit inductor', 'electrical', 320),
  ('tabler:circuit-voltmeter', 'tabler', 'Circuit voltmeter', 'electrical', 330),
  ('tabler:circuit-ammeter', 'tabler', 'Circuit ammeter', 'electrical', 340),
  ('tabler:circuit-pushbutton', 'tabler', 'Circuit pushbutton', 'electrical', 350),
  ('tabler:solar-panel', 'tabler', 'Solar panel', 'electrical', 360),
  ('tabler:building-wind-turbine', 'tabler', 'Building wind turbine', 'electrical', 370),
  ('tabler:windmill', 'tabler', 'Windmill', 'electrical', 380),
  ('tabler:server', 'tabler', 'Server', 'it_ups', 390),
  ('tabler:server-2', 'tabler', 'Server 2', 'it_ups', 400),
  ('tabler:database', 'tabler', 'Database', 'it_ups', 410),
  ('tabler:cpu', 'tabler', 'CPU', 'it_ups', 420),
  ('tabler:router', 'tabler', 'Router', 'it_ups', 430),
  ('tabler:antenna', 'tabler', 'Antenna', 'it_ups', 440),
  ('tabler:wifi', 'tabler', 'Wifi', 'it_ups', 450),
  ('tabler:network', 'tabler', 'Network', 'it_ups', 460),
  ('tabler:device-desktop', 'tabler', 'Device desktop', 'it_ups', 470),
  ('tabler:battery', 'tabler', 'Battery', 'it_ups', 480),
  ('tabler:battery-charging', 'tabler', 'Battery charging', 'it_ups', 490),
  ('tabler:battery-1', 'tabler', 'Battery 1', 'it_ups', 500),
  ('tabler:battery-2', 'tabler', 'Battery 2', 'it_ups', 510),
  ('tabler:battery-3', 'tabler', 'Battery 3', 'it_ups', 520),
  ('tabler:battery-4', 'tabler', 'Battery 4', 'it_ups', 530),
  ('tabler:air-conditioning', 'tabler', 'Air conditioning', 'hvac', 540),
  ('tabler:propeller', 'tabler', 'Propeller', 'hvac', 550),
  ('tabler:wind', 'tabler', 'Wind', 'hvac', 560),
  ('tabler:snowflake', 'tabler', 'Snowflake', 'hvac', 570),
  ('tabler:temperature', 'tabler', 'Temperature', 'hvac', 580),
  ('tabler:flame', 'tabler', 'Flame', 'hvac', 590),
  ('tabler:mist', 'tabler', 'Mist', 'hvac', 600),
  ('tabler:haze', 'tabler', 'Haze', 'hvac', 610),
  ('tabler:thermometer', 'tabler', 'Thermometer', 'hvac', 620),
  ('tabler:engine', 'tabler', 'Engine', 'mechanical', 630),
  ('tabler:settings', 'tabler', 'Settings', 'mechanical', 640),
  ('tabler:tool', 'tabler', 'Tool', 'mechanical', 650),
  ('tabler:tools', 'tabler', 'Tools', 'mechanical', 660),
  ('tabler:hammer', 'tabler', 'Hammer', 'mechanical', 670),
  ('tabler:ruler', 'tabler', 'Ruler', 'mechanical', 680),
  ('tabler:gauge', 'tabler', 'Gauge', 'mechanical', 690),
  ('tabler:automatic-gearbox', 'tabler', 'Automatic gearbox', 'mechanical', 700),
  ('tabler:building-factory', 'tabler', 'Building factory', 'mechanical', 710),
  ('tabler:building-factory-2', 'tabler', 'Building factory 2', 'mechanical', 720),
  ('tabler:building-warehouse', 'tabler', 'Building warehouse', 'mechanical', 730),
  ('tabler:forklift', 'tabler', 'Forklift', 'mechanical', 740),
  ('tabler:crane', 'tabler', 'Crane', 'mechanical', 750),
  ('tabler:truck', 'tabler', 'Truck', 'mechanical', 760),
  ('tabler:box', 'tabler', 'Box', 'mechanical', 770),
  ('tabler:package', 'tabler', 'Package', 'mechanical', 780),
  ('tabler:leaf', 'tabler', 'Leaf', 'environment', 790),
  ('tabler:plant', 'tabler', 'Plant', 'environment', 800),
  ('tabler:tree', 'tabler', 'Tree', 'environment', 810),
  ('tabler:cloud', 'tabler', 'Cloud', 'environment', 820),
  ('tabler:cloud-rain', 'tabler', 'Cloud rain', 'environment', 830),
  ('tabler:cloud-fog', 'tabler', 'Cloud fog', 'environment', 840),
  ('tabler:sun-high', 'tabler', 'Sun high', 'environment', 850),
  ('tabler:radioactive', 'tabler', 'Radioactive', 'environment', 860),
  ('tabler:biohazard', 'tabler', 'Biohazard', 'environment', 870),
  ('tabler:recycle', 'tabler', 'Recycle', 'environment', 880),
  ('tabler:trash', 'tabler', 'Trash', 'environment', 890),
  ('tabler:building', 'tabler', 'Building', 'facility', 900),
  ('tabler:buildings', 'tabler', 'Buildings', 'facility', 910),
  ('tabler:elevator', 'tabler', 'Elevator', 'facility', 920),
  ('tabler:stairs', 'tabler', 'Stairs', 'facility', 930),
  ('tabler:door', 'tabler', 'Door', 'facility', 940),
  ('tabler:lock', 'tabler', 'Lock', 'facility', 950),
  ('tabler:key', 'tabler', 'Key', 'facility', 960),
  ('tabler:shield', 'tabler', 'Shield', 'facility', 970),
  ('tabler:bell', 'tabler', 'Bell', 'facility', 980),
  ('tabler:alarm-smoke', 'tabler', 'Alarm smoke', 'facility', 990),
  ('tabler:fire-extinguisher', 'tabler', 'Fire extinguisher', 'facility', 1000),
  ('tabler:fire-hydrant', 'tabler', 'Fire hydrant', 'facility', 1010),
  ('tabler:first-aid-kit', 'tabler', 'First aid kit', 'facility', 1020),
  ('tabler:parking', 'tabler', 'Parking', 'facility', 1030),
  ('tabler:car', 'tabler', 'Car', 'facility', 1040),
  ('tabler:bulb', 'tabler', 'Bulb', 'facility', 1050),
  ('tabler:lamp', 'tabler', 'Lamp', 'facility', 1060),
  ('tabler:clock', 'tabler', 'Clock', 'facility', 1070),
  ('tabler:users', 'tabler', 'Users', 'facility', 1080),
  ('tabler:home', 'tabler', 'Home', 'facility', 1090),
  ('tabler:alert-triangle', 'tabler', 'Alert triangle', 'general', 1100),
  ('tabler:alert-circle', 'tabler', 'Alert circle', 'general', 1110),
  ('tabler:info-circle', 'tabler', 'Info circle', 'general', 1120),
  ('tabler:circle', 'tabler', 'Circle', 'general', 1130),
  ('tabler:square', 'tabler', 'Square', 'general', 1140),
  ('tabler:arrow-right', 'tabler', 'Arrow right', 'general', 1150),
  ('tabler:refresh', 'tabler', 'Refresh', 'general', 1160),
  ('tabler:activity', 'tabler', 'Activity', 'general', 1170),
  ('tabler:chart-line', 'tabler', 'Chart line', 'general', 1180),
  ('tabler:dashboard', 'tabler', 'Dashboard', 'general', 1190),
  ('tabler:toggle-left', 'tabler', 'Toggle left', 'general', 1200),
  ('tabler:flag', 'tabler', 'Flag', 'general', 1210),
  ('tabler:target', 'tabler', 'Target', 'general', 1220),
  ('tabler:map-pin', 'tabler', 'Map pin', 'general', 1230),
  ('lucide:droplet', 'lucide', 'Droplet', 'water', 10),
  ('lucide:droplets', 'lucide', 'Droplets', 'water', 20),
  ('lucide:bath', 'lucide', 'Bath', 'water', 30),
  ('lucide:shower-head', 'lucide', 'Shower head', 'water', 40),
  ('lucide:glass-water', 'lucide', 'Glass water', 'water', 50),
  ('lucide:cup-soda', 'lucide', 'Cup soda', 'water', 60),
  ('lucide:fuel', 'lucide', 'Fuel', 'water', 70),
  ('lucide:container', 'lucide', 'Container', 'water', 80),
  ('lucide:zap', 'lucide', 'Zap', 'electrical', 90),
  ('lucide:zap-off', 'lucide', 'Zap off', 'electrical', 100),
  ('lucide:plug', 'lucide', 'Plug', 'electrical', 110),
  ('lucide:plug-zap', 'lucide', 'Plug zap', 'electrical', 120),
  ('lucide:plug-2', 'lucide', 'Plug 2', 'electrical', 130),
  ('lucide:power', 'lucide', 'Power', 'electrical', 140),
  ('lucide:power-off', 'lucide', 'Power off', 'electrical', 150),
  ('lucide:unplug', 'lucide', 'Unplug', 'electrical', 160),
  ('lucide:cable', 'lucide', 'Cable', 'electrical', 170),
  ('lucide:solar-panel', 'lucide', 'Solar panel', 'electrical', 180),
  ('lucide:battery', 'lucide', 'Battery', 'it_ups', 190),
  ('lucide:battery-charging', 'lucide', 'Battery charging', 'it_ups', 200),
  ('lucide:battery-full', 'lucide', 'Battery full', 'it_ups', 210),
  ('lucide:battery-low', 'lucide', 'Battery low', 'it_ups', 220),
  ('lucide:battery-medium', 'lucide', 'Battery medium', 'it_ups', 230),
  ('lucide:battery-warning', 'lucide', 'Battery warning', 'it_ups', 240),
  ('lucide:server', 'lucide', 'Server', 'it_ups', 250),
  ('lucide:server-cog', 'lucide', 'Server cog', 'it_ups', 260),
  ('lucide:server-crash', 'lucide', 'Server crash', 'it_ups', 270),
  ('lucide:database', 'lucide', 'Database', 'it_ups', 280),
  ('lucide:hard-drive', 'lucide', 'Hard drive', 'it_ups', 290),
  ('lucide:cpu', 'lucide', 'CPU', 'it_ups', 300),
  ('lucide:router', 'lucide', 'Router', 'it_ups', 310),
  ('lucide:wifi', 'lucide', 'Wifi', 'it_ups', 320),
  ('lucide:network', 'lucide', 'Network', 'it_ups', 330),
  ('lucide:monitor', 'lucide', 'Monitor', 'it_ups', 340),
  ('lucide:pc-case', 'lucide', 'PC case', 'it_ups', 350),
  ('lucide:memory-stick', 'lucide', 'Memory stick', 'it_ups', 360),
  ('lucide:microchip', 'lucide', 'Microchip', 'it_ups', 370),
  ('lucide:snowflake', 'lucide', 'Snowflake', 'hvac', 380),
  ('lucide:thermometer', 'lucide', 'Thermometer', 'hvac', 390),
  ('lucide:thermometer-sun', 'lucide', 'Thermometer sun', 'hvac', 400),
  ('lucide:thermometer-snowflake', 'lucide', 'Thermometer snowflake', 'hvac', 410),
  ('lucide:fan', 'lucide', 'Fan', 'hvac', 420),
  ('lucide:air-vent', 'lucide', 'Air vent', 'hvac', 430),
  ('lucide:flame', 'lucide', 'Flame', 'hvac', 440),
  ('lucide:heater', 'lucide', 'Heater', 'hvac', 450),
  ('lucide:wind', 'lucide', 'Wind', 'hvac', 460),
  ('lucide:wind-arrow-down', 'lucide', 'Wind arrow down', 'hvac', 470),
  ('lucide:gauge', 'lucide', 'Gauge', 'mechanical', 480),
  ('lucide:cog', 'lucide', 'Cog', 'mechanical', 490),
  ('lucide:settings', 'lucide', 'Settings', 'mechanical', 500),
  ('lucide:wrench', 'lucide', 'Wrench', 'mechanical', 510),
  ('lucide:hammer', 'lucide', 'Hammer', 'mechanical', 520),
  ('lucide:drill', 'lucide', 'Drill', 'mechanical', 530),
  ('lucide:anvil', 'lucide', 'Anvil', 'mechanical', 540),
  ('lucide:pickaxe', 'lucide', 'Pickaxe', 'mechanical', 550),
  ('lucide:factory', 'lucide', 'Factory', 'mechanical', 560),
  ('lucide:warehouse', 'lucide', 'Warehouse', 'mechanical', 570),
  ('lucide:truck', 'lucide', 'Truck', 'mechanical', 580),
  ('lucide:forklift', 'lucide', 'Forklift', 'mechanical', 590),
  ('lucide:tractor', 'lucide', 'Tractor', 'mechanical', 600),
  ('lucide:construction', 'lucide', 'Construction', 'mechanical', 610),
  ('lucide:package', 'lucide', 'Package', 'mechanical', 620),
  ('lucide:boxes', 'lucide', 'Boxes', 'mechanical', 630),
  ('lucide:leaf', 'lucide', 'Leaf', 'environment', 640),
  ('lucide:sprout', 'lucide', 'Sprout', 'environment', 650),
  ('lucide:trees', 'lucide', 'Trees', 'environment', 660),
  ('lucide:tree-pine', 'lucide', 'Tree pine', 'environment', 670),
  ('lucide:tree-deciduous', 'lucide', 'Tree deciduous', 'environment', 680),
  ('lucide:cloud', 'lucide', 'Cloud', 'environment', 690),
  ('lucide:cloud-rain', 'lucide', 'Cloud rain', 'environment', 700),
  ('lucide:cloud-fog', 'lucide', 'Cloud fog', 'environment', 710),
  ('lucide:cloud-drizzle', 'lucide', 'Cloud drizzle', 'environment', 720),
  ('lucide:cloud-lightning', 'lucide', 'Cloud lightning', 'environment', 730),
  ('lucide:recycle', 'lucide', 'Recycle', 'environment', 740),
  ('lucide:trash', 'lucide', 'Trash', 'environment', 750),
  ('lucide:biohazard', 'lucide', 'Biohazard', 'environment', 760),
  ('lucide:radiation', 'lucide', 'Radiation', 'environment', 770),
  ('lucide:sun', 'lucide', 'Sun', 'environment', 780),
  ('lucide:sun-medium', 'lucide', 'Sun medium', 'environment', 790),
  ('lucide:building', 'lucide', 'Building', 'facility', 800),
  ('lucide:hospital', 'lucide', 'Hospital', 'facility', 810),
  ('lucide:school', 'lucide', 'School', 'facility', 820),
  ('lucide:store', 'lucide', 'Store', 'facility', 830),
  ('lucide:hotel', 'lucide', 'Hotel', 'facility', 840),
  ('lucide:house', 'lucide', 'House', 'facility', 850),
  ('lucide:door-open', 'lucide', 'Door open', 'facility', 860),
  ('lucide:door-closed', 'lucide', 'Door closed', 'facility', 870),
  ('lucide:lock', 'lucide', 'Lock', 'facility', 880),
  ('lucide:lock-open', 'lucide', 'Lock open', 'facility', 890),
  ('lucide:key', 'lucide', 'Key', 'facility', 900),
  ('lucide:shield', 'lucide', 'Shield', 'facility', 910),
  ('lucide:shield-alert', 'lucide', 'Shield alert', 'facility', 920),
  ('lucide:shield-check', 'lucide', 'Shield check', 'facility', 930),
  ('lucide:bell', 'lucide', 'Bell', 'facility', 940),
  ('lucide:bell-ring', 'lucide', 'Bell ring', 'facility', 950),
  ('lucide:siren', 'lucide', 'Siren', 'facility', 960),
  ('lucide:fire-extinguisher', 'lucide', 'Fire extinguisher', 'facility', 970),
  ('lucide:alarm-smoke', 'lucide', 'Alarm smoke', 'facility', 980),
  ('lucide:car', 'lucide', 'Car', 'facility', 990),
  ('lucide:bus', 'lucide', 'Bus', 'facility', 1000),
  ('lucide:lamp', 'lucide', 'Lamp', 'facility', 1010),
  ('lucide:lamp-desk', 'lucide', 'Lamp desk', 'facility', 1020),
  ('lucide:lamp-ceiling', 'lucide', 'Lamp ceiling', 'facility', 1030),
  ('lucide:lightbulb', 'lucide', 'Lightbulb', 'facility', 1040),
  ('lucide:lightbulb-off', 'lucide', 'Lightbulb off', 'facility', 1050),
  ('lucide:clock', 'lucide', 'Clock', 'facility', 1060),
  ('lucide:users', 'lucide', 'Users', 'facility', 1070),
  ('lucide:user', 'lucide', 'User', 'facility', 1080),
  ('lucide:circle', 'lucide', 'Circle', 'general', 1090),
  ('lucide:square', 'lucide', 'Square', 'general', 1100),
  ('lucide:triangle', 'lucide', 'Triangle', 'general', 1110),
  ('lucide:triangle-alert', 'lucide', 'Triangle alert', 'general', 1120),
  ('lucide:circle-alert', 'lucide', 'Circle alert', 'general', 1130),
  ('lucide:info', 'lucide', 'Info', 'general', 1140),
  ('lucide:octagon-alert', 'lucide', 'Octagon alert', 'general', 1150),
  ('lucide:activity', 'lucide', 'Activity', 'general', 1160),
  ('lucide:chart-line', 'lucide', 'Chart line', 'general', 1170),
  ('lucide:layout-dashboard', 'lucide', 'Layout dashboard', 'general', 1180),
  ('lucide:flag', 'lucide', 'Flag', 'general', 1190),
  ('lucide:target', 'lucide', 'Target', 'general', 1200),
  ('lucide:map-pin', 'lucide', 'Map pin', 'general', 1210),
  ('lucide:arrow-right', 'lucide', 'Arrow right', 'general', 1220),
  ('lucide:refresh-cw', 'lucide', 'Refresh cw', 'general', 1230),
  ('lucide:toggle-left', 'lucide', 'Toggle left', 'general', 1240),
  ('lucide:check', 'lucide', 'Check', 'general', 1250),
  ('lucide:x', 'lucide', 'X', 'general', 1260),
  ('mdi:valve', 'mdi', 'Valve', 'water', 10),
  ('mdi:valve-open', 'mdi', 'Valve open', 'water', 20),
  ('mdi:valve-closed', 'mdi', 'Valve closed', 'water', 30),
  ('mdi:pipe', 'mdi', 'Pipe', 'water', 40),
  ('mdi:pipe-valve', 'mdi', 'Pipe valve', 'water', 50),
  ('mdi:pipe-disconnected', 'mdi', 'Pipe disconnected', 'water', 60),
  ('mdi:pipe-leak', 'mdi', 'Pipe leak', 'water', 70),
  ('mdi:pump', 'mdi', 'Pump', 'water', 80),
  ('mdi:water-pump', 'mdi', 'Water pump', 'water', 90),
  ('mdi:storage-tank', 'mdi', 'Storage tank', 'water', 100),
  ('mdi:water', 'mdi', 'Water', 'water', 110),
  ('mdi:water-percent', 'mdi', 'Water percent', 'water', 120),
  ('mdi:water-thermometer', 'mdi', 'Water thermometer', 'water', 130),
  ('mdi:cup-water', 'mdi', 'Cup water', 'water', 140),
  ('mdi:bottle-tonic', 'mdi', 'Bottle tonic', 'water', 150),
  ('mdi:filter', 'mdi', 'Filter', 'water', 160),
  ('mdi:flask', 'mdi', 'Flask', 'water', 170),
  ('mdi:test-tube', 'mdi', 'Test tube', 'water', 180),
  ('mdi:beaker', 'mdi', 'Beaker', 'water', 190),
  ('mdi:waves', 'mdi', 'Waves', 'water', 200),
  ('mdi:transmission-tower', 'mdi', 'Transmission tower', 'electrical', 210),
  ('mdi:transmission-tower-export', 'mdi', 'Transmission tower export', 'electrical', 220),
  ('mdi:transmission-tower-import', 'mdi', 'Transmission tower import', 'electrical', 230),
  ('mdi:meter-electric', 'mdi', 'Meter electric', 'electrical', 240),
  ('mdi:meter-gas', 'mdi', 'Meter gas', 'electrical', 250),
  ('mdi:solar-panel', 'mdi', 'Solar panel', 'electrical', 260),
  ('mdi:solar-panel-large', 'mdi', 'Solar panel large', 'electrical', 270),
  ('mdi:solar-power', 'mdi', 'Solar power', 'electrical', 280),
  ('mdi:wind-turbine', 'mdi', 'Wind turbine', 'electrical', 290),
  ('mdi:wind-power', 'mdi', 'Wind power', 'electrical', 300),
  ('mdi:flash', 'mdi', 'Flash', 'electrical', 310),
  ('mdi:power-plug', 'mdi', 'Power plug', 'electrical', 320),
  ('mdi:power-socket', 'mdi', 'Power socket', 'electrical', 330),
  ('mdi:electric-switch', 'mdi', 'Electric switch', 'electrical', 340),
  ('mdi:electric-switch-closed', 'mdi', 'Electric switch closed', 'electrical', 350),
  ('mdi:current-ac', 'mdi', 'Current AC', 'electrical', 360),
  ('mdi:current-dc', 'mdi', 'Current DC', 'electrical', 370),
  ('mdi:fuse', 'mdi', 'Fuse', 'electrical', 380),
  ('mdi:fuse-blade', 'mdi', 'Fuse blade', 'electrical', 390),
  ('mdi:lightning-bolt', 'mdi', 'Lightning bolt', 'electrical', 400),
  ('mdi:ev-station', 'mdi', 'EV station', 'electrical', 410),
  ('mdi:battery', 'mdi', 'Battery', 'it_ups', 420),
  ('mdi:battery-charging', 'mdi', 'Battery charging', 'it_ups', 430),
  ('mdi:battery-50', 'mdi', 'Battery 50', 'it_ups', 440),
  ('mdi:car-battery', 'mdi', 'Car battery', 'it_ups', 450),
  ('mdi:server', 'mdi', 'Server', 'it_ups', 460),
  ('mdi:server-network', 'mdi', 'Server network', 'it_ups', 470),
  ('mdi:database', 'mdi', 'Database', 'it_ups', 480),
  ('mdi:router-network', 'mdi', 'Router network', 'it_ups', 490),
  ('mdi:router-wireless', 'mdi', 'Router wireless', 'it_ups', 500),
  ('mdi:access-point', 'mdi', 'Access point', 'it_ups', 510),
  ('mdi:wifi', 'mdi', 'Wifi', 'it_ups', 520),
  ('mdi:lan', 'mdi', 'LAN', 'it_ups', 530),
  ('mdi:lan-connect', 'mdi', 'LAN connect', 'it_ups', 540),
  ('mdi:desktop-tower', 'mdi', 'Desktop tower', 'it_ups', 550),
  ('mdi:memory', 'mdi', 'Memory', 'it_ups', 560),
  ('mdi:chip', 'mdi', 'Chip', 'it_ups', 570),
  ('mdi:heat-pump', 'mdi', 'Heat pump', 'hvac', 580),
  ('mdi:hvac', 'mdi', 'HVAC', 'hvac', 590),
  ('mdi:fan', 'mdi', 'Fan', 'hvac', 600),
  ('mdi:air-filter', 'mdi', 'Air filter', 'hvac', 610),
  ('mdi:air-humidifier', 'mdi', 'Air humidifier', 'hvac', 620),
  ('mdi:air-purifier', 'mdi', 'Air purifier', 'hvac', 630),
  ('mdi:air-conditioner', 'mdi', 'Air conditioner', 'hvac', 640),
  ('mdi:radiator', 'mdi', 'Radiator', 'hvac', 650),
  ('mdi:water-boiler', 'mdi', 'Water boiler', 'hvac', 660),
  ('mdi:thermometer', 'mdi', 'Thermometer', 'hvac', 670),
  ('mdi:thermometer-alert', 'mdi', 'Thermometer alert', 'hvac', 680),
  ('mdi:snowflake', 'mdi', 'Snowflake', 'hvac', 690),
  ('mdi:fire', 'mdi', 'Fire', 'hvac', 700),
  ('mdi:thermostat', 'mdi', 'Thermostat', 'hvac', 710),
  ('mdi:thermostat-box', 'mdi', 'Thermostat box', 'hvac', 720),
  ('mdi:engine', 'mdi', 'Engine', 'mechanical', 730),
  ('mdi:cog', 'mdi', 'Cog', 'mechanical', 740),
  ('mdi:cogs', 'mdi', 'Cogs', 'mechanical', 750),
  ('mdi:wrench', 'mdi', 'Wrench', 'mechanical', 760),
  ('mdi:hammer', 'mdi', 'Hammer', 'mechanical', 770),
  ('mdi:tools', 'mdi', 'Tools', 'mechanical', 780),
  ('mdi:gauge', 'mdi', 'Gauge', 'mechanical', 790),
  ('mdi:gauge-empty', 'mdi', 'Gauge empty', 'mechanical', 800),
  ('mdi:gauge-full', 'mdi', 'Gauge full', 'mechanical', 810),
  ('mdi:robot-industrial', 'mdi', 'Robot industrial', 'mechanical', 820),
  ('mdi:forklift', 'mdi', 'Forklift', 'mechanical', 830),
  ('mdi:truck', 'mdi', 'Truck', 'mechanical', 840),
  ('mdi:excavator', 'mdi', 'Excavator', 'mechanical', 850),
  ('mdi:crane', 'mdi', 'Crane', 'mechanical', 860),
  ('mdi:tractor', 'mdi', 'Tractor', 'mechanical', 870),
  ('mdi:factory', 'mdi', 'Factory', 'mechanical', 880),
  ('mdi:silo', 'mdi', 'Silo', 'mechanical', 890),
  ('mdi:warehouse', 'mdi', 'Warehouse', 'mechanical', 900),
  ('mdi:gas-cylinder', 'mdi', 'Gas cylinder', 'mechanical', 910),
  ('mdi:propane-tank', 'mdi', 'Propane tank', 'mechanical', 920),
  ('mdi:leaf', 'mdi', 'Leaf', 'environment', 930),
  ('mdi:sprout', 'mdi', 'Sprout', 'environment', 940),
  ('mdi:tree', 'mdi', 'Tree', 'environment', 950),
  ('mdi:pine-tree', 'mdi', 'Pine tree', 'environment', 960),
  ('mdi:weather-cloudy', 'mdi', 'Weather cloudy', 'environment', 970),
  ('mdi:weather-rainy', 'mdi', 'Weather rainy', 'environment', 980),
  ('mdi:weather-fog', 'mdi', 'Weather fog', 'environment', 990),
  ('mdi:weather-sunny', 'mdi', 'Weather sunny', 'environment', 1000),
  ('mdi:weather-windy', 'mdi', 'Weather windy', 'environment', 1010),
  ('mdi:molecule-co2', 'mdi', 'Molecule CO2', 'environment', 1020),
  ('mdi:recycle', 'mdi', 'Recycle', 'environment', 1030),
  ('mdi:radioactive', 'mdi', 'Radioactive', 'environment', 1040),
  ('mdi:biohazard', 'mdi', 'Biohazard', 'environment', 1050),
  ('mdi:smog', 'mdi', 'Smog', 'environment', 1060),
  ('mdi:elevator-passenger', 'mdi', 'Elevator passenger', 'facility', 1070),
  ('mdi:elevator', 'mdi', 'Elevator', 'facility', 1080),
  ('mdi:elevator-up', 'mdi', 'Elevator up', 'facility', 1090),
  ('mdi:elevator-down', 'mdi', 'Elevator down', 'facility', 1100),
  ('mdi:fire-extinguisher', 'mdi', 'Fire extinguisher', 'facility', 1110),
  ('mdi:smoke-detector', 'mdi', 'Smoke detector', 'facility', 1120),
  ('mdi:office-building', 'mdi', 'Office building', 'facility', 1130),
  ('mdi:home', 'mdi', 'Home', 'facility', 1140),
  ('mdi:hospital-building', 'mdi', 'Hospital building', 'facility', 1150),
  ('mdi:school', 'mdi', 'School', 'facility', 1160),
  ('mdi:stairs', 'mdi', 'Stairs', 'facility', 1170),
  ('mdi:door', 'mdi', 'Door', 'facility', 1180),
  ('mdi:door-open', 'mdi', 'Door open', 'facility', 1190),
  ('mdi:door-closed', 'mdi', 'Door closed', 'facility', 1200),
  ('mdi:lock', 'mdi', 'Lock', 'facility', 1210),
  ('mdi:lock-open', 'mdi', 'Lock open', 'facility', 1220),
  ('mdi:key', 'mdi', 'Key', 'facility', 1230),
  ('mdi:shield', 'mdi', 'Shield', 'facility', 1240),
  ('mdi:shield-check', 'mdi', 'Shield check', 'facility', 1250),
  ('mdi:shield-alert', 'mdi', 'Shield alert', 'facility', 1260),
  ('mdi:bell', 'mdi', 'Bell', 'facility', 1270),
  ('mdi:bell-ring', 'mdi', 'Bell ring', 'facility', 1280),
  ('mdi:alarm-light', 'mdi', 'Alarm light', 'facility', 1290),
  ('mdi:fire-hydrant', 'mdi', 'Fire hydrant', 'facility', 1300),
  ('mdi:fire-alert', 'mdi', 'Fire alert', 'facility', 1310),
  ('mdi:medical-bag', 'mdi', 'Medical bag', 'facility', 1320),
  ('mdi:parking', 'mdi', 'Parking', 'facility', 1330),
  ('mdi:car', 'mdi', 'Car', 'facility', 1340),
  ('mdi:garage', 'mdi', 'Garage', 'facility', 1350),
  ('mdi:bus', 'mdi', 'Bus', 'facility', 1360),
  ('mdi:lightbulb', 'mdi', 'Lightbulb', 'facility', 1370),
  ('mdi:lightbulb-on', 'mdi', 'Lightbulb on', 'facility', 1380),
  ('mdi:ceiling-light', 'mdi', 'Ceiling light', 'facility', 1390),
  ('mdi:lamp', 'mdi', 'Lamp', 'facility', 1400),
  ('mdi:floor-lamp', 'mdi', 'Floor lamp', 'facility', 1410),
  ('mdi:clock', 'mdi', 'Clock', 'facility', 1420),
  ('mdi:account-group', 'mdi', 'Account group', 'facility', 1430),
  ('mdi:alert', 'mdi', 'Alert', 'general', 1440),
  ('mdi:alert-circle', 'mdi', 'Alert circle', 'general', 1450),
  ('mdi:information', 'mdi', 'Information', 'general', 1460),
  ('mdi:circle', 'mdi', 'Circle', 'general', 1470),
  ('mdi:square', 'mdi', 'Square', 'general', 1480),
  ('mdi:triangle', 'mdi', 'Triangle', 'general', 1490),
  ('mdi:arrow-right', 'mdi', 'Arrow right', 'general', 1500),
  ('mdi:refresh', 'mdi', 'Refresh', 'general', 1510),
  ('mdi:pulse', 'mdi', 'Pulse', 'general', 1520),
  ('mdi:chart-line', 'mdi', 'Chart line', 'general', 1530),
  ('mdi:view-dashboard', 'mdi', 'View dashboard', 'general', 1540),
  ('mdi:toggle-switch', 'mdi', 'Toggle switch', 'general', 1550),
  ('mdi:flag', 'mdi', 'Flag', 'general', 1560),
  ('mdi:target', 'mdi', 'Target', 'general', 1570),
  ('mdi:map-marker', 'mdi', 'Map marker', 'general', 1580),
  ('mdi:check', 'mdi', 'Check', 'general', 1590),
  ('mdi:close', 'mdi', 'Close', 'general', 1600)
ON CONFLICT DO NOTHING;

REVOKE INSERT, UPDATE, DELETE ON bms.mimic_symbol_libraries, bms.mimic_symbols FROM bms_tenant;

RESET ROLE;

ALTER TABLE bms.mimic_layout_nodes DROP CONSTRAINT IF EXISTS mimic_layout_nodes_symbol_check;

ALTER TABLE bms.mimic_layout_nodes ALTER COLUMN symbol TYPE varchar(64);

ALTER TABLE bms.mimic_layout_nodes DROP CONSTRAINT IF EXISTS mimic_layout_nodes_symbol_fkey;

ALTER TABLE bms.mimic_layout_nodes
  ADD CONSTRAINT mimic_layout_nodes_symbol_fkey FOREIGN KEY (symbol) REFERENCES bms.mimic_symbols(key);

ALTER TABLE bms.mimic_layouts ADD COLUMN IF NOT EXISTS symbol_libraries varchar(32)[] NOT NULL DEFAULT '{core}';

ALTER TABLE bms.mimic_layouts DROP CONSTRAINT IF EXISTS mimic_layouts_symbol_libraries_check;

ALTER TABLE bms.mimic_layouts
  ADD CONSTRAINT mimic_layouts_symbol_libraries_check CHECK (cardinality(symbol_libraries) >= 1);

DO $$
BEGIN
  IF (SELECT count(*) FROM bms.mimic_symbol_libraries WHERE active) <> 4 THEN
    RAISE EXCEPTION 'migration 0090: expected 4 active symbol libraries';
  END IF;
  IF (SELECT count(*) FROM bms.mimic_symbols WHERE library_code = 'core' AND active) <> 29 THEN
    RAISE EXCEPTION 'migration 0090: expected 29 active core symbols';
  END IF;
  IF (SELECT count(*) FROM bms.mimic_symbols WHERE library_code = 'tabler' AND active) <> 123 THEN
    RAISE EXCEPTION 'migration 0090: expected 123 active tabler symbols';
  END IF;
  IF (SELECT count(*) FROM bms.mimic_symbols WHERE library_code = 'lucide' AND active) <> 126 THEN
    RAISE EXCEPTION 'migration 0090: expected 126 active lucide symbols';
  END IF;
  IF (SELECT count(*) FROM bms.mimic_symbols WHERE library_code = 'mdi' AND active) <> 160 THEN
    RAISE EXCEPTION 'migration 0090: expected 160 active mdi symbols';
  END IF;
  -- A CHECK on symbol that survived the name-exact DROP (renamed by hand) would refuse every
  -- library key at save time.
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'bms.mimic_layout_nodes'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%symbol%IN%'
  ) THEN
    RAISE EXCEPTION 'migration 0090: a CHECK on bms.mimic_layout_nodes.symbol still lists symbols';
  END IF;
  -- ADD COLUMN IF NOT EXISTS is silent when a column of that name already exists.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'bms' AND table_name = 'mimic_layouts' AND column_name = 'symbol_libraries'
       AND udt_name = '_varchar' AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION 'migration 0090: bms.mimic_layouts.symbol_libraries is not a NOT NULL varchar array';
  END IF;
  -- has_table_privilege follows role membership, so a privilege bms_tenant inherits from another
  -- role is caught here rather than surviving a REVOKE that looked complete (the 0085 shape).
  IF has_table_privilege('bms_tenant', 'bms.mimic_symbol_libraries', 'INSERT')
     OR has_table_privilege('bms_tenant', 'bms.mimic_symbol_libraries', 'UPDATE')
     OR has_table_privilege('bms_tenant', 'bms.mimic_symbol_libraries', 'DELETE')
     OR has_table_privilege('bms_tenant', 'bms.mimic_symbols', 'INSERT')
     OR has_table_privilege('bms_tenant', 'bms.mimic_symbols', 'UPDATE')
     OR has_table_privilege('bms_tenant', 'bms.mimic_symbols', 'DELETE') THEN
    RAISE EXCEPTION 'migration 0090: bms_tenant still holds INSERT, UPDATE or DELETE on a symbol library table';
  END IF;
  IF NOT has_table_privilege('bms_tenant', 'bms.mimic_symbols', 'SELECT') THEN
    RAISE EXCEPTION 'migration 0090: bms_tenant cannot read bms.mimic_symbols';
  END IF;
END $$;
