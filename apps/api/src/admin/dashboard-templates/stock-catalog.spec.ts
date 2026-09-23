import {
  DASHBOARD_GRID,
  metricCatalogKeySchema,
  sectionTemplateContentSchema,
  stockDashboardTemplateDtoSchema,
  SUSTAINABILITY_WATER_POINT_KEYS,
  WIDGET_POINT_CARDINALITY,
  WIDGET_SOURCE_CARDINALITY,
} from "@bms/shared";

import { stockCodeParamSchema } from "../admin.schema";
import { readRepoFile } from "../../testing/repo-root";
import { STOCK_DASHBOARD_TEMPLATE_CATALOG } from "./stock-catalog";

/**
 * `F3.36` Part D — the stock dashboard template catalog (ADR 0049 decision 3).
 *
 * Assertions live here (ADR 0014); `stock-catalog.test.ts` is the thin Vitest
 * entry point.
 *
 * **Two vocabularies are read out of their migrations AT TEST TIME, never
 * retyped.** `packages/db/drizzle/0056_dashboard_templates.sql` seeds the six
 * `bms.dashboard_sections` codes, while `bms.asset_roles` is seeded by TWO
 * migrations since `F3.40` — `0051`'s 26 codes and `0060`'s `meter` and `pump`
 * — and `seededRoles()` takes the union. Parsing them here is what keeps this
 * catalog and those seeded tables from drifting apart silently, the same
 * discipline `tests/f3.37-asset-role-vocabulary.test.ts` and
 * `tests/f3.35-metric-catalog-schema.test.ts` already hold for their own
 * vocabularies.
 */

/**
 * Repo root, found from `process.cwd()` rather than `import.meta.url`.
 *
 * `apps/api` compiles with `"module": "commonjs"` (its own `tsconfig.json`),
 * which refuses `import.meta` outright — `tests/f3.37-asset-role-vocabulary.test.ts`
 * can use it because the top-level `tests/` directory typechecks under a
 * separate, ESM-flavoured invocation (`typecheck:tests`'s own `tsc --module
 * esnext` line). `pnpm --filter api exec vitest run` sets the working
 * directory to `apps/api`, so two levels up is the repo root.
 */
const read = readRepoFile;

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * The codes an `INSERT INTO bms.<table> (code, ...) VALUES ( ... ), ( ... )
 * ON CONFLICT DO NOTHING;` block seeds, parsed from the migration text.
 *
 * Both `0051` and `0056` share this exact shape — `code` is always the FIRST
 * quoted string of each parenthesised row — so one parser serves both
 * vocabularies. Throwing on no match is load-bearing: an empty result would
 * make every subset check below vacuously true the moment the insert is
 * reshaped, which is ADR 0025's recorded class of test that agrees with
 * whatever it finds.
 */
function seededCodes(migration: string, table: string): string[] {
  const startNeedle = `INSERT INTO bms.${table} (`;
  const start = migration.indexOf(startNeedle);
  if (start < 0) {
    throw new Error(`no INSERT INTO bms.${table} found — fix this parser, do not delete it`);
  }
  const end = migration.indexOf("ON CONFLICT DO NOTHING;", start);
  if (end < 0) {
    throw new Error(`unterminated INSERT INTO bms.${table} — expected a trailing ON CONFLICT`);
  }
  const block = migration.slice(start, end);
  const codes = [...block.matchAll(/\(\s*'([a-z0-9-]+)'/g)].map((m) => m[1] as string);
  if (codes.length === 0) {
    throw new Error(`parsed zero codes out of the bms.${table} insert — the parser is broken`);
  }
  return codes;
}

const seededSections = (): string[] =>
  seededCodes(read("packages/db/drizzle/0056_dashboard_templates.sql"), "dashboard_sections");

/**
 * `bms.asset_roles` is seeded by MORE THAN ONE migration since `F3.40`, so this
 * reads every one of them and takes the union. `0051` seeds 26 codes and `0060`
 * adds `meter` and `pump`. Reading only the first would make a catalog entry
 * bound to either of those two look like an unknown code, which is the reverse
 * of what this check exists to catch.
 */
const seededRoles = (): string[] => [
  ...seededCodes(read("packages/db/drizzle/0051_asset_role_vocabulary.sql"), "asset_roles"),
  ...seededCodes(read("packages/db/drizzle/0060_asset_role_estate_shapes.sql"), "asset_roles"),
];

export function runStockCatalogTests(): void {
  // ---- every entry parses under the frozen contract ------------------------

  for (const entry of STOCK_DASHBOARD_TEMPLATE_CATALOG) {
    const parsed = stockDashboardTemplateDtoSchema.parse(entry);
    // `sectionTemplateContentSchema` is also what `stockDashboardTemplateDtoSchema.content`
    // parses through, so this is deliberately redundant with the line above —
    // stated because the plan calls it out as its own bullet, not because the
    // first parse leaves it unchecked.
    sectionTemplateContentSchema.parse(entry.content);
    assert(
      parsed.code === entry.code,
      `stockDashboardTemplateDtoSchema rejected or rewrote ${entry.code}`,
    );
  }

  // ---- exactly seven entries, unique codes, the literal list itself --------

  assert(
    STOCK_DASHBOARD_TEMPLATE_CATALOG.length === 7,
    `expected exactly seven stock templates, found ${STOCK_DASHBOARD_TEMPLATE_CATALOG.length}`,
  );

  const codes = STOCK_DASHBOARD_TEMPLATE_CATALOG.map((entry) => entry.code);
  assert(new Set(codes).size === codes.length, `duplicate stock template code in ${codes.join(",")}`);

  // A LITERAL LIST, ON PURPOSE — the opposite call from `0051`'s own header.
  // `0051` refuses to retype its 26 role codes anywhere outside the
  // migration, because a role is a ROW a later INSERT can add to. The catalog
  // files are these codes' ONLY source, so this literal list is not a copy
  // of a vocabulary this test does not own — it IS the specification, and an
  // eighth landing here with this line unchanged is exactly the silent
  // addition that discipline exists to catch one layer over.
  //
  // **`F3.41` EXTENDED IT AND DID NOT RELAX IT**, which is what its backlog row
  // asks for in those words. `electrical-metered-pumping` is INSERTED rather
  // than appended, because `codes.sort()` is lexicographic and `m` sorts before
  // `o` — appending it would fail this assertion while being perfectly correct,
  // and the temptation would then be to weaken the comparison.
  //
  // **Two entries now share one section**, which is ADR 0051 decision 6: the
  // catalog is keyed by section × plant shape, so a second `electrical` entry
  // is the feature rather than a duplicate. Nothing above or below asserts one
  // entry per section, and nothing should.
  assert(
    codes.sort().join(",") ===
      [
        "electrical-metered-pumping",
        "electrical-overview",
        "etp-overview",
        "hvac-overview",
        "stp-overview",
        "sustainability-overview",
        "water-overview",
      ].join(","),
    `stock template codes changed: ${codes.sort().join(",")}`,
  );

  // ---- section and role codes must exist in the seeded vocabularies --------

  const sections = seededSections();
  const roles = seededRoles();
  const catalogKeys = new Set<string>(metricCatalogKeySchema.options);

  for (const entry of STOCK_DASHBOARD_TEMPLATE_CATALOG) {
    assert(
      sections.includes(entry.section),
      `${entry.code} uses section "${entry.section}", which migration 0056 does not seed ` +
        `(seeded: ${sections.join(", ")})`,
    );

    for (const widget of entry.content.widgets) {
      // ---- role and catalog-key membership ---------------------------------

      for (const binding of widget.bindings) {
        assert(
          roles.includes(binding.assetRoleCode),
          `${entry.code}/${widget.key} binds assetRoleCode "${binding.assetRoleCode}", which ` +
            "neither migration 0051 nor 0060 seeds — this is exactly the plural/singular drift the " +
            "plan calls out (e.g. binding \"chillers\" against a vocabulary whose codes are " +
            "singular).",
        );
      }
      for (const source of widget.sources) {
        assert(
          catalogKeys.has(source.catalogKey),
          `${entry.code}/${widget.key} binds catalogKey "${source.catalogKey}", which is not a ` +
            "member of metricCatalogKeySchema.options",
        );
      }

      // ---- grid bounds, read rather than restated as a literal -------------

      assert(
        widget.gridX + widget.gridW <= DASHBOARD_GRID.columns,
        `${entry.code}/${widget.key} exceeds the ${DASHBOARD_GRID.columns}-column canvas`,
      );

      // ---- per-type binding cardinality ------------------------------------

      const pointCard = WIDGET_POINT_CARDINALITY[widget.widgetType];
      const sourceCard = WIDGET_SOURCE_CARDINALITY[widget.widgetType];
      assert(
        widget.bindings.length >= pointCard.min && widget.bindings.length <= pointCard.max,
        `${entry.code}/${widget.key} (${widget.widgetType}) has ${widget.bindings.length} point ` +
          `bindings, outside [${pointCard.min}, ${pointCard.max}]`,
      );
      assert(
        widget.sources.length >= sourceCard.min && widget.sources.length <= sourceCard.max,
        `${entry.code}/${widget.key} (${widget.widgetType}) has ${widget.sources.length} sources, ` +
          `outside [${sourceCard.min}, ${sourceCard.max}]`,
      );

      if (widget.widgetType === "table") {
        // The two halves of one statement, `dashboard-builder.ts`'s docblock:
        // a table binds a source, always, and never a point.
        assert(widget.sources.length === 1, `${entry.code}/${widget.key} table must bind one source`);
        assert(widget.bindings.length === 0, `${entry.code}/${widget.key} table must bind no points`);
      }

      if (widget.widgetType === "value_tile") {
        // Exactly one binding KIND, never both and never neither
        // (`bindingRequiredMessage` / `bindingExclusiveMessage`).
        const total = widget.bindings.length + widget.sources.length;
        assert(
          total === 1,
          `${entry.code}/${widget.key} value_tile must bind exactly one point or one metric, ` +
            `found ${widget.bindings.length} bindings and ${widget.sources.length} sources`,
        );
      }

      if (widget.widgetType === "chart") {
        assert(widget.sources.length === 0, `${entry.code}/${widget.key} chart must bind no sources`);
        assert(widget.bindings.length >= 1, `${entry.code}/${widget.key} chart must bind at least one point`);
      }
    }

    // ---- no two widgets in one template share a key ----------------------

    const keys = entry.content.widgets.map((widget) => widget.key);
    assert(
      new Set(keys).size === keys.length,
      `${entry.code} has a duplicate widget key in ${keys.join(",")}`,
    );
  }

  // ---- sustainability ships metric-catalog sources only, zero role bindings

  const sustainability = STOCK_DASHBOARD_TEMPLATE_CATALOG.find(
    (entry) => entry.section === "sustainability",
  );
  assert(sustainability !== undefined, "no stock template targets the sustainability section");
  const sustainabilityWidgetTypes = new Set(
    (sustainability?.content.widgets ?? []).map((widget) => widget.widgetType as string),
  );
  assert(
    !sustainabilityWidgetTypes.has("chart"),
    "sustainability's stock template ships a chart widget, which needs a role binding it has none of",
  );
  for (const widget of sustainability?.content.widgets ?? []) {
    assert(
      widget.bindings.length === 0,
      `sustainability's stock template binds a role on ${widget.key} — 0051 seeds no ` +
        "sustainability role band (only the five mock trains), so this must stay catalog-only",
    );
  }
}

/**
 * `E4.2` PR 2 (U8) — the `sustainability-overview` entry under test, or a
 * thrown failure naming its absence.
 *
 * **One claim per exported function below, and that is the repair, not a
 * style.** All five claims used to live in one `it()`, and `assert` throws:
 * only the FIRST failing one ever printed. The `E4.2` PR 2 review proved it —
 * `stockVersion: 1` and a wrong `aggregate` on `water-recycle-pct-tile` in the
 * same edit reported the stockVersion alone, so the aggregate claim stayed
 * unproven whenever a claim above it was also broken. Each function
 * here is registered as its own `it()` in `stock-catalog.test.ts`; adding one
 * without registering it is the vacuous shape to watch for.
 */
function sustainabilityEntry(): (typeof STOCK_DASHBOARD_TEMPLATE_CATALOG)[number] {
  const entry = STOCK_DASHBOARD_TEMPLATE_CATALOG.find(
    (row) => row.code === "sustainability-overview",
  );
  assert(entry !== undefined, "no stock template with code sustainability-overview");
  return entry as (typeof STOCK_DASHBOARD_TEMPLATE_CATALOG)[number];
}

/**
 * The three tiles KEPT from the v1 skeleton (plan §3.8) bind their own catalog
 * entries, never `sustainability.total` — every claim below scopes itself to
 * the fourteen new sustainability tiles by excluding these, and
 * `runSustainabilityKeptTilesTest` is the positive control that stops a rename
 * from dropping a tile out of every loop at once.
 */
const KEPT_TILE_KEYS = new Set(["alarms-tile", "workorders-tile", "health-tile"]);

/**
 * **The fourteen sustainability tiles, as `[widget key, pointKey, aggregate]`.**
 *
 * Restated as a literal table on purpose, and this is the one thing the first
 * draft of these claims did not do: it read `params.pointKey` only to DERIVE
 * the expected aggregate and never validated the key itself, so
 * `energy-this-year-tile` could bind `kwh_this_month` and every suite stayed
 * green while the shipped dashboard drew *Energy this month* and *Energy this
 * year* with the same number. A derived expectation cannot catch an error in
 * what it derives from.
 *
 * `aggregate` is `"sum"` except the two executive codes with no stock formula
 * (`operational_efficiency_pct`, `water_recycle_pct`, ADR 0072 decision 4),
 * which are `"avg"`: summing a percentage across sites is not the plant's
 * average. Plan §U8 enumerates the same fourteen.
 */
const SUSTAINABILITY_TILE_BINDINGS: ReadonlyArray<
  readonly [string, string, string, string | undefined]
> = [
  // Row A — today
  ["energy-today-tile", "kwh_today", "sum", undefined],
  ["energy-cost-today-tile", "energy_cost_today", "sum", undefined],
  ["water-today-tile", "kl_today", "sum", "intake"],
  ["co2-today-tile", "co2_kg_today", "sum", undefined],
  ["water-recycle-pct-tile", "water_recycle_pct", "avg", undefined],
  ["operational-efficiency-pct-tile", "operational_efficiency_pct", "avg", undefined],
  // Row B — this month
  ["energy-this-month-tile", "kwh_this_month", "sum", undefined],
  ["energy-cost-this-month-tile", "energy_cost_this_month", "sum", undefined],
  ["water-this-month-tile", "kl_this_month", "sum", "intake"],
  ["co2-this-month-tile", "co2_kg_this_month", "sum", undefined],
  // Row C — this year
  ["energy-this-year-tile", "kwh_this_year", "sum", undefined],
  ["energy-cost-this-year-tile", "energy_cost_this_year", "sum", undefined],
  ["water-this-year-tile", "kl_this_year", "sum", "intake"],
  ["co2-this-year-tile", "co2_kg_this_year", "sum", undefined],
];

/** `sustainability-overview` is `stockVersion: 4` (`E4.3` PR 2, U10, ADR 0073 decision 2). */
export function runSustainabilityStockVersionTest(): void {
  const entry = sustainabilityEntry();
  assert(
    entry.stockVersion === 4,
    `sustainability-overview must be stockVersion 4 (E4.3 PR 2, U10 — balanceRole: "intake" on ` +
      `the four water bindings, and the new water-balance-by-site-table) — got ${String(entry.stockVersion)}`,
  );
}

/** `sustainability-overview` carries 19 widgets: 6 + 6 + 5 tiles and 2 tables. */
export function runSustainabilityWidgetCountTest(): void {
  const entry = sustainabilityEntry();
  assert(
    entry.content.widgets.length === 19,
    `sustainability-overview must carry 19 widgets (6 today + 6 this-month + 5 this-year + 2 ` +
      `tables) — got ${entry.content.widgets.length}`,
  );
}

/** Every new `value_tile` binds one `sustainability.total`; the benchmark table binds `sustainability.by_location`. */
export function runSustainabilityCatalogKeysTest(): void {
  const entry = sustainabilityEntry();
  for (const widget of entry.content.widgets) {
    if (
      widget.widgetType === "value_tile" &&
      !KEPT_TILE_KEYS.has(widget.key)
    ) {
      assert(
        widget.sources.length === 1 && widget.sources[0]?.catalogKey === "sustainability.total",
        `${widget.key} must bind exactly one sustainability.total source — got ` +
          `${widget.sources.map((source) => source.catalogKey).join(", ") || "(none)"}`,
      );
    }
  }
}

/**
 * The benchmark table's own `params` are pinned here and not in
 * `SUSTAINABILITY_TILE_BINDINGS`: it repeats `kl_today`, which the
 * fourteen-distinct-keys claim there would refuse.
 */
export function runBenchmarkTableBindingTest(): void {
  const entry = sustainabilityEntry();
  const widget = entry.content.widgets.find((row) => row.key === "benchmark-by-site-table");
  const params = widget?.sources[0]?.params as
    | { pointKey?: string; aggregate?: string; balanceRole?: string }
    | undefined;
  assert(
    widget !== undefined &&
      widget.widgetType === "table" &&
      widget.sources.length === 1 &&
      widget.sources[0]?.catalogKey === "sustainability.by_location" &&
      params?.pointKey === "kl_today" &&
      params?.aggregate === "sum" &&
      params?.balanceRole === "intake",
    `benchmark-by-site-table must bind sustainability.by_location with ` +
      `{ pointKey: "kl_today", aggregate: "sum", balanceRole: "intake" } — got ` +
      `${widget === undefined ? "(no such widget)" : JSON.stringify(params ?? null)}`,
  );
}

/**
 * The new `water.balance` table (`E4.3` PR 2, U10, ADR 0073 decision 3, Q5
 * ruling — `period: "this_month"`).
 */
export function runWaterBalanceTableBindingTest(): void {
  const entry = sustainabilityEntry();
  const widget = entry.content.widgets.find((row) => row.key === "water-balance-by-site-table");
  const params = widget?.sources[0]?.params as { period?: string } | undefined;
  assert(
    widget !== undefined &&
      widget.widgetType === "table" &&
      widget.sources.length === 1 &&
      widget.sources[0]?.catalogKey === "water.balance" &&
      params?.period === "this_month" &&
      Object.keys(params ?? {}).length === 1,
    `water-balance-by-site-table must bind water.balance with { period: "this_month" } and ` +
      `nothing else — got ${widget === undefined ? "(no such widget)" : JSON.stringify(params ?? null)}`,
  );
}

/** Each of the fourteen tiles binds the `pointKey` its title names, with its own `aggregate` and `balanceRole`. */
export function runSustainabilityTileBindingsTest(): void {
  const entry = sustainabilityEntry();
  for (const [key, pointKey, aggregate, balanceRole] of SUSTAINABILITY_TILE_BINDINGS) {
    const widget = entry.content.widgets.find((row) => row.key === key);
    const params = widget?.sources[0]?.params as
      | { pointKey?: string; aggregate?: string; balanceRole?: string }
      | undefined;
    assert(
      params?.pointKey === pointKey &&
        params?.aggregate === aggregate &&
        params?.balanceRole === balanceRole,
      `${key} must bind { pointKey: "${pointKey}", aggregate: "${aggregate}", balanceRole: ` +
        `${JSON.stringify(balanceRole)} } — got ` +
        `${widget === undefined ? "(no such widget)" : JSON.stringify(params ?? null)}. The two ` +
        "executive codes (operational_efficiency_pct, water_recycle_pct) average across the " +
        "scope; every other code sums. Only the three kl_* tiles carry balanceRole: \"intake\" " +
        "(ADR 0073 decision 2, Q1 ruling). A tile bound to the wrong period draws two rows with " +
        "the same number and nothing else notices.",
    );
  }
  // **Distinctness, because the table above cannot see a swap on its own.**
  // Two tiles given the same `pointKey` each match their own row only if the
  // table itself is wrong; this catches the catalog side — fourteen tiles,
  // fourteen different codes. (The benchmark TABLE repeats `kl_today`, which
  // is why this counts the tiles and not every `pointKey` in the entry.)
  const bound = entry.content.widgets
    .filter((widget) => widget.widgetType === "value_tile" && !KEPT_TILE_KEYS.has(widget.key))
    .map((widget) => (widget.sources[0]?.params as { pointKey?: string } | undefined)?.pointKey);
  assert(
    bound.length === 14 && new Set(bound).size === 14,
    `the fourteen sustainability tiles must bind fourteen DIFFERENT point keys — got ` +
      `${bound.length} tiles and ${new Set(bound).size} distinct keys: ${bound.join(", ")}`,
  );
}

/**
 * **No non-water binding carries `balanceRole`** (Q1 ruling (a) — the four
 * water bindings only, and no `water_cost_*` tiles exist to add it to either,
 * C1). A separate `it`, walking every source on every widget (tiles and both
 * tables), so a mutation that adds the field to, say, `co2-today-tile`
 * reddens THIS claim even though `runSustainabilityTileBindingsTest`'s own
 * row for `co2-today-tile` also reddens first in that function — the two
 * claims must not share one `assert` chain (a thrown `assert` stops its own
 * function, not a sibling one).
 *
 * "Water" is defined as the `kl_` prefixed subset of
 * `SUSTAINABILITY_WATER_POINT_KEYS` — the intake-volume codes — not
 * membership in the whole array, which also holds `water_cost_*`,
 * `water_saving_vs_baseline_pct`, `water_recycle_pct` and the `outlet_kl_*`
 * codes. None of THOSE take a role either: `water_recycle_pct` and
 * `operational-efficiency-pct-tile` are ratios with no formula to filter, and
 * there are no `outlet_kl_*` or `water_cost_*` bindings anywhere in this
 * template to test.
 */
export function runNoNonWaterBindingCarriesBalanceRoleTest(): void {
  const entry = sustainabilityEntry();
  const WATER_VOLUME_KEYS: ReadonlySet<string> = new Set(
    SUSTAINABILITY_WATER_POINT_KEYS.filter((key) => key.startsWith("kl_")),
  );
  const withRole: string[] = [];
  const withoutRole: string[] = [];
  for (const widget of entry.content.widgets) {
    for (const source of widget.sources) {
      const params = source.params as { pointKey?: string; balanceRole?: string } | undefined;
      if (params?.balanceRole === undefined) continue;
      if (
        params.pointKey !== undefined &&
        WATER_VOLUME_KEYS.has(params.pointKey) &&
        params.balanceRole === "intake"
      ) {
        withRole.push(widget.key);
      } else {
        withoutRole.push(
          `${widget.key} (pointKey ${JSON.stringify(params.pointKey)}, balanceRole ` +
            `${JSON.stringify(params.balanceRole)})`,
        );
      }
    }
  }
  assert(
    withoutRole.length === 0,
    `a non-water binding carries balanceRole — Q1 ruling gives the role to the three kl_* ` +
      `tiles and the benchmark table only: ${withoutRole.join(", ")}`,
  );
  // Positive control: exactly four sources carry the role, and each is "intake" — an absence
  // claim alone would pass on a catalog that dropped the role from everywhere.
  assert(
    withRole.length === 4,
    `expected exactly four sources to carry balanceRole (the three kl_* tiles and the ` +
      `benchmark table) — got ${withRole.length}: ${withRole.join(", ")}`,
  );
}

/**
 * The positive control for `KEPT_TILE_KEYS`'s exclusion.
 *
 * Every claim above only reaches the fourteen new tiles; without this, a rename
 * of one of the three kept keys would silently drop it out of all of them —
 * exempt from the `sustainability.total` check because its (renamed) key is no
 * longer in `KEPT_TILE_KEYS`, but the tile itself never checked at all.
 */
export function runSustainabilityKeptTilesTest(): void {
  const entry = sustainabilityEntry();
  const KEPT_TILE_CATALOG_KEYS: Readonly<Record<string, string>> = {
    "alarms-tile": "alarms.active.count",
    "workorders-tile": "workorders.open.count",
    "health-tile": "assets.health.score",
  };
  for (const [key, catalogKey] of Object.entries(KEPT_TILE_CATALOG_KEYS)) {
    const widget = entry.content.widgets.find((row) => row.key === key);
    assert(
      widget !== undefined && widget.widgetType === "value_tile" &&
        widget.sources.length === 1 && widget.sources[0]?.catalogKey === catalogKey,
      `the kept tile "${key}" must still be a value_tile bound to "${catalogKey}" — got ` +
        `${widget === undefined ? "(no such widget)" : widget.sources.map((source) => source.catalogKey).join(", ") || "(none)"}`,
    );
  }
}

/**
 * `F3.44` post-merge sweep (security L2) — every catalog code passes the
 * server's `stockCodeParamSchema` (`^[a-z0-9-]+$`, max 64). The web stock
 * card interpolates `entry.code` into a route path unencoded, and the shared
 * DTO bounds the code by length only, so this is the one gate that ties the
 * catalog's charset to the route's. A separate `it` so a failure here is
 * named, not hidden behind the first `assert` of `runStockCatalogTests`.
 */
export function runStockCatalogCodesMatchTheParamCharsetTests(): void {
  assert(STOCK_DASHBOARD_TEMPLATE_CATALOG.length > 0, "the catalog is empty — a vacuous pass");
  for (const entry of STOCK_DASHBOARD_TEMPLATE_CATALOG) {
    const result = stockCodeParamSchema.safeParse(entry.code);
    assert(
      result.success,
      `stock code ${JSON.stringify(entry.code)} does not pass stockCodeParamSchema — ` +
        "the card links to /admin/dashboard-templates/stock/<code> unencoded",
    );
  }
}
