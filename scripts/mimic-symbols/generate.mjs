#!/usr/bin/env node
/**
 * `F3.32e` / ADR 0084 decisions 4 and 5, and `F3.32f` / ADR 0086 decision 9 — vendors the
 * curated mimic symbol libraries.
 *
 * Run by hand, with the extracted sources of each pinned release:
 *
 *   node scripts/mimic-symbols/generate.mjs \
 *     --tabler <dir of @tabler/icons 3.48.0> \
 *     --lucide <dir of lucide-static 1.48.0> \
 *     --mdi <dir of @mdi/svg 7.4.47> \
 *     --qet <dir from fetch-sources.mjs qet> \
 *     --wmpid <dir from fetch-sources.mjs wmpid> \
 *     --drawio <dir from fetch-sources.mjs drawio> \
 *     [--only <code>[,<code>]] [--report] [--sql-rows <code>] [--migration]
 *
 * - `--only` builds and writes only the named libraries; only their directory flags are required.
 * - `--report` collects every refusal instead of stopping at the first, prints them grouped by
 *   library and writes nothing; it exits 1 when it found a refusal.
 * - `--sql-rows <code>` builds that one library and prints its `bms.mimic_symbols` VALUES lines
 *   (`sort_order` = 10 × position) for a hand-written migration; it writes nothing.
 * - `--migration` writes `packages/db/drizzle/0090_mimic_symbol_libraries.sql` and its journal
 *   entry from the three `0090` libraries — only when that file does not exist yet: a committed
 *   migration is frozen, so a later curation change is a new migration, written by hand.
 *
 * It reads `scripts/mimic-symbols/curation/<library>.json` and writes, per library:
 *
 * - `packages/shared/src/mimic-symbol-libraries/<library>.generated.ts` — the keys, labels and
 *   groups (no path data), which the contract's `mimicSymbolSchema` and the registry read;
 * - `apps/web/src/components/widgets/mimic-symbol-libraries/<library>.generated.ts` — the
 *   licence notice and each key's shape elements, which `MimicGlyph` draws as React elements;
 * - for a source with per-file credits (`qet`, `wmpid`, `drawio`),
 *   `apps/web/src/components/widgets/mimic-symbol-libraries/<library>.credits.generated.ts`.
 *
 * Curation entries are names (`tabler`, `lucide`, `mdi`: `{ "<group>": ["<name>"] }`) or objects
 * (`qet`, `wmpid`, `drawio`: `{ "<group>": [{ "name": "<name>", …source fields }] }`, see
 * `sources/*.mjs`).
 *
 * It refuses, naming the symbol, anything decision 4 leaves out: an unknown name; an element or an
 * attribute outside the geometry lists (`lib/grammar.mjs`); a value outside its attribute's grammar
 * (a number, path data, a points list, or a `transform` outside `MIMIC_TRANSFORM_RE`); more than
 * 200 shapes; a Tabler `-filled` variant; a Lucide node with a `fill`; an MDI icon that is
 * deprecated or tagged "Brand / Logo"; a key over 64 characters; a key the colour scan would read
 * (`fill`, `stroke`, `style`, `class`); a label over 64 characters; an unknown group; a name listed
 * twice; two symbols of one library with the same label or the same shapes; a release that is not
 * the pinned one. The generator has no dependency beyond Node.
 */
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ATTRS,
  COLOUR_WORD,
  GROUPS,
  MAX_KEY,
  MAX_LABEL,
  NAME,
  Refusal,
  checkNodes,
  fail,
  labelOf,
} from "./lib/grammar.mjs";
import { LIBRARY as DRAWIO } from "./sources/drawio.mjs";
import { LIBRARY as QET } from "./sources/qet.mjs";
import { LIBRARY as WMPID } from "./sources/wmpid.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SHARED_DIR = join(ROOT, "packages", "shared", "src", "mimic-symbol-libraries");
const WEB_DIR = join(ROOT, "apps", "web", "src", "components", "widgets", "mimic-symbol-libraries");

/**
 * The 29 core symbols (ADR 0082), their labels and groups, in `mimicCoreSymbolSchema`'s order —
 * only for the core rows of migration 0090. `tests/f3.32e-mimic-symbol-libraries.test.ts`
 * compares these rows to the contract and to `MIMIC_CORE_SYMBOL_LABELS`.
 */
const CORE = [
  ["tank", "Tank", "water"],
  ["clarifier", "Clarifier", "water"],
  ["membrane", "Membrane", "water"],
  ["vessel", "Vessel", "water"],
  ["tower", "Tower", "hvac"],
  ["aeration", "Aeration", "water"],
  ["dosing", "Dosing", "water"],
  ["pump", "Pump", "general"],
  ["discharge", "Discharge", "water"],
  ["valve", "Valve", "general"],
  ["filter", "Filter", "water"],
  ["unit", "Unit", "general"],
  ["transformer", "Transformer", "electrical"],
  ["breaker", "Breaker", "electrical"],
  ["switchboard", "Switchboard", "electrical"],
  ["generator", "Generator", "electrical"],
  ["meter", "Meter", "electrical"],
  ["motor", "Motor", "electrical"],
  ["ups", "UPS", "it_ups"],
  ["battery", "Battery", "it_ups"],
  ["rack", "Rack", "it_ups"],
  ["chiller", "Chiller", "hvac"],
  ["ahu", "AHU", "hvac"],
  ["fan", "Fan", "hvac"],
  ["compressor", "Compressor", "mechanical"],
  ["boiler", "Boiler", "mechanical"],
  ["sensor", "Sensor", "environment"],
  ["lamp", "Lamp", "facility"],
  ["lift", "Lift", "facility"],
];

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function tablerSource(dir) {
  const nodes = readJson(join(dir, "tabler-nodes-outline.json"));
  return {
    version: readJson(join(dir, "package.json")).version,
    licence: readFileSync(join(dir, "LICENSE"), "utf8"),
    shapes(name) {
      if (name.endsWith("-filled")) fail(`tabler:${name} is a filled variant`);
      if (!nodes[name]) fail(`tabler:${name} does not exist in the release`);
      return checkNodes(`tabler:${name}`, nodes[name]);
    },
  };
}

function lucideSource(dir) {
  const nodes = readJson(join(dir, "icon-nodes.json"));
  return {
    version: readJson(join(dir, "package.json")).version,
    licence: readFileSync(join(dir, "LICENSE"), "utf8"),
    shapes(name) {
      if (!nodes[name]) fail(`lucide:${name} does not exist in the release`);
      if (nodes[name].some(([, attrs]) => "fill" in attrs)) fail(`lucide:${name} carries a fill`);
      return checkNodes(`lucide:${name}`, nodes[name]);
    },
  };
}

function mdiSource(dir) {
  const meta = new Map(readJson(join(dir, "meta.json")).map((m) => [m.name, m]));
  return {
    version: readJson(join(dir, "package.json")).version,
    licence: readFileSync(join(dir, "LICENSE"), "utf8"),
    shapes(name) {
      const m = meta.get(name);
      if (!m) fail(`mdi:${name} does not exist in the release`);
      if (m.deprecated) fail(`mdi:${name} is deprecated`);
      if (m.tags.includes("Brand / Logo")) fail(`mdi:${name} is a brand icon`);
      const svg = readFileSync(join(dir, "svg", `${name}.svg`), "utf8");
      const elements = [...svg.matchAll(/<(\w+)\s([^>]*?)\/?>/g)].filter(([, tag]) => tag !== "svg");
      const nodes = elements.map(([, tag, body]) => {
        const attrs = {};
        for (const [, attr, value] of body.matchAll(/([\w-]+)="([^"]*)"/g)) attrs[attr] = value;
        return [tag, attrs];
      });
      return checkNodes(`mdi:${name}`, nodes);
    },
  };
}

/**
 * The libraries in registry order. A descriptor's `load(dir)` answers `{ version, licence,
 * conversion?, shapes(entry), credit?(entry) }`; `entryShape` says whether a curation entry is a
 * name (`string`) or an object with a `name` (`object`).
 */
const LIBRARIES = [
  {
    code: "tabler",
    constant: "TABLER",
    type: "TablerSymbolKey",
    label: "Tabler Icons",
    source: "@tabler/icons",
    pinned: "3.48.0",
    licenceName: "MIT",
    attributionUrl: "https://tabler.io/icons",
    style: "stroke",
    entryShape: "string",
    load: tablerSource,
  },
  {
    code: "lucide",
    constant: "LUCIDE",
    type: "LucideSymbolKey",
    label: "Lucide",
    source: "lucide-static",
    pinned: "1.48.0",
    // Migration 0090 carries the earlier label "ISC"; 0091 corrects it (F3.32f / ADR 0086 decision 10).
    licenceName: "ISC and MIT",
    attributionUrl: "https://lucide.dev",
    style: "stroke",
    entryShape: "string",
    load: lucideSource,
  },
  {
    code: "mdi",
    constant: "MDI",
    type: "MdiSymbolKey",
    label: "Material Design Icons",
    source: "@mdi/svg",
    pinned: "7.4.47",
    licenceName: "Apache 2.0",
    // Apache 2.0 section 4(a): recipients get a copy of the licence itself. The release's LICENSE
    // names it by URL only, so the text vendored from apache.org follows it. The release has no
    // NOTICE file (section 4(d)).
    extraLicence: "Apache-2.0.txt",
    attributionUrl: "https://pictogrammers.com/library/mdi/",
    style: "fill",
    entryShape: "string",
    load: mdiSource,
  },
  QET,
  WMPID,
  DRAWIO,
];

/** The libraries migration 0090 holds; `--migration` writes from these only. */
const MIGRATION_0090_CODES = ["tabler", "lucide", "mdi"];

const CREDIT_FIELDS = ["author", "source", "licence", "licenceUrl", "pin", "adaptation"];

/** A source's credit for one entry, checked: six non-empty strings (the last, `adaptation`, says how
 * the file was changed — CC BY 3.0 §4(b), CC BY 4.0 §3(a)(1)(B)), an https licence URL. */
function checkCredit(key, credit) {
  if (!credit || typeof credit !== "object") fail(`${key} has no credit`);
  for (const field of CREDIT_FIELDS) {
    if (typeof credit[field] !== "string" || credit[field].trim() === "") fail(`${key} credit has no ${field}`);
  }
  if (!credit.licenceUrl.startsWith("https://")) fail(`${key} credit licenceUrl is not https`);
  return Object.fromEntries(CREDIT_FIELDS.map((field) => [field, credit[field]]));
}

/**
 * Reads one library's curation through its source. `collect`, when given, receives each refusal
 * and the build goes on (`--report`); otherwise the first refusal stops it.
 */
function build(lib, dir, collect = null) {
  const source = lib.load(dir);
  if (source.version !== lib.pinned) fail(`${lib.source} is ${source.version}, but the ADR pins ${lib.pinned}`);
  const curation = readJson(join(ROOT, "scripts", "mimic-symbols", "curation", `${lib.code}.json`));
  const entries = [];
  const seen = new Set();
  const labels = new Set();
  const paths = new Map();
  for (const [group, list] of Object.entries(curation)) {
    if (!GROUPS.includes(group)) fail(`${lib.code} curation has unknown group ${group}`);
    if (!Array.isArray(list)) fail(`${lib.code} curation group ${group} is not a list`);
    for (const item of list) {
      try {
        const name = lib.entryShape === "object" ? item?.name : item;
        if (lib.entryShape === "object" && (item === null || typeof item !== "object" || Array.isArray(item))) {
          fail(`${lib.code} curation entry ${JSON.stringify(item)} is not an object`);
        }
        // Checked before the name reaches a file path or a generated string literal.
        if (typeof name !== "string" || !NAME.test(name)) fail(`${lib.code} curation name ${JSON.stringify(name)} is not a-z, 0-9 and -`);
        const key = `${lib.code}:${name}`;
        if (key.length > MAX_KEY) fail(`${key} is longer than ${MAX_KEY}`);
        if (COLOUR_WORD.test(key)) fail(`${key} names fill, stroke, style or class, which the colour scan refuses`);
        if (seen.has(key)) fail(`${key} is listed twice`);
        seen.add(key);
        const label = labelOf(name);
        if (label.length > MAX_LABEL) fail(`${key}: label "${label}" is longer than ${MAX_LABEL}`);
        if (labels.has(label)) fail(`${key}: label "${label}" repeats in ${lib.code}`);
        labels.add(label);
        const shapes = checkNodes(key, source.shapes(item));
        const signature = JSON.stringify(shapes);
        if (paths.has(signature)) fail(`${key} draws the same shapes as ${paths.get(signature)}`);
        paths.set(signature, key);
        const credit = typeof source.credit === "function" ? checkCredit(key, source.credit(item)) : null;
        entries.push({ key, label, group, shapes, credit });
      } catch (error) {
        const message = error instanceof Refusal ? error.message : `${lib.code}:${item?.name ?? item}: ${error.message}`;
        if (!collect) fail(message);
        collect(message);
      }
    }
  }
  // Apache 2.0 section 4(b) asks for a notice on a changed file; the same line serves every library.
  const changed =
    source.conversion ??
    `Converted by scripts/mimic-symbols/generate.mjs from the icon files of ${lib.source} ${source.version} ` +
      "into shape arrays of their geometry; the drawings are otherwise unchanged.";
  const extra = lib.extraLicence
    ? "\n\n" + readFileSync(join(ROOT, "scripts", "mimic-symbols", "licences", lib.extraLicence), "utf8").trim()
    : "";
  return {
    ...lib,
    version: source.version,
    licence: `${changed}\n\n${source.licence.trim()}${extra}`,
    hasCredits: typeof source.credit === "function",
    entries,
  };
}

const HEADER = (lib) =>
  `// GENERATED by scripts/mimic-symbols/generate.mjs from ${lib.source} ${lib.version} — do not edit by hand.\n` +
  `// ${lib.label} — ${lib.licenceName}. The full licence notice is \`${lib.constant}_LICENCE_NOTICE\` in\n` +
  `// apps/web/src/components/widgets/mimic-symbol-libraries/${lib.code}.generated.ts (ADR 0084 decision 5).\n`;

export function sharedModule(lib) {
  const lines = [
    HEADER(lib),
    'import type { MimicSymbolGroupCode } from "../contracts/mimic-layouts";',
    "",
    `/** The curated ${lib.label} keys, in curation order (ADR 0084 decision 4). */`,
    `export const ${lib.constant}_SYMBOL_KEYS = [`,
    ...lib.entries.map((e) => `  "${e.key}",`),
    "] as const;",
    "",
    `export type ${lib.type} = (typeof ${lib.constant}_SYMBOL_KEYS)[number];`,
    "",
    `/** Each ${lib.label} key's label and palette group. */`,
    `export const ${lib.constant}_SYMBOL_META: Readonly<`,
    `  Record<${lib.type}, { readonly label: string; readonly group: MimicSymbolGroupCode }>`,
    "> = {",
    ...lib.entries.map((e) => `  "${e.key}": { label: ${JSON.stringify(e.label)}, group: "${e.group}" },`),
    "};",
    "",
  ];
  return lines.join("\n");
}

function templateLiteral(text) {
  return "`" + text.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${") + "`";
}

function shapeLiteral(shapes) {
  const parts = shapes.map(([tag, attrs]) => {
    const body = ATTRS.filter((a) => a in attrs)
      .map((a) => `${a}: ${JSON.stringify(attrs[a])}`)
      .join(", ");
    return `["${tag}", { ${body} }]`;
  });
  return `[${parts.join(", ")}]`;
}

export function webModule(lib) {
  const lines = [
    HEADER(lib),
    `import type { ${lib.type} } from "@bms/shared";`,
    "",
    'import type { MimicShape } from "./shapes";',
    "",
    `/** A line recording the conversion, then the ${lib.label} licence verbatim from the release${lib.extraLicence ? " and the full licence text it names" : ""}; the palette shows it. */`,
    `export const ${lib.constant}_LICENCE_NOTICE = ${templateLiteral(lib.licence.trim())};`,
    "",
    `/** Each ${lib.label} key's shape elements, geometry attributes only (ADR 0084 decision 5). */`,
    `export const ${lib.constant}_SHAPES: Readonly<Record<${lib.type}, readonly MimicShape[]>> = {`,
    ...lib.entries.map((e) => `  "${e.key}": ${shapeLiteral(e.shapes)},`),
    "};",
    "",
  ];
  return lines.join("\n");
}

export function creditsModule(lib) {
  const lines = [
    HEADER(lib),
    `import type { ${lib.type} } from "@bms/shared";`,
    "",
    'import type { MimicSymbolCredit } from "./credits";',
    "",
    `/** Each ${lib.label} key's author, source file, licence, pin and adaptation; the attributions page lists them (ADR 0086 decision 9). */`,
    `export const ${lib.constant}_SYMBOL_CREDITS: Readonly<Record<${lib.type}, MimicSymbolCredit>> = {`,
    ...lib.entries.map(
      (e) =>
        `  "${e.key}": { ${CREDIT_FIELDS.map((field) => `${field}: ${JSON.stringify(e.credit[field])}`).join(", ")} },`,
    ),
    "};",
    "",
  ];
  return lines.join("\n");
}

const sql = (value) => `'${String(value).replace(/'/g, "''")}'`;

function migration(libs) {
  const libraryRows = [
    ["core", "Core", "Built in", "1", "Own drawings", "", "stroke", 10],
    ...libs.map((l, i) => [l.code, l.label, l.source, l.version, l.licenceName, l.attributionUrl, l.style, 20 + i * 10]),
  ];
  const symbolRows = [
    ...CORE.map(([key, label, group], i) => [key, "core", label, group, (i + 1) * 10]),
    ...libs.flatMap((l) => l.entries.map((e, i) => [e.key, l.code, e.label, e.group, (i + 1) * 10])),
  ];
  const counts = [["core", CORE.length], ...libs.map((l) => [l.code, l.entries.length])];
  return `-- F3.32e / ADR 0084 decisions 1, 2, 3 and 8 — preloaded mimic symbol libraries.
--
-- GENERATED ONCE by scripts/mimic-symbols/generate.mjs --migration, then frozen like every
-- committed migration: a later curation change is a new migration, written by hand.
--
-- 1. TWO GLOBAL LOOKUP TABLES in the \`bms.asset_roles\` shape (0051): no organization_id and no
--    row security, because every organization reads the same libraries (ADR 0084 decision 1).
--    \`bms.mimic_symbol_libraries\` holds one row per library with its source, version, licence
--    and draw style; \`bms.mimic_symbols\` one row per symbol key with its label and palette
--    group. A core key is bare; every other key is \`<library>:<name>\` (decision 2), and
--    \`mimic_symbols_key_names_library_check\` holds that with a regular expression, not a LIKE
--    (an \`_\` in a library code would be a wildcard); \`mimic_symbol_libraries_code_check\`
--    keeps a library code to lower-case letters and digits.
--
-- 2. THE ROWS are the 29 core symbols (ADR 0082, in \`mimicCoreSymbolSchema\`'s order) and the
--    curated keys of \`scripts/mimic-symbols/curation/*.json\`, in curation order.
--    \`tests/f3.32e-mimic-symbol-libraries.test.ts\` compares them with the shared and the web
--    generated modules, both ways. Bare ON CONFLICT DO NOTHING (no arbiter), for the
--    0030/0034/0051 reason.
--
-- 3. A FOREIGN KEY REPLACES THE SYMBOL CHECK (decision 3). The rows go in first, so the
--    existing core values validate. \`0088\` and \`0089\` are frozen, so this file drops
--    \`mimic_layout_nodes_symbol_check\` (IF EXISTS) and widens \`symbol\` to varchar(64). The
--    foreign key has no ON DELETE: a symbol in use cannot be removed, only made inactive. The
--    ADD follows a DROP IF EXISTS of the same name, so a replay re-adds it (AGENTS.md §4.4); a
--    failed ADD is a real fault and aborts the migration.
--
-- 4. A LAYOUT CHOOSES ITS LIBRARIES (decision 8): \`mimic_layouts.symbol_libraries\`, default
--    \`{core}\`, at least one member. An existing layout reads as \`{core}\` and draws as before.
--
-- 5. BMS_TENANT CANNOT WRITE THE LIBRARIES (owner ruling 2026-09-29, ADR 0084 decision 1 as
--    amended). \`0041\`'s default privileges grant every verb to \`bms_tenant\`; the libraries are
--    fleet-wide master data, the line \`0059\` drew for \`bms.point_keys\` and \`0085\` for
--    \`bms.location_types\`. The REVOKE runs as the grantor (\`bms_owner\`): a superuser issuing
--    it removes nothing and reports success (\`0059\`'s header). \`bms_fleet\` keeps its verbs.
--
-- WHO RUNS WHAT. The CREATEs, the INSERTs and the REVOKE run inside \`SET ROLE bms_owner\`, so
-- \`0041\`'s default privileges apply to the new tables and the REVOKE has its grantor. The ALTERs
-- on the two FORCE-RLS tables run after \`RESET ROLE\`, as the migrator's superuser: under
-- \`SET ROLE bms_owner\` with no \`app.current_organization\` a validation scan could see zero
-- rows and pass without checking one (\`0057\`/\`0085\`'s headers). The ALTERs change no owner.
-- No policy. The \`DO $$\` block asserts the effect, per the 0059/0060/0085/0087 idiom, so a
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
  CONSTRAINT mimic_symbols_group_code_check CHECK (group_code IN (${GROUPS.map(sql).join(", ")})),
  CONSTRAINT mimic_symbols_key_names_library_check CHECK (
    CASE WHEN library_code = 'core' THEN key ~ '^[a-z][a-z0-9-]*$'
         ELSE starts_with(key, library_code || ':') AND key ~ '^[a-z][a-z0-9]*:[a-z0-9][a-z0-9-]*$'
    END
  )
);

CREATE INDEX IF NOT EXISTS mimic_symbols_library_idx ON bms.mimic_symbols (library_code, group_code, sort_order);

INSERT INTO bms.mimic_symbol_libraries (code, label, source, version, licence, attribution_url, style, sort_order) VALUES
${libraryRows.map((r) => `  (${r.slice(0, 7).map(sql).join(", ")}, ${r[7]})`).join(",\n")}
ON CONFLICT DO NOTHING;

INSERT INTO bms.mimic_symbols (key, library_code, label, group_code, sort_order) VALUES
${symbolRows.map((r) => `  (${r.slice(0, 4).map(sql).join(", ")}, ${r[4]})`).join(",\n")}
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
  IF (SELECT count(*) FROM bms.mimic_symbol_libraries WHERE active) <> ${libraryRows.length} THEN
    RAISE EXCEPTION 'migration 0090: expected ${libraryRows.length} active symbol libraries';
  END IF;
${counts
  .map(
    ([code, n]) => `  IF (SELECT count(*) FROM bms.mimic_symbols WHERE library_code = '${code}' AND active) <> ${n} THEN
    RAISE EXCEPTION 'migration 0090: expected ${n} active ${code} symbols';
  END IF;`,
  )
  .join("\n")}
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
`;
}

function writeMigration(libs) {
  const tag = "0090_mimic_symbol_libraries";
  const file = join(ROOT, "packages", "db", "drizzle", `${tag}.sql`);
  if (existsSync(file)) {
    console.log(`generate: ${tag}.sql exists and is frozen; not rewritten`);
    return;
  }
  const journalPath = join(ROOT, "packages", "db", "drizzle", "meta", "_journal.json");
  const journal = readJson(journalPath);
  const last = journal.entries[journal.entries.length - 1];
  if (last.idx !== 89) fail(`journal tail is idx ${last.idx}, expected 89`);
  const when = Date.now();
  if (when <= last.when) fail(`Date.now() ${when} is not after the journal tail ${last.when}`);
  journal.entries.push({ idx: 90, version: "7", when, tag, breakpoints: true });
  writeFileSync(file, migration(libs));
  writeFileSync(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
  console.log(`generate: wrote ${tag}.sql, journal when ${when}`);
}

/** One library's `bms.mimic_symbols` VALUES lines, `sort_order` = 10 × position, for a hand-written
 * migration; the last line has no comma, so the block pastes in front of `ON CONFLICT`. */
function sqlRows(lib) {
  return lib.entries
    .map((e, i, all) => `  (${[e.key, lib.code, e.label, e.group].map(sql).join(", ")}, ${(i + 1) * 10})${i < all.length - 1 ? "," : ""}`)
    .join("\n");
}

const DIR_FLAGS = LIBRARIES.map((l) => `--${l.code}`);

function args(argv) {
  const out = { dirs: {}, migration: false, report: false, only: null, sqlRows: null };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--migration") out.migration = true;
    else if (flag === "--report") out.report = true;
    else if (flag === "--only") out.only = String(argv[++i] ?? "").split(",").filter((c) => c !== "");
    else if (flag === "--sql-rows") out.sqlRows = argv[++i];
    else if (DIR_FLAGS.includes(flag)) out.dirs[flag.slice(2)] = argv[++i];
    else fail(`unknown argument ${flag}`);
  }
  const known = LIBRARIES.map((l) => l.code);
  if (out.only !== null && out.sqlRows !== null) fail("--only and --sql-rows cannot be combined");
  if (out.sqlRows !== null && !known.includes(out.sqlRows)) fail(`--sql-rows names unknown library ${out.sqlRows}`);
  if (out.only !== null) {
    if (out.only.length === 0) fail("--only needs at least one library code");
    for (const code of out.only) if (!known.includes(code)) fail(`--only names unknown library ${code}`);
  }
  out.codes = out.sqlRows !== null ? [out.sqlRows] : (out.only ?? known);
  for (const code of out.codes) {
    if (!out.dirs[code] || !existsSync(out.dirs[code])) fail(`--${code} <dir> is required and must exist`);
  }
  if (out.migration) {
    if (out.report || out.sqlRows !== null) fail("--migration cannot be combined with --report or --sql-rows");
    for (const code of MIGRATION_0090_CODES) if (!out.codes.includes(code)) fail(`--migration needs --${code}`);
  }
  return out;
}

function main() {
  const opts = args(process.argv.slice(2));
  const selected = LIBRARIES.filter((l) => opts.codes.includes(l.code));
  const refusals = new Map();
  const collect = (code) => (message) => {
    if (!refusals.has(code)) refusals.set(code, []);
    refusals.get(code).push(message);
  };
  const libs = [];
  for (const lib of selected) {
    if (!opts.report) {
      libs.push(build(lib, opts.dirs[lib.code]));
      continue;
    }
    try {
      libs.push(build(lib, opts.dirs[lib.code], collect(lib.code)));
    } catch (error) {
      collect(lib.code)(error instanceof Refusal ? error.message : `${lib.code}: ${error.message}`);
    }
  }
  if (opts.report) {
    for (const lib of selected) {
      const list = refusals.get(lib.code) ?? [];
      console.log(`generate: ${lib.code} — ${list.length} refusal(s)`);
      for (const message of list) console.log(`  - ${message}`);
    }
    process.exitCode = refusals.size > 0 ? 1 : 0;
    return;
  }
  if (opts.sqlRows !== null) {
    process.stdout.write(`${sqlRows(libs[0])}\n`);
    return;
  }
  for (const lib of libs) {
    writeFileSync(join(SHARED_DIR, `${lib.code}.generated.ts`), sharedModule(lib));
    writeFileSync(join(WEB_DIR, `${lib.code}.generated.ts`), webModule(lib));
    if (lib.hasCredits) writeFileSync(join(WEB_DIR, `${lib.code}.credits.generated.ts`), creditsModule(lib));
    console.log(`generate: ${lib.code} ${lib.version} — ${lib.entries.length} symbols`);
  }
  if (opts.migration) writeMigration(libs.filter((l) => MIGRATION_0090_CODES.includes(l.code)));
}

/** Run as a script only: the emitters above can be imported without running the CLI. */
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    main();
  } catch (error) {
    console.error(`generate: ${error instanceof Refusal ? error.message : error.stack}`);
    process.exit(1);
  }
}
