import {
  DASHBOARD_GRID,
  metricCatalogKeySchema,
  sectionTemplateContentSchema,
  stockDashboardTemplateDtoSchema,
  WIDGET_POINT_CARDINALITY,
  WIDGET_SOURCE_CARDINALITY,
} from "@bms/shared";

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
