#!/usr/bin/env node
/**
 * `F3.32e` / ADR 0084 decisions 4 and 5 — vendors the curated mimic symbol libraries.
 *
 * Run by hand, with the extracted npm packages of each pinned source release:
 *
 *   node scripts/mimic-symbols/generate.mjs \
 *     --tabler <dir of @tabler/icons 3.48.0> \
 *     --lucide <dir of lucide-static 1.48.0> \
 *     --mdi <dir of @mdi/svg 7.4.47> [--migration]
 *
 * It reads `scripts/mimic-symbols/curation/<library>.json` (group → icon names) and writes, per
 * library, two modules:
 *
 * - `packages/shared/src/mimic-symbol-libraries/<library>.generated.ts` — the keys, labels and
 *   groups (no path data), which the contract's `mimicSymbolSchema` and the registry read;
 * - `apps/web/src/components/widgets/mimic-symbol-libraries/<library>.generated.ts` — the
 *   licence notice and each key's shape elements, which `MimicGlyph` draws as React elements.
 *
 * With `--migration` it also writes `packages/db/drizzle/0090_mimic_symbol_libraries.sql` and its
 * journal entry — only when that file does not exist yet: a committed migration is frozen, so a
 * later curation change is a new migration, written by hand.
 *
 * It refuses, naming the icon, anything decision 4 leaves out: an unknown name; an element or an
 * attribute outside the geometry lists below; a Tabler `-filled` variant; a Lucide node with a
 * `fill`; an MDI icon that is deprecated or tagged "Brand / Logo"; a key over 64 characters; an
 * unknown group; a name listed twice; two icons of one library with the same label or the same
 * path data. The generator has no dependency beyond Node.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

const GROUPS = ["water", "electrical", "it_ups", "hvac", "mechanical", "environment", "facility", "general"];
const TAGS = new Set(["path", "circle", "ellipse", "rect", "line", "polyline", "polygon"]);
const ATTRS = ["d", "cx", "cy", "r", "rx", "ry", "x", "y", "width", "height", "x1", "y1", "x2", "y2", "points"];
const ATTR_SET = new Set(ATTRS);
const UPPER = new Set(["ups", "hvac", "cpu", "ac", "dc", "co2", "ev", "lan", "pc", "it", "dg", "pdu", "led", "usb", "iot", "tv"]);
const MAX_KEY = 64;

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

function fail(message) {
  console.error(`generate: ${message}`);
  process.exit(1);
}

function args() {
  const out = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--migration") out.migration = true;
    else if (["--tabler", "--lucide", "--mdi"].includes(flag)) out[flag.slice(2)] = argv[++i];
    else fail(`unknown argument ${flag}`);
  }
  for (const lib of ["tabler", "lucide", "mdi"]) {
    if (!out[lib] || !existsSync(out[lib])) fail(`--${lib} <dir> is required and must exist`);
  }
  return out;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function labelOf(name) {
  const words = name.split("-").map((w) => (UPPER.has(w) ? w.toUpperCase() : w));
  const text = words.join(" ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Checks one icon's nodes against the element and attribute lists; returns them normalised. */
function checkNodes(lib, name, nodes) {
  if (!Array.isArray(nodes) || nodes.length === 0) fail(`${lib}:${name} has no shape elements`);
  return nodes.map(([tag, attrs]) => {
    if (!TAGS.has(tag)) fail(`${lib}:${name} has element <${tag}>, outside the permitted list`);
    const clean = {};
    for (const [attr, value] of Object.entries(attrs)) {
      if (attr === "key") continue; // Lucide's React key, not an SVG attribute
      if (!ATTR_SET.has(attr)) fail(`${lib}:${name} has attribute ${attr}, outside the geometry list`);
      if (!/^[0-9a-zA-Z .,\-]*$/.test(String(value))) fail(`${lib}:${name} ${attr} has an unexpected character`);
      clean[attr] = String(value);
    }
    return [tag, clean];
  });
}

function tablerSource(dir) {
  const nodes = readJson(join(dir, "tabler-nodes-outline.json"));
  return {
    version: readJson(join(dir, "package.json")).version,
    licence: readFileSync(join(dir, "LICENSE"), "utf8"),
    shapes(name) {
      if (name.endsWith("-filled")) fail(`tabler:${name} is a filled variant`);
      if (!nodes[name]) fail(`tabler:${name} does not exist in the release`);
      return checkNodes("tabler", name, nodes[name]);
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
      return checkNodes("lucide", name, nodes[name]);
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
      return checkNodes("mdi", name, nodes);
    },
  };
}

const LIBRARIES = [
  {
    code: "tabler",
    constant: "TABLER",
    type: "TablerSymbolKey",
    label: "Tabler Icons",
    source: "@tabler/icons",
    licenceName: "MIT",
    attributionUrl: "https://tabler.io/icons",
    style: "stroke",
    load: tablerSource,
  },
  {
    code: "lucide",
    constant: "LUCIDE",
    type: "LucideSymbolKey",
    label: "Lucide",
    source: "lucide-static",
    licenceName: "ISC",
    attributionUrl: "https://lucide.dev",
    style: "stroke",
    load: lucideSource,
  },
  {
    code: "mdi",
    constant: "MDI",
    type: "MdiSymbolKey",
    label: "Material Design Icons",
    source: "@mdi/svg",
    licenceName: "Apache 2.0",
    attributionUrl: "https://pictogrammers.com/library/mdi/",
    style: "fill",
    load: mdiSource,
  },
];

function build(lib, dir) {
  const source = lib.load(dir);
  const curation = readJson(join(ROOT, "scripts", "mimic-symbols", "curation", `${lib.code}.json`));
  const entries = [];
  const seen = new Set();
  const labels = new Set();
  const paths = new Map();
  for (const [group, names] of Object.entries(curation)) {
    if (!GROUPS.includes(group)) fail(`${lib.code} curation has unknown group ${group}`);
    for (const name of names) {
      const key = `${lib.code}:${name}`;
      if (key.length > MAX_KEY) fail(`${key} is longer than ${MAX_KEY}`);
      if (seen.has(key)) fail(`${key} is listed twice`);
      seen.add(key);
      const label = labelOf(name);
      if (labels.has(label)) fail(`${key}: label "${label}" repeats in ${lib.code}`);
      labels.add(label);
      const shapes = source.shapes(name);
      const signature = JSON.stringify(shapes);
      if (paths.has(signature)) fail(`${key} draws the same shapes as ${paths.get(signature)}`);
      paths.set(signature, key);
      entries.push({ key, label, group, shapes });
    }
  }
  return { ...lib, version: source.version, licence: source.licence, entries };
}

const HEADER = (lib) =>
  `// GENERATED by scripts/mimic-symbols/generate.mjs from ${lib.source} ${lib.version} — do not edit by hand.\n` +
  `// ${lib.label} — ${lib.licenceName}. The full licence notice is \`${lib.constant}_LICENCE_NOTICE\` in\n` +
  `// apps/web/src/components/widgets/mimic-symbol-libraries/${lib.code}.generated.ts (ADR 0084 decision 5).\n`;

function sharedModule(lib) {
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

function webModule(lib) {
  const lines = [
    HEADER(lib),
    `import type { ${lib.type} } from "@bms/shared";`,
    "",
    'import type { MimicShape } from "./shapes";',
    "",
    `/** The ${lib.label} licence, verbatim from the release; the palette shows it. */`,
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
--    \`mimic_symbols_key_names_library_check\` holds that.
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
--    ADD carries no IF-NOT-EXISTS guard: a failed ADD is a real fault and must abort.
--
-- 4. A LAYOUT CHOOSES ITS LIBRARIES (decision 8): \`mimic_layouts.symbol_libraries\`, default
--    \`{core}\`, at least one member. An existing layout reads as \`{core}\` and draws as before.
--
-- SET ROLE bms_owner: \`pnpm db:migrate\` connects as the superuser, so the tables are created as
-- bms_owner and \`0041\`'s default privileges grant them; bms_owner also owns the two altered
-- tables. No GRANT, no policy. The \`DO $$\` block asserts the effect, per the 0059/0060/0087
-- idiom, so a silent ON CONFLICT no-op cannot pass as success.

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
    (library_code = 'core' AND position(':' in key) = 0) OR key LIKE library_code || ':%'
  )
);

CREATE INDEX IF NOT EXISTS mimic_symbols_library_idx ON bms.mimic_symbols (library_code, group_code, sort_order);

INSERT INTO bms.mimic_symbol_libraries (code, label, source, version, licence, attribution_url, style, sort_order) VALUES
${libraryRows.map((r) => `  (${r.slice(0, 7).map(sql).join(", ")}, ${r[7]})`).join(",\n")}
ON CONFLICT DO NOTHING;

INSERT INTO bms.mimic_symbols (key, library_code, label, group_code, sort_order) VALUES
${symbolRows.map((r) => `  (${r.slice(0, 4).map(sql).join(", ")}, ${r[4]})`).join(",\n")}
ON CONFLICT DO NOTHING;

ALTER TABLE bms.mimic_layout_nodes DROP CONSTRAINT IF EXISTS mimic_layout_nodes_symbol_check;

ALTER TABLE bms.mimic_layout_nodes ALTER COLUMN symbol TYPE varchar(64);

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
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'bms.mimic_layout_nodes'::regclass
       AND conname = 'mimic_layout_nodes_symbol_fkey'
       AND contype = 'f'
  ) THEN
    RAISE EXCEPTION 'migration 0090: bms.mimic_layout_nodes has no mimic_layout_nodes_symbol_fkey';
  END IF;
  IF (
    SELECT character_maximum_length FROM information_schema.columns
     WHERE table_schema = 'bms' AND table_name = 'mimic_layout_nodes' AND column_name = 'symbol'
  ) IS DISTINCT FROM 64 THEN
    RAISE EXCEPTION 'migration 0090: bms.mimic_layout_nodes.symbol is not varchar(64)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'bms' AND table_name = 'mimic_layouts' AND column_name = 'symbol_libraries'
  ) THEN
    RAISE EXCEPTION 'migration 0090: bms.mimic_layouts has no symbol_libraries column';
  END IF;
END $$;

RESET ROLE;
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

const opts = args();
const libs = LIBRARIES.map((lib) => build(lib, opts[lib.code]));
for (const lib of libs) {
  writeFileSync(join(ROOT, "packages", "shared", "src", "mimic-symbol-libraries", `${lib.code}.generated.ts`), sharedModule(lib));
  writeFileSync(
    join(ROOT, "apps", "web", "src", "components", "widgets", "mimic-symbol-libraries", `${lib.code}.generated.ts`),
    webModule(lib),
  );
  console.log(`generate: ${lib.code} ${lib.version} — ${lib.entries.length} symbols`);
}
if (opts.migration) writeMigration(libs);
