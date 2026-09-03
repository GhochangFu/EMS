import { CALC_DIALECT, parseFormula, stockAssetTemplateDtoSchema, validateFormula } from "@bms/shared";

import {
  maintenanceCategorySchema,
  maintenanceGenerationModeSchema,
  maintenancePrioritySchema,
} from "../../../maintenance/maintenance.schema";
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
 *    not on the first import. `F2.12` Task 3 widened this half: the alarm,
 *    tier, provenance, derived-point, KPI and maintenance-vocabulary claims
 *    below were `electrical-feeder`'s and are now every entry's, so the five
 *    classes pass C authors land against them the moment they join the pack.
 *  - **Entry-specific, for `electrical-feeder`** — each one is a claim about
 *    `docs/electrical-derived-taglist-v1.md` §1, not about the code. If the
 *    tag list changes, these change with it, in the same PR. **The feeder's
 *    deferral half is not here**: its "no derived point, no `content.kpis`"
 *    guard moved to `stock-catalog-deferrals.spec.ts` with `DEFERRAL_REASON`,
 *    the text it fails with.
 *
 * **The deferral ledger lives in `stock-catalog-deferrals.spec.ts`** —
 * `STOCK_ENTRY_CODES`, `DEFERRED_DERIVED_CODES`, `deferralReason` and the
 * per-entry loop that runs them, moved by `E5.2` Task 1 because `E5.1` §13 item
 * 12 measured this file at 978 lines against the §4.5 1000-line cap and the
 * mechanical pack's six lists would have crossed it. That file imports `assert`
 * and `requireStockEntry` from here; nothing here imports from it.
 *
 * **Two vocabularies are read out of their migrations, never retyped**, the
 * discipline the dashboard sibling holds: `0030` seeds `bms.alarm_severities`,
 * `0029` seeds `bms.rule_categories`, and `assertTemplateAlarmVocabularies`
 * closes both at create time. Asserting against the parsed sets means a
 * severity nobody seeds fails here first.
 */

/**
 * Exported for `electrical-classes.spec.ts` — `F2.12` pass C puts the
 * per-class blocks in a sibling file (this one is at the §4.5 cap) and they
 * assert the same way rather than growing a second vocabulary of helpers.
 */
export function assert(condition: boolean, message: string): void {
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

/**
 * Memoized, because `F2.12` moved the alarm vocabulary checks into
 * `checkEntry`, which runs over every entry and both fixtures — otherwise each
 * call re-reads and re-parses two migration files. The memo caches the parsed
 * set, never the decision to check: `seededCodes` still throws on no match, so
 * a reshaped insert is still a failure and not a vacuously empty set.
 */
let severityMemo: ReadonlySet<string> | undefined;
const severityVocabulary = (): ReadonlySet<string> => (severityMemo ??= seededSeverities());
let categoryMemo: ReadonlySet<string> | undefined;
const categoryVocabulary = (): ReadonlySet<string> => (categoryMemo ??= seededCategories());

/** A synthetic organization for the create-body parse. Never written anywhere. */
const SYNTHETIC_ORGANIZATION_ID = "00000000-0000-4000-8000-00000000f213";

const FEEDER_CODE = "electrical-feeder";

/**
 * **One source document per pack, keyed by the entry code's pack prefix** —
 * `E5.1` Task 2, generalising `F2.13`'s single `TAG_LIST_REL` constant.
 *
 * ADR 0052 decision 6: the stamp plus the citation IS the provenance, and there
 * is no `meta.provenance` to fall back on. `F2.13` shipped one pack, so one
 * hardcoded document name was the whole rule; a water entry citing
 * `e5.1-derived-taglist-v1.md` cannot pass a constant that spells the
 * electrical one.
 *
 * **A map and not a two-element list, and that is the load-bearing part.** The
 * lookup below **fails when the prefix is absent** rather than returning
 * `undefined` and skipping the citation. A skipping lookup would make every
 * entry of an undeclared pack pass while checking none of them — a check that
 * has quietly become a decoration, which is the exact failure a pack shipping
 * its entries before declaring its source document would otherwise cause.
 * `UNKNOWN_PACK_FIXTURE` below is what proves the refusal can fire, and it
 * sits on the `undeclared` prefix precisely so that no future pack can turn it
 * into a positive fixture by declaring the one it was written against.
 */
const PACK_SOURCE_DOC: Readonly<Record<string, string>> = {
  electrical: "electrical-derived-taglist-v1.md",
  water: "e5.1-derived-taglist-v1.md",
  // **One document, two prefixes, and that is deliberate rather than a
  // duplicate.** `E5.2`'s tag list covers six machine classes across two
  // domains, and ADR 0053 decision 2 files the chiller and the AHU under
  // `hvac` — the domain whose keys they already reuse — while the pump, VFD,
  // compressor and boiler are `mechanical`. The prefix names the DOMAIN, the
  // value names the SOURCE, and the two are not the same axis: a pack is one
  // document, one index (`mechanical.ts`) and, here, two prefixes. Splitting
  // the pack in two to make the map look one-to-one would have needed a second
  // index and a second story about where two `hvac-` modules live.
  hvac: "e5.2-derived-taglist-v1.md",
  mechanical: "e5.2-derived-taglist-v1.md",
  // **One document, TWO prefixes here — and a THIRD prefix this map cannot
  // express.** `E5.3`'s tag list covers nine classes across three domains. Two
  // of the three are declared below: ADR 0054 decision 2 files the indoor air
  // quality node under `environment` — the domain whose vocabulary already holds
  // its temperature and humidity keys — and everything else in PR 1 under
  // `facility`, the seventh `bms.asset_domains` row.
  //
  // The third is `mechanical`, for the lift and the escalator, and **that prefix
  // already belongs to `e5.2-derived-taglist-v1.md` two lines above** — which is
  // what `ENTRY_SOURCE_DOC` below exists for. **Do not "fix" it by re-prefixing
  // the two entries or by re-pointing `mechanical` here**: the prefix names the
  // DOMAIN and both machines are mechanical, and re-pointing would leave `E5.2`'s
  // six entries citing the wrong document instead.
  facility: "e5.3-derived-taglist-v1.md",
  environment: "e5.3-derived-taglist-v1.md",
};

/**
 * **Per-ENTRY overrides, consulted before the prefix map** — `E5.3` Task 11,
 * ADR 0054 decision 2.
 *
 * The prefix names the DOMAIN and the value names the SOURCE DOCUMENT. For
 * twenty-five entries those two axes coincided; at `mechanical-lift` and
 * `mechanical-escalator` they stop. Both machines are `mechanical` — the domain
 * their motor, energy and vibration codes already live in — and both are
 * transcribed from `e5.3-derived-taglist-v1.md`, while the `mechanical` prefix
 * above belongs to `E5.2`'s document and must keep belonging to it for `E5.2`'s
 * six entries. Without an override the two would be checked against the `E5.2`
 * handout and **pass**, which is worse than an unchecked entry: a citation check
 * pointing at the wrong document reads as provenance and is not.
 *
 * The prefix map stays the DEFAULT so twenty-five entries keep one line each.
 * **Every key here must be a declared stock entry** — an override keyed on a
 * code nobody ships checks nothing, forever — and `stock-catalog-deferrals.spec.ts`
 * holds that claim against `STOCK_ENTRY_CODES`.
 */
export const ENTRY_SOURCE_DOC: Readonly<Record<string, string>> = {
  "mechanical-lift": "e5.3-derived-taglist-v1.md",
  "mechanical-escalator": "e5.3-derived-taglist-v1.md",
};

/** The pack an entry belongs to — everything before the first `-` in its code. */
const packOf = (code: string): string => code.split("-")[0] ?? "";

/**
 * The document an entry's rows were transcribed from: its own override if it
 * carries one, otherwise its pack's. `undefined` for neither, and `checkEntry`
 * FAILS on `undefined` rather than skipping the citation.
 */
const sourceDocOf = (code: string): string | undefined => ENTRY_SOURCE_DOC[code] ?? PACK_SOURCE_DOC[packOf(code)];

export type Alarm = { code: string; pointKey: string; severity: string; category?: string } & Record<
  string,
  unknown
>;

/** A `content.kpis[]` entry, as stored. `unit` is optional by design. */
export type Kpi = {
  code: string;
  name: string;
  pointKeys: string[];
  expression: string;
  dialect: string;
} & Record<string, unknown>;

/**
 * A `content.maintenance[]` entry, as stored. The three vocabulary fields are
 * optional on THIS type and not on the authored one: `maintenanceOf` reaches
 * `content` through a cast, so the type here is a claim rather than a check
 * and the assertions below treat a missing field as a failure. On the authored
 * side all three are required — `CreateAssetTemplateBody` is `z.infer`, the
 * *output* type, and `templateMaintenancePlanSchema`'s `.default()` lands on
 * the output side.
 */
export type MaintenancePlan = {
  title: string;
  category?: string;
  generationMode?: string;
  priority?: string;
} & Record<string, unknown>;

/** The alarms of an entry, as stored — `content` is a bare record on the DTO side. */
export function alarmsOf(entry: StockAssetTemplateEntry): Alarm[] {
  const content = (entry.content ?? {}) as { alarms?: Alarm[] };
  return content.alarms ?? [];
}

/** The KPIs of an entry, as stored. */
export function kpisOf(entry: StockAssetTemplateEntry): Kpi[] {
  const content = (entry.content ?? {}) as { kpis?: Kpi[] };
  return content.kpis ?? [];
}

/** The maintenance plans of an entry, as stored. */
export function maintenanceOf(entry: StockAssetTemplateEntry): MaintenancePlan[] {
  const content = (entry.content ?? {}) as { maintenance?: MaintenancePlan[] };
  return content.maintenance ?? [];
}

/**
 * One maintenance vocabulary field, against the enum `apps/api` already owns.
 * **Imported from `maintenance.schema`, never restated** (§4.8) — the same
 * discipline the severity and category parsers hold from the migration side.
 *
 * `undefined` FAILS rather than passing. The three fields carry a schema
 * default, and a default lands on `z.infer`'s output type, so the authored
 * literal must carry all three — a missing one means the cast in
 * `maintenanceOf` is lying about the shape.
 */
function assertMaintenanceVocabulary(
  where: string,
  field: string,
  value: unknown,
  options: readonly string[],
): void {
  assert(
    typeof value === "string" && options.includes(value),
    `${where}: maintenance ${field} "${String(value)}" is not one of the vocabulary ` +
      `apps/api/src/maintenance/maintenance.schema owns (${options.join(", ")})`,
  );
}

/**
 * Every claim that holds for ANY entry. Throws on the first violation, naming
 * the entry — bisecting a pack by hand is not a review strategy.
 *
 * Run over the shipped catalog AND over the two inline fixtures below, so an
 * empty catalog (which `F2.12` may create while reorganising the packs) cannot
 * turn this whole function into a `for` over nothing.
 *
 * **Exported since `E5.3` Task 11** so a per-class spec can run it over a
 * deliberately miscited COPY of a shipped entry — the only way to prove that
 * `ENTRY_SOURCE_DOC`, and not the prefix default, decides that entry's source.
 * Never call it on a REAL entry: the loop below already checks every one.
 */
export function checkEntry(entry: StockAssetTemplateEntry): void {
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

  // **And the same keys — in both directions.** `stockAssetTemplateDtoSchema`
  // is a non-strict `z.object`, so `list()`'s `.parse` *strips* any key the
  // shared schema lacks and stays green. A count check catches only the
  // shared-permits/API-refuses direction; this catches the other one: `F2.12`
  // adds a field to `templatePointBodySchema` and forgets the DTO mirror in
  // `packages/shared/src/contracts/admin.ts`, and `GET stock` silently omits
  // what the import writes. Found by the `F2.13` code review.
  if (listed.success) {
    assertSameKeys(entry.code, "entry", entry, listed.data);
    entry.points.forEach((point, i) => {
      assertSameKeys(`${entry.code}.points[${i}]`, "point", point, listed.data.points[i]);
    });
  }

  // ADR 0052 decision 6: the stamp plus the citation IS the provenance. Every
  // entry cites its source document by name; there is no meta.provenance to
  // fall back on. Feeder-only until F2.12 Task 3; one document per PACK since
  // E5.1 Task 2, plus a per-ENTRY override since E5.3 Task 11.
  //
  // **The missing-prefix branch is the point of the map.** It fails rather than
  // skipping, so a pack that ships entries without declaring its source is a
  // build failure and not a silently uncited pack.
  const pack = packOf(entry.code);
  const sourceDoc = sourceDocOf(entry.code);
  assert(
    sourceDoc !== undefined,
    `${entry.code}: no ENTRY_SOURCE_DOC override and no PACK_SOURCE_DOC entry for the pack ` +
      `prefix "${pack}", so this entry's provenance is checked against nothing. Add the pack ` +
      "and the document its rows are transcribed from to PACK_SOURCE_DOC — or, if this entry's " +
      "domain prefix belongs to another pack's document, add the code to ENTRY_SOURCE_DOC — a " +
      "lookup that returned undefined and skipped the citation would make every entry of this " +
      "pack pass while checking none (ADR 0052 decision 6: the stamp plus the citation IS the " +
      `provenance). Declared packs: ${Object.keys(PACK_SOURCE_DOC).join(", ")}.`,
  );
  assert(
    typeof entry.description === "string" && entry.description.includes(sourceDoc ?? ""),
    `${entry.code}.description must cite ${String(sourceDoc)} by name — the stamp plus the ` +
      "citation is the provenance (ADR 0052 decision 6); there is no meta.provenance to fall " +
      "back on",
  );

  const declaredKeys = new Set(entry.points.map((point) => point.pointKey));
  const measuredKeys = new Set(
    entry.points.filter((point) => point.kind === "measured").map((point) => point.pointKey),
  );

  for (const point of entry.points) {
    const tier = point.meta?.tier;

    // **meta.tier is present if and only if kind === "measured"** (plan §5).
    // This REPLACES F2.13's `(required && core) || (!required && extended)`,
    // which could not express a `manual` row and would have refused all seven
    // of them. It is a generalisation, not a weakening: it says strictly more,
    // because it now also constrains derived points.
    assert(
      (point.kind === "measured") === (tier !== undefined),
      `${entry.code}.${point.pointKey}: meta.tier is present if and only if kind is "measured" — ` +
        `got kind="${point.kind}", tier=${String(tier)}. The tag list's C/X/M column says what the ` +
        "plant has FITTED, and a computed point is fitted by nobody.",
    );

    if (point.kind === "measured") {
      assert(
        point.required === (tier === "core"),
        `${entry.code}.${point.pointKey}: required=${point.required} but tier="${String(tier)}" — ` +
          "tier C is core AND required; X and M are extended/manual AND optional (ADR 0040 " +
          "decision 3, and the tag list's own column)",
      );
      continue;
    }

    // A derived point, well-formed at build time — the same rules
    // `templatePointsBodySchema`'s superRefine makes at import time, which is
    // the whole reason this spec file exists.
    assert(
      typeof point.formula === "string" && point.formula.length > 0,
      `${entry.code}.${point.pointKey}: a derived point must carry a non-empty formula`,
    );
    assert(
      point.formulaDialect === CALC_DIALECT,
      `${entry.code}.${point.pointKey}: formulaDialect must be "${CALC_DIALECT}", got ${String(point.formulaDialect)}`,
    );
    assert(
      point.calcTrigger === "streaming",
      `${entry.code}.${point.pointKey}: a stock derived point is computed on arrival — calcTrigger ` +
        `must be "streaming", got ${String(point.calcTrigger)}`,
    );
    assert(
      point.calcIntervalSeconds === null,
      `${entry.code}.${point.pointKey}: a streaming point must not carry calcIntervalSeconds ` +
        `(${String(point.calcIntervalSeconds)}) — templatePointBodySchema refuses the pair outright`,
    );

    const formula = typeof point.formula === "string" ? point.formula : "";
    if (!validateFormula(formula, measuredKeys).ok) {
      const parsed = parseFormula(formula);
      const detail = parsed.ok
        ? `it references ${parsed.refs
            .filter((ref) => !measuredKeys.has(ref))
            .map((ref) => `"${ref}"`)
            .join(", ")}, which this entry does not declare as a MEASURED point`
        : `it does not parse under ${CALC_DIALECT}: ${parsed.errors
            .map((error) => `${error.code} at ${error.position}`)
            .join("; ")}`;
      throw new Error(
        `${entry.code}.${point.pointKey}: formula "${formula}" is not usable — ${detail}. A derived ` +
          "point may only reference a measured point the same template declares (ADR 0036 " +
          "decision 7); assertPointKeysActive and the calc engine both depend on it.",
      );
    }
  }

  // Every alarm is a philosophy row, bound to a key the entry declares, with a
  // severity and a category the migrations seed. All four were feeder-only
  // until F2.12 Task 3; every one is a property of a STOCK catalog under B7,
  // not of one class.
  const severities = severityVocabulary();
  const categories = categoryVocabulary();
  for (const alarm of alarmsOf(entry)) {
    assert(
      !("thresholdValue" in alarm) && !("operator" in alarm),
      `${entry.code} alarm "${alarm.code}" carries thresholdValue/operator. B7: limit values are ` +
        "set per site at commissioning, so every row here is a philosophy row — no number, no " +
        'comparator. Someone "helpfully" filling one in is exactly what this assertion refuses.',
    );
    assert(
      declaredKeys.has(alarm.pointKey),
      `${entry.code} alarm "${alarm.code}" binds "${alarm.pointKey}", which the entry does not ` +
        "declare — the same claim assertContentRefsResolve makes at import time, made here at " +
        "build time",
    );
    assert(
      typeof alarm.message === "string" && alarm.message.length > 0,
      `${entry.code} alarm "${alarm.code}" has no message — the message IS the meaning, because ` +
        "the threshold pair is deliberately absent",
    );
    assert(
      severities.has(alarm.severity),
      `${entry.code} alarm "${alarm.code}" has severity "${alarm.severity}", which 0030 does not ` +
        `seed (${[...severities].join(", ")})`,
    );
    assert(
      typeof alarm.category === "string" && categories.has(alarm.category),
      `${entry.code} alarm "${alarm.code}" has category "${String(alarm.category)}", which 0029 ` +
        `does not seed (${[...categories].join(", ")})`,
    );
  }

  // Every KPI, both directions — `templateKpiSchema`'s superRefine at build
  // time, plus the one claim no schema makes: a KPI's pointKeys must be keys
  // THIS entry declares. `collectContentPointRefs` feeds that check to
  // `assertContentRefsResolve` at import time, on a running database.
  for (const kpi of kpisOf(entry)) {
    assert(
      kpi.dialect === CALC_DIALECT,
      `${entry.code} KPI "${kpi.code}" has dialect "${kpi.dialect}" — a stock KPI is always ` +
        `"${CALC_DIALECT}". "unvalidated" is an affordance for hand-authored content, not for a ` +
        "catalog whose expressions ship to every organization unread.",
    );
    for (const key of kpi.pointKeys) {
      assert(
        declaredKeys.has(key),
        `${entry.code} KPI "${kpi.code}" names pointKey "${key}", which the entry does not declare ` +
          "— the same claim assertContentRefsResolve makes at import time, made here at build time",
      );
    }
    const validated = validateFormula(kpi.expression, kpi.pointKeys);
    assert(
      validated.ok,
      `${entry.code} KPI "${kpi.code}" expression "${kpi.expression}" is not a ${CALC_DIALECT} ` +
        "formula over its own pointKeys — every {ref} in expression must appear in pointKeys",
    );
    if (validated.ok) {
      const used = new Set(validated.refs);
      const unused = kpi.pointKeys.filter((key) => !used.has(key));
      assert(
        unused.length === 0,
        `${entry.code} KPI "${kpi.code}" lists pointKeys its expression never uses ` +
          `(${unused.join(", ")}) — pointKeys is what makes a KPI queryable, so an unused member ` +
          "is a promise of a binding that does not exist",
      );
    }
  }

  // Every maintenance plan's three vocabulary fields, imported rather than
  // restated (§4.8).
  //
  // **Stated plainly, because the next reader will ask**: this loop cannot
  // currently fail before `createAssetTemplateBodySchema` does — that parse
  // runs first and `templateMaintenancePlanSchema` holds the same three enums.
  // It is reached (the fixture carries a plan) and it earns its place two
  // ways: the failure NAMES the vocabulary and the module that owns it instead
  // of returning a Zod field-error blob, and it keeps holding the line if
  // `content` is ever loosened to a passthrough record on the create body.
  for (const plan of maintenanceOf(entry)) {
    const where = `${entry.code} maintenance "${plan.title}"`;
    assertMaintenanceVocabulary(where, "category", plan.category, maintenanceCategorySchema.options);
    assertMaintenanceVocabulary(
      where,
      "generationMode",
      plan.generationMode,
      maintenanceGenerationModeSchema.options,
    );
    assertMaintenanceVocabulary(where, "priority", plan.priority, maintenancePrioritySchema.options);
  }
}

/** Key-set equality, so a stripped-by-parse field is a failure, not a silence. */
function assertSameKeys(where: string, what: string, authored: object, listed: object): void {
  const a = Object.keys(authored).sort();
  const l = Object.keys(listed).sort();
  const onlyAuthored = a.filter((k) => !l.includes(k));
  const onlyListed = l.filter((k) => !a.includes(k));
  assert(
    onlyAuthored.length === 0 && onlyListed.length === 0,
    `${where}: the listed ${what} projection and the authored ${what} disagree on keys — ` +
      `stripped by the DTO parse: [${onlyAuthored.join(", ")}]; ` +
      `present only in the projection: [${onlyListed.join(", ")}]. ` +
      "Mirror the field in stockAssetTemplateDtoSchema / stockTemplatePointDtoSchema.",
  );
}

/**
 * The shipped entry a per-class block is about — exported for
 * `electrical-classes.spec.ts`, which holds those blocks from `F2.12` pass C
 * on. A missing entry throws here rather than returning `undefined`, so a
 * class module that was authored but never added to `electrical.ts`'s index
 * fails with a message naming what the catalog does ship, instead of the block
 * quietly returning early and asserting nothing about it.
 */
export function requireStockEntry(code: string): StockAssetTemplateEntry {
  const entry = STOCK_ASSET_TEMPLATE_CATALOG.find((candidate) => candidate.code === code);
  if (!entry) {
    const shipped = STOCK_ASSET_TEMPLATE_CATALOG.map((candidate) => candidate.code).join(", ");
    throw new Error(
      `the catalog must ship "${code}" (plan §5) — found only: ${shipped || "(nothing)"}. An ` +
        "authored class module reaches the catalog only through its pack index — electrical.ts, " +
        "water.ts, mechanical.ts or facility.ts; until it is listed there, " +
        "GET /admin/asset-templates/stock cannot see it.",
    );
  }
  return entry;
}

// ---------------------------------------------------------------------------
// Inline fixtures — anti-vacuity that survives an empty catalog.
// ---------------------------------------------------------------------------

/**
 * **The fixture carries a KPI and a maintenance plan on purpose.** `F2.12`
 * Task 3 added the KPI and maintenance-vocabulary claims to `checkEntry`, and
 * the only shipped entry today — the feeder — deliberately has neither (its
 * deferral guard forbids `content.kpis`). Without these two rows both loops
 * would run zero times, go green, and pass C would author five KPIs and 21
 * plans against checks that had never executed once. That is the same reason
 * this file has fixtures at all: an empty catalog must not turn `checkEntry`
 * into a `for` over nothing.
 *
 * The `description` cites the tag list because the provenance claim is generic
 * from Task 3 on.
 *
 * **Every fixture code carries a declared pack prefix, since `E5.1` Task 2.**
 * The four were `f213-spec-*`, and `packOf("f213-spec-valid")` is `"f213"`,
 * which `PACK_SOURCE_DOC` does not declare and must not — a fixture is not a
 * pack. Renaming them to `electrical-f213-spec-*` keeps their descriptions
 * (which already cite the electrical tag list) truthful and makes them exercise
 * the real lookup instead of an exemption. The rename is not cosmetic: the
 * citation check runs BEFORE the derived and KPI loops, so an unprefixed
 * fixture would fail there first and the two negative fixtures below would stop
 * proving the rules they were written for while still going red.
 */
const VALID_FIXTURE: StockAssetTemplateEntry = {
  code: "electrical-f213-spec-valid",
  name: "Spec fixture — valid",
  assetType: "test_rig",
  domain: "electrical",
  description: "A minimal entry the checks must accept — docs/electrical-derived-taglist-v1.md §1.",
  stockVersion: 1,
  content: {
    contentVersion: 1,
    kpis: [
      {
        code: "kw_now",
        name: "Active power now",
        unit: "kW",
        pointKeys: ["kw"],
        expression: "{kw}",
        dialect: "bms-calc-v1",
        higherIsBetter: false,
      },
    ],
    maintenance: [
      {
        title: "Fixture plan",
        category: "preventive",
        generationMode: "calendar",
        priority: "medium",
        safetyCritical: false,
        estimatedMinutes: 30,
        intervalDays: 30,
      },
    ],
  },
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
    // A derived point for the same reason as the KPI above: the feeder has
    // none (its deferral guard forbids them), so without this row the whole
    // derived branch of `checkEntry` — dialect, trigger, interval, and the
    // refs-resolve-to-a-measured-point rule — would run zero times and pass C
    // would author its six formulas against a check that never executed.
    // No `meta.tier`: a computed point is fitted by nobody.
    {
      pointKey: "kw_scaled",
      label: "Active power, scaled",
      unit: "kW",
      kind: "derived",
      sourceDataKeyPattern: null,
      formula: "{kw} * 1.05",
      formulaDialect: "bms-calc-v1",
      calcTrigger: "streaming",
      calcIntervalSeconds: null,
      maxInputAgeSeconds: null,
      required: false,
      sortOrder: 1,
    },
  ],
};

const POINTLESS_FIXTURE: StockAssetTemplateEntry = {
  ...VALID_FIXTURE,
  code: "electrical-f213-spec-pointless",
  points: [],
};

/**
 * The negative fixture for the KPI half — it proves the check can FAIL, which
 * `VALID_FIXTURE` alone cannot, on the `POINTLESS_FIXTURE` precedent.
 *
 * The defect is deliberately the one **no schema catches**: a `pointKeys`
 * member the entry does not declare. `templateKpiSchema` validates the
 * expression against `pointKeys` and both directions between them, but it
 * never sees `points` — the declaration check is
 * `assertContentRefsResolve`'s, and that runs at import time against a running
 * database. An unused-member or bad-dialect fixture would be refused by
 * `createAssetTemplateBodySchema` first and would prove nothing about this
 * file. Here the entry declares `kw` and the KPI names `kva`.
 */
/**
 * The negative fixture for the derived half, and the same discipline: the
 * defect is one **no schema catches**. `"scheduled"` is one of the two legal
 * `calcTrigger` values and it carries a `calcIntervalSeconds` — a perfectly
 * legitimate hand-authored shape. It is not a legitimate STOCK shape: a stock
 * derived point is computed on arrival, so the catalog's own rule is
 * `streaming` with no interval, and this fixture is what proves that rule can
 * fail rather than merely being written down.
 */
const SCHEDULED_DERIVED_FIXTURE: StockAssetTemplateEntry = {
  ...VALID_FIXTURE,
  code: "electrical-f213-spec-derived-scheduled",
  points: VALID_FIXTURE.points.map((point) =>
    point.kind === "derived"
      ? { ...point, calcTrigger: "scheduled" as const, calcIntervalSeconds: 300 }
      : point,
  ),
};

/**
 * The negative fixture for the source-document check, and the whole reason
 * `PACK_SOURCE_DOC` is a **map** rather than a two-element list.
 *
 * If the prefix lookup returned `undefined` and the citation check quietly
 * skipped, an entry of an undeclared pack would pass while being checked
 * against nothing — and so would every entry of every pack after it, which is a
 * check that has become a decoration. An unknown pack prefix is a BUILD failure
 * here, and the message names the map that needs the entry.
 *
 * The defect is again one **no schema catches**: this fixture is a perfectly
 * well-formed entry whose only fault is that its pack never declared where its
 * rows were transcribed from.
 *
 * **The prefix must be one no pack will ever claim, and `undeclared` is that
 * prefix.** This fixture read `mechanical-chiller` until `E5.2` Task 1, chosen
 * *because* `mechanical` was an undeclared prefix at the time. `E5.2` declares
 * both `mechanical` and `hvac` in Task 5 (and its chiller is ruled
 * `hvac-chiller`, not `mechanical-chiller`, ADR 0053 decision 2), so the
 * fixture would have started passing the citation check and failing on nothing
 * it was written for — a negative fixture that has silently become a positive
 * one. `facility` is `E5.3`'s and would recur the same way; `undeclared` is not
 * a domain, cannot be a pack, and is the only spelling that stays a refusal.
 *
 * **`ENTRY_SOURCE_DOC` cannot rescue it either, and that is by construction:**
 * an override is keyed on a CODE, no fixture code is in that map, and a key
 * that is not a shipped entry is refused by `stock-catalog-deferrals.spec.ts`.
 * So `sourceDocOf` still returns `undefined` here and the refusal below fires
 * on the missing prefix, exactly as it did before `E5.3` Task 11.
 */
const UNKNOWN_PACK_FIXTURE: StockAssetTemplateEntry = {
  ...VALID_FIXTURE,
  code: "undeclared-f213-spec-pack",
};

const UNDECLARED_KPI_FIXTURE: StockAssetTemplateEntry = {
  ...VALID_FIXTURE,
  code: "electrical-f213-spec-kpi-undeclared",
  content: {
    contentVersion: 1,
    kpis: [
      {
        code: "kva_now",
        name: "Apparent power now",
        unit: "kVA",
        pointKeys: ["kva"],
        expression: "{kva}",
        dialect: "bms-calc-v1",
      },
    ],
  },
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

  let scheduledDerivedRefused: string | null = null;
  try {
    checkEntry(SCHEDULED_DERIVED_FIXTURE);
  } catch (err) {
    scheduledDerivedRefused = err instanceof Error ? err.message : String(err);
  }
  assert(
    scheduledDerivedRefused !== null && /calcTrigger/.test(scheduledDerivedRefused),
    "a scheduled derived point must be refused by checkEntry, naming the rule — got " +
      String(scheduledDerivedRefused),
  );

  // The source-document check, and the failure mode a hardcoded constant could
  // not express: a pack that ships entries without declaring where its rows
  // were transcribed from. `F2.13` shipped one tag list and one constant; from
  // `E5.1` on there are two documents, and the third one arrives with `E5.2`.
  // **Unchanged by `E5.3` Task 11's override and it must STAY unchanged** —
  // both halves of `sourceDocOf` miss on this fixture (see its docblock).
  let unknownPackRefused: string | null = null;
  try {
    checkEntry(UNKNOWN_PACK_FIXTURE);
  } catch (err) {
    unknownPackRefused = err instanceof Error ? err.message : String(err);
  }
  assert(
    unknownPackRefused !== null && /PACK_SOURCE_DOC/.test(unknownPackRefused),
    "an entry whose code carries a pack prefix PACK_SOURCE_DOC does not declare must be refused " +
      "by checkEntry, naming the map entry that is missing — a lookup that returns undefined and " +
      `skips the citation makes every entry of that pack pass while checking none. Got ${String(unknownPackRefused)}`,
  );

  let undeclaredKpiRefused: string | null = null;
  try {
    checkEntry(UNDECLARED_KPI_FIXTURE);
  } catch (err) {
    undeclaredKpiRefused = err instanceof Error ? err.message : String(err);
  }
  assert(
    undeclaredKpiRefused !== null && /does not declare/.test(undeclaredKpiRefused),
    "a KPI naming a point key its entry does not declare must be refused by checkEntry, naming " +
      `the rule — got ${String(undeclaredKpiRefused)}`,
  );

  // The two migration-parsed vocabularies are checked for EVERY entry now, so
  // their own anti-vacuity check belongs here rather than in the feeder block.
  const severities = severityVocabulary();
  const categories = categoryVocabulary();
  for (const expected of ["info", "warning", "critical"]) {
    assert(severities.has(expected), `0030 no longer seeds severity "${expected}" — the parser or the migration moved`);
  }
  for (const expected of ["safety", "energy", "comfort", "operations"]) {
    assert(categories.has(expected), `0029 no longer seeds category "${expected}" — the parser or the migration moved`);
  }

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

  // The tier marking is `checkEntry`'s from F2.12 Task 3 on — the iff rule
  // there subsumes the C/X pair this block used to assert, and says more (it
  // also constrains `manual` rows and derived points, which the old rule could
  // not express). What stays feeder-specific is §1's own claim: no M row.
  const manual = feeder.points.filter((point) => point.meta?.tier === "manual");
  assert(
    manual.length === 0,
    `tag list §1 has no M column — ${FEEDER_CODE} marks ${manual.map((p) => p.pointKey).join(", ")} manual`,
  );

  // kwh_today is C/D and authored MEASURED (plan §5): no bms-calc-v1 formula
  // can express energy-today, and a placeholder is the guessing ADR 0019 refuses.
  const kwhToday = feeder.points.find((point) => point.pointKey === "kwh_today");
  assert(
    kwhToday !== undefined && kwhToday.required && kwhToday.kind === "measured",
    "kwh_today (tier C/D) must be required and measured",
  );

  // The feeder's "no derived point, no kpis" guard moved to
  // `stock-catalog-deferrals.spec.ts` with the ledger it cites — it is a
  // deferral claim, and `DEFERRAL_REASON` is the text it fails with.

  // Eleven philosophy rows. Pair-absence, the binding, the message, the
  // severity and the category are `checkEntry`'s from F2.12 Task 3 on — every
  // one of them is a property of a STOCK catalog, not of this class. The count
  // is §1's own claim and stays here.
  const alarms = alarmsOf(feeder);
  assert(alarms.length === 11, `plan §5 authors 11 alarm rows; the entry carries ${alarms.length}`);

  // The overload row binds current_a, not the deferred load_pct (ruled 2026-09-02).
  const overload = alarms.find((alarm) => alarm.code === "overload");
  assert(
    overload !== undefined && overload.pointKey === "current_a",
    `the overload alarm must bind current_a (load_pct is deferred); got ${String(overload?.pointKey)}`,
  );

}
