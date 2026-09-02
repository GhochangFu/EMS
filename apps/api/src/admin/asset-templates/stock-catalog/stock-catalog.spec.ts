import { stockAssetTemplateDtoSchema } from "@bms/shared";

import { readRepoFile } from "../../../testing/repo-root";
import { createAssetTemplateBodySchema } from "../asset-templates.schema";
import { STOCK_ASSET_TEMPLATE_CATALOG } from "./stock-catalog";
import type { StockAssetTemplateEntry } from "./types";

/**
 * `F2.13` — the stock asset-template catalog, proved at build time
 * (ADR 0052 decisions 2 and 5; plan Task 4).
 *
 * Assertions live here (ADR 0014); `stock-catalog.test.ts` is the thin Vitest
 * entry point. Model: `../../dashboard-templates/stock-catalog.spec.ts`.
 *
 * Two kinds of claim, and the difference matters for the next author:
 *
 *  - **Generic, for every entry** — the anti-drift control between
 *    `@bms/shared` (`stockAssetTemplateDtoSchema`, what the list route
 *    returns) and `apps/api` (`createAssetTemplateBodySchema`, what the import
 *    writes through). A field one permits and the other refuses fails HERE,
 *    not on the first import.
 *  - **Entry-specific, for `electrical-feeder`** — each one is a claim about
 *    `docs/electrical-derived-taglist-v1.md` §1, not about the code. If the
 *    tag list changes, these change with it, in the same PR.
 *
 * **Two vocabularies are read out of their migrations, never retyped**, the
 * discipline the dashboard sibling holds: `0030` seeds `bms.alarm_severities`,
 * `0029` seeds `bms.rule_categories`, and `assertTemplateAlarmVocabularies`
 * closes both at create time. Asserting against the parsed sets means a
 * severity nobody seeds fails here first.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * The codes an `INSERT INTO bms.<table> (code, ...) VALUES (...) ON CONFLICT
 * ... DO NOTHING;` block seeds, parsed from the migration text. Throwing on
 * no match is load-bearing: an empty set would make every membership check
 * below vacuously true the moment the insert is reshaped.
 */
function seededCodes(migration: string, table: string): ReadonlySet<string> {
  const startNeedle = `INSERT INTO bms.${table} (`;
  const start = migration.indexOf(startNeedle);
  if (start < 0) {
    throw new Error(`no INSERT INTO bms.${table} found — fix this parser, do not delete it`);
  }
  const end = migration.indexOf("ON CONFLICT", start);
  if (end < 0) {
    throw new Error(`unterminated INSERT INTO bms.${table} — expected a trailing ON CONFLICT`);
  }
  const codes = [...migration.slice(start, end).matchAll(/\(\s*'([a-z0-9_-]+)'/g)].map(
    (m) => m[1] as string,
  );
  if (codes.length === 0) {
    throw new Error(`parsed zero codes out of the bms.${table} insert — the parser is broken`);
  }
  return new Set(codes);
}

const seededSeverities = (): ReadonlySet<string> =>
  seededCodes(readRepoFile("packages/db/drizzle/0030_alarm_severity_vocabulary.sql"), "alarm_severities");
const seededCategories = (): ReadonlySet<string> =>
  seededCodes(
    readRepoFile("packages/db/drizzle/0029_rule_category_concern_asset_domain.sql"),
    "rule_categories",
  );

/** A synthetic organization for the create-body parse. Never written anywhere. */
const SYNTHETIC_ORGANIZATION_ID = "00000000-0000-4000-8000-00000000f213";

const FEEDER_CODE = "electrical-feeder";
const TAG_LIST_REL = "electrical-derived-taglist-v1.md";

/**
 * The six "Derived:" codes §1 of the tag list carries in prose, every one
 * deferred — ADR 0051 Amendment 6 decision 8: a code with no `bms-calc-v1`
 * formula is not vocabulary. Listed so the failure message names them and the
 * next author reads WHY rather than deleting the assertion.
 */
const DEFERRED_DERIVED_CODES = [
  "load_pct",
  "demand_vs_contract_pct",
  "pf_penalty_flag",
  "kwh_per_unit_output",
  "specific_energy_kwh_kl",
  "losses_pct",
] as const;

const DEFERRAL_REASON =
  `ADR 0051 Amendment 6 decision 8: a code with no formula is not vocabulary. The six ` +
  `"Derived:" codes of tag list §1 — ${DEFERRED_DERIVED_CODES.join(", ")} — each need an asset ` +
  "attribute (rating, contract demand, tariff band, production, KL throughput) or a cross-asset " +
  "sum that bms-calc-v1 cannot name (ADR 0036; F2.9 records the fork). They are deferred, not " +
  "authored with a placeholder formula. Zero derived points and no `kpis` in this entry until " +
  "a formula exists for one of them.";

type Alarm = { code: string; pointKey: string; severity: string; category?: string } & Record<
  string,
  unknown
>;

/** The alarms of an entry, as stored — `content` is a bare record on the DTO side. */
function alarmsOf(entry: StockAssetTemplateEntry): Alarm[] {
  const content = (entry.content ?? {}) as { alarms?: Alarm[] };
  return content.alarms ?? [];
}

/**
 * Every claim that holds for ANY entry. Throws on the first violation, naming
 * the entry — bisecting a pack by hand is not a review strategy.
 *
 * Run over the shipped catalog AND over the two inline fixtures below, so an
 * empty catalog (which `F2.12` may create while reorganising the packs) cannot
 * turn this whole function into a `for` over nothing.
 */
function checkEntry(entry: StockAssetTemplateEntry): void {
  const listed = stockAssetTemplateDtoSchema.safeParse(entry);
  assert(
    listed.success,
    `${entry.code}: stockAssetTemplateDtoSchema (what GET /stock returns) refused it — ` +
      `${listed.success ? "" : JSON.stringify(listed.error.flatten().fieldErrors)}`,
  );

  // THE anti-drift control: the same object through the API's own create body,
  // with an organization spread in and `stockVersion` taken off, exactly as
  // `AssetTemplatesStockService.import` does — the create body is `.strict()`,
  // and the stamp travels as `create`'s third argument, not inside the body.
  const { stockVersion: _stamp, ...body } = entry;
  const writable = createAssetTemplateBodySchema.safeParse({
    organizationId: SYNTHETIC_ORGANIZATION_ID,
    ...body,
  });
  assert(
    writable.success,
    `${entry.code}: createAssetTemplateBodySchema (what the import writes through) refused it — ` +
      `${writable.success ? "" : JSON.stringify(writable.error.flatten())}`,
  );

  // `publish` refuses a template with no points ("would instantiate assets
  // with no telemetry mapping"), so a pointless entry is an import nobody can
  // ever publish. `createAssetTemplateBodySchema` allows `points: []`; this is
  // the catalog's own rule on top of it.
  assert(
    entry.points.length >= 1,
    `${entry.code}: a stock entry must declare at least one point — publish refuses a template ` +
      "with none, so this entry could be imported but never published",
  );

  assert(
    Number.isInteger(entry.stockVersion) && entry.stockVersion > 0,
    `${entry.code}: stockVersion must be a positive integer, got ${String(entry.stockVersion)}`,
  );

  // The listed projection must show the same point count the import writes.
  assert(
    listed.success && listed.data.points.length === entry.points.length,
    `${entry.code}: the DTO projection dropped points — ` +
      `${listed.success ? listed.data.points.length : "?"} listed vs ${entry.points.length} authored`,
  );
}

// ---------------------------------------------------------------------------
// Inline fixtures — anti-vacuity that survives an empty catalog.
// ---------------------------------------------------------------------------

const VALID_FIXTURE: StockAssetTemplateEntry = {
  code: "f213-spec-valid",
  name: "Spec fixture — valid",
  assetType: "test_rig",
  domain: "electrical",
  description: "A minimal entry the checks must accept.",
  stockVersion: 1,
  content: { contentVersion: 1 },
  points: [
    {
      pointKey: "kw",
      label: "Active power",
      unit: "kW",
      kind: "measured",
      sourceDataKeyPattern: null,
      formula: null,
      formulaDialect: null,
      calcTrigger: null,
      calcIntervalSeconds: null,
      maxInputAgeSeconds: null,
      required: true,
      sortOrder: 0,
      meta: { tier: "core" },
    },
  ],
};

const POINTLESS_FIXTURE: StockAssetTemplateEntry = {
  ...VALID_FIXTURE,
  code: "f213-spec-pointless",
  points: [],
};

export function runStockAssetTemplateCatalogTests(): void {
  // ---- the checks themselves can pass and can fail ------------------------

  checkEntry(VALID_FIXTURE);

  let pointlessRefused: string | null = null;
  try {
    checkEntry(POINTLESS_FIXTURE);
  } catch (err) {
    pointlessRefused = err instanceof Error ? err.message : String(err);
  }
  assert(
    pointlessRefused !== null && /at least one point/.test(pointlessRefused),
    `an entry with points: [] must be refused by checkEntry, naming the rule — got ${String(pointlessRefused)}`,
  );

  // ---- every shipped entry, generically -----------------------------------

  for (const entry of STOCK_ASSET_TEMPLATE_CATALOG) {
    checkEntry(entry);
  }

  const codes = STOCK_ASSET_TEMPLATE_CATALOG.map((entry) => entry.code);
  assert(
    new Set(codes).size === codes.length,
    `duplicate stock template code across the aggregated catalog: ${codes.join(",")}`,
  );

  // ---- the feeder class, against its tag list -----------------------------

  const feeder = STOCK_ASSET_TEMPLATE_CATALOG.find((entry) => entry.code === FEEDER_CODE);
  assert(
    feeder !== undefined,
    `the catalog must ship "${FEEDER_CODE}" (plan §5) — found only: ${codes.join(", ") || "(nothing)"}`,
  );
  if (!feeder) return;

  // Exactly 33 rows, 17 C and 16 X, in table order (`sortOrder` 0…32).
  assert(feeder.points.length === 33, `tag list §1 has 33 rows; the entry declares ${feeder.points.length}`);
  const required = feeder.points.filter((point) => point.required);
  const optional = feeder.points.filter((point) => !point.required);
  assert(required.length === 17, `17 rows are tier C (required); got ${required.length}`);
  assert(optional.length === 16, `16 rows are tier X (optional); got ${optional.length}`);
  feeder.points.forEach((point, index) => {
    assert(
      point.sortOrder === index,
      `points must be in the tag list's own order — ${point.pointKey} has sortOrder ${point.sortOrder} at index ${index}`,
    );
  });
  const feederKeys = new Set(feeder.points.map((point) => point.pointKey));
  assert(feederKeys.size === 33, "no point key may repeat");

  // The tier marking matches the C/X split exactly (ADR 0040 decision 3).
  for (const point of feeder.points) {
    const tier = point.meta?.tier;
    assert(tier !== undefined, `${point.pointKey} carries no meta.tier — every stock point declares one`);
    assert(
      (point.required && tier === "core") || (!point.required && tier === "extended"),
      `${point.pointKey}: required=${point.required} but tier=${String(tier)} — C is core+required, X is extended+optional`,
    );
  }

  // kwh_today is C/D and authored MEASURED (plan §5): no bms-calc-v1 formula
  // can express energy-today, and a placeholder is the guessing ADR 0019 refuses.
  const kwhToday = feeder.points.find((point) => point.pointKey === "kwh_today");
  assert(
    kwhToday !== undefined && kwhToday.required && kwhToday.kind === "measured",
    "kwh_today (tier C/D) must be required and measured",
  );

  // No derived point, no kpis — the deferral guard.
  const derived = feeder.points.filter((point) => point.kind === "derived");
  assert(
    derived.length === 0,
    `${FEEDER_CODE} authors ${derived.length} derived point(s): ${derived.map((p) => p.pointKey).join(", ")}. ${DEFERRAL_REASON}`,
  );
  assert(
    !Object.hasOwn(feeder.content ?? {}, "kpis"),
    `${FEEDER_CODE} carries content.kpis. ${DEFERRAL_REASON}`,
  );
  for (const code of DEFERRED_DERIVED_CODES) {
    assert(
      !feederKeys.has(code),
      `${FEEDER_CODE} declares "${code}", one of the six deferred derived codes. ${DEFERRAL_REASON}`,
    );
  }

  // Eleven philosophy rows, every one pair-absent (ADR 0019 Amendment 2).
  const alarms = alarmsOf(feeder);
  assert(alarms.length === 11, `plan §5 authors 11 alarm rows; the entry carries ${alarms.length}`);
  for (const alarm of alarms) {
    assert(
      !("thresholdValue" in alarm) && !("operator" in alarm),
      `alarm "${alarm.code}" carries thresholdValue/operator. B7: limit values are set per site at ` +
        "commissioning, so every row here is a philosophy row — no number, no comparator. Someone " +
        '"helpfully" filling one in is exactly what this assertion exists to refuse.',
    );
    assert(
      feederKeys.has(alarm.pointKey),
      `alarm "${alarm.code}" binds "${alarm.pointKey}", which the entry does not declare — the same ` +
        "claim assertContentRefsResolve makes at import time, made here at build time",
    );
    assert(typeof alarm.message === "string" && alarm.message.length > 0, `alarm "${alarm.code}" has no message`);
  }

  // The overload row binds current_a, not the deferred load_pct (ruled 2026-09-02).
  const overload = alarms.find((alarm) => alarm.code === "overload");
  assert(
    overload !== undefined && overload.pointKey === "current_a",
    `the overload alarm must bind current_a (load_pct is deferred); got ${String(overload?.pointKey)}`,
  );

  // Severity and category are drawn from the seeded vocabularies.
  const severities = seededSeverities();
  const categories = seededCategories();
  for (const expected of ["info", "warning", "critical"]) {
    assert(severities.has(expected), `0030 no longer seeds severity "${expected}" — the parser or the migration moved`);
  }
  for (const expected of ["safety", "energy", "comfort", "operations"]) {
    assert(categories.has(expected), `0029 no longer seeds category "${expected}" — the parser or the migration moved`);
  }
  for (const alarm of alarms) {
    assert(
      severities.has(alarm.severity),
      `alarm "${alarm.code}" has severity "${alarm.severity}", which 0030 does not seed (${[...severities].join(", ")})`,
    );
    assert(
      typeof alarm.category === "string" && categories.has(alarm.category),
      `alarm "${alarm.code}" has category "${String(alarm.category)}", which 0029 does not seed (${[...categories].join(", ")})`,
    );
  }

  // ADR 0052 decision 6: the stamp plus the citation IS the provenance.
  assert(
    typeof feeder.description === "string" && feeder.description.includes(TAG_LIST_REL),
    `${FEEDER_CODE}.description must cite ${TAG_LIST_REL} by name — the stamp plus the citation is ` +
      "the provenance (ADR 0052 decision 6); there is no meta.provenance to fall back on",
  );
}
