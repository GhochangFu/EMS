import {
  DASHBOARD_GRID,
  MAX_WIDGET_POINTS,
  MAX_WIDGET_WINDOW_MINUTES,
  METRIC_CATALOG,
  WIDGET_POINT_CARDINALITY,
  WIDGET_SOURCE_CARDINALITY,
  chartConfigSchema,
  chartSeriesKindSchema,
  dashboardWidgetDtoSchema,
  dashboardWidgetPointDtoSchema,
  dashboardWidgetSourceDtoSchema,
  dashboardWidgetSpecSchema,
  metricCatalogKeySchema,
  metricCatalogValueDtoSchema,
  pointAggregateFunctionSchema,
  radialGaugeConfigSchema,
  valueTileConfigSchema,
  widgetIconSchema,
  widgetPointRoleSchema,
  widgetTypeSchema,
} from "./dashboard-builder";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function expectRejects(schema: { safeParse: (v: unknown) => { success: boolean } }, value: unknown, message: string): void {
  assert(schema.safeParse(value).success === false, `${message} — expected a refusal, got success`);
}

function expectAccepts(schema: { safeParse: (v: unknown) => { success: boolean } }, value: unknown, message: string): void {
  const result = schema.safeParse(value);
  assert(result.success === true, `${message} — expected success, got a refusal`);
}

const gauge = {
  widgetType: "radial_gauge",
  config: { min: 0, max: 100, unit: "%", decimals: 1, thresholds: [] },
};

/**
 * `F3.1a` — the widget vocabulary and the per-type config union (ADR 0047 decisions 2 and 4).
 *
 * Assertions live here; `dashboard-builder.test.ts` is the vitest entry point (ADR 0014).
 */
export function runDashboardBuilderTests(): void {
  // -------------------------------------------------------------------------
  // The vocabulary itself. Pinned, because five backlog rows and two accepted
  // ADRs wait on exactly this list and `F3.1c`'s renderer switch is exhaustive
  // over it.
  // -------------------------------------------------------------------------
  assert(
    widgetTypeSchema.options.length === 4,
    `the widget vocabulary is four types (ADR 0047 decision 4), got ${widgetTypeSchema.options.length}`,
  );
  assert(
    JSON.stringify(widgetTypeSchema.options) ===
      JSON.stringify(["radial_gauge", "tank_level", "value_tile", "chart"]),
    `widget types must match migration 0050's CHECK exactly, got ${JSON.stringify(widgetTypeSchema.options)}`,
  );

  // Decision 4's generic type: one component, four series. This is the lever that keeps a
  // chart-shaped ask from being a release — "we want bars" is configuration, not a component.
  assert(
    JSON.stringify(chartSeriesKindSchema.options) ===
      JSON.stringify(["line", "area", "bar", "scatter"]),
    `chart series kinds must be the four ECharts cartesian series, got ${JSON.stringify(chartSeriesKindSchema.options)}`,
  );

  assert(
    JSON.stringify(widgetPointRoleSchema.options) === JSON.stringify(["primary", "series"]),
    `point roles are the two renderer slots, got ${JSON.stringify(widgetPointRoleSchema.options)}`,
  );

  // -------------------------------------------------------------------------
  // The closed vocabulary refuses a kind nobody has written a component for.
  // This is decision 2's entire justification: a type that reaches the database
  // draws a blank rectangle with nothing in the console, the log or the network
  // tab, which is worse than F4.43's unstyled badge because a badge is legible.
  // -------------------------------------------------------------------------
  expectRejects(
    dashboardWidgetSpecSchema,
    { widgetType: "mimic", config: {} },
    "an undeclared widget type must be refused at the contract boundary",
  );

  // -------------------------------------------------------------------------
  // The discriminated union is what stops a chart config reaching the gauge
  // renderer. Without it `config` would be one permissive object and every
  // renderer would have to defend itself.
  // -------------------------------------------------------------------------
  expectRejects(
    dashboardWidgetSpecSchema,
    { widgetType: "radial_gauge", config: { series: "bar" } },
    "a chart's config under a gauge's type must be refused",
  );
  expectAccepts(dashboardWidgetSpecSchema, gauge, "a well-formed gauge spec must parse");
  expectAccepts(
    dashboardWidgetSpecSchema,
    { widgetType: "chart", config: { series: "area", windowMinutes: 1440 } },
    "a well-formed chart spec must parse",
  );

  // -------------------------------------------------------------------------
  // An unknown config key is ACCEPTED and stripped, and that is the rule rather
  // than a gap. These are response contracts, and §4.8 requires exactly this
  // direction: `checkResponse` returns the original payload because a validator
  // that quietly edits what it validates is worse than none, so a strict
  // response schema would turn every field the server adds into a hard failure.
  //
  // E7.1f's "a mutating request body refuses an unknown key" is a different
  // axis — REQUEST_SCHEMAS, policed by the strict-body ledger in apps/api — and
  // F3.1b owns the request bodies for these tables. Asserted rather than left
  // silent, so nobody "hardens" this file and breaks the read path.
  // -------------------------------------------------------------------------
  expectAccepts(
    dashboardWidgetSpecSchema,
    { widgetType: "radial_gauge", config: { ...gauge.config, serverAddedLater: 1 } },
    "a response contract must tolerate a field the server has added",
  );

  // -------------------------------------------------------------------------
  // A gauge whose range is inverted or empty renders an undefined needle
  // position. The contract refuses it rather than leaving F3.1c to guess.
  // -------------------------------------------------------------------------
  expectRejects(
    radialGaugeConfigSchema,
    { min: 100, max: 0 },
    "a gauge with min above max must be refused",
  );
  expectRejects(
    radialGaugeConfigSchema,
    { min: 50, max: 50 },
    "a gauge with an empty range must be refused",
  );
  expectAccepts(radialGaugeConfigSchema, { min: 0, max: 100 }, "an ordinary gauge range parses");

  // A chart window must be a positive whole number of minutes: zero would query an empty
  // range and render an empty tile that looks like a dead sensor.
  expectRejects(chartConfigSchema, { series: "line", windowMinutes: 0 }, "a zero window");
  expectRejects(chartConfigSchema, { series: "line", windowMinutes: -60 }, "a negative window");

  // -------------------------------------------------------------------------
  // The DTO. `z.intersection` is §4.8's prescribed encoding for `A & B`; the
  // union still narrows through it, which is what keeps F3.1c's exhaustive
  // switch operating on the DTO directly rather than on a re-parsed config.
  // -------------------------------------------------------------------------
  const widget = {
    id: "11111111-1111-4111-8111-111111111111",
    dashboardId: "22222222-2222-4222-8222-222222222222",
    organizationId: "33333333-3333-4333-8333-333333333333",
    title: null,
    gridX: 0,
    gridY: 0,
    gridW: 6,
    gridH: 4,
    points: [
      {
        id: "44444444-4444-4444-8444-444444444444",
        pointId: "55555555-5555-4555-8555-555555555555",
        role: "series",
        sortOrder: 0,
        assetId: "88888888-8888-4888-8888-888888888888",
        pointKey: "kw",
        unit: "kW",
      },
      {
        id: "66666666-6666-4666-8666-666666666666",
        pointId: "77777777-7777-4777-8777-777777777777",
        role: "series",
        sortOrder: 1,
        assetId: "99999999-9999-4999-8999-999999999999",
        pointKey: "kwh",
        unit: null,
      },
    ],
    // `F3.35` Stage C. A chart binds no catalog source — `WIDGET_SOURCE_CARDINALITY.chart` is
    // `{0,0}`, because a catalog entry resolves to a number or to rows and neither is a series.
    sources: [],
    widgetType: "chart",
    config: { series: "line", windowMinutes: 1440 },
  };

  const parsed = dashboardWidgetDtoSchema.safeParse(widget);
  assert(parsed.success === true, "a chart widget with two series bindings must parse");
  if (parsed.success) {
    // The narrowing is the property under test, not the value: if the intersection flattened
    // the union away, `widgetType` would be a bare string and this branch would not typecheck
    // as a discriminant.
    assert(
      parsed.data.widgetType === "chart",
      `the parsed DTO must narrow on widgetType, got ${String(parsed.data.widgetType)}`,
    );
    assert(
      parsed.data.widgetType === "chart" && parsed.data.config.series === "line",
      "narrowing on widgetType must reach the chart config",
    );
  }

  // The grid is bounded in the contract as well as in SQL, so an author gets a 400 naming the
  // field rather than a 500 from a constraint (§4.8's write-boundary note).
  expectRejects(
    dashboardWidgetDtoSchema,
    { ...widget, gridX: 10, gridW: 4 },
    "a widget overflowing the 12-column canvas must be refused",
  );
  expectRejects(dashboardWidgetDtoSchema, { ...widget, gridW: 0 }, "a zero-width widget");
}

/**
 * `F3.1d` Unit 2 — `DASHBOARD_GRID` is the single source for the canvas
 * bounds, and `dashboardWidgetIdentitySchema`'s four fields plus its
 * `.refine()` must read it rather than restate `11`/`12`/`24`.
 * `tests/f3.1d-grid-bounds-single-source.test.ts` is the scan that keeps a
 * fifth TypeScript copy from appearing; this is the pin that proves THIS
 * schema is one of the wired sites rather than a fourth private copy.
 */
export function runDashboardGridTests(): void {
  assert(DASHBOARD_GRID.columns === 12, "the canvas is 12 columns");
  assert(DASHBOARD_GRID.minWidgetW === 1, "a widget is at least 1 column wide");
  assert(DASHBOARD_GRID.minWidgetH === 1, "a widget is at least 1 row tall");
  assert(DASHBOARD_GRID.maxWidgetH === 24, "a widget is at most 24 rows tall");

  const gridFixture = {
    id: "11111111-1111-4111-8111-111111111111",
    dashboardId: "22222222-2222-4222-8222-222222222222",
    organizationId: "33333333-3333-4333-8333-333333333333",
    title: null,
    gridY: 0,
    gridH: 1,
    points: [],
    // `F3.35` Stage C widened the identity schema. A widget as read always carries both
    // binding arrays, and an empty one is the normal state for the kind it does not use.
    sources: [],
    widgetType: "value_tile",
    config: {},
  };

  // The pin the mutation table names: "set DASHBOARD_GRID.columns = 16" must
  // flip this red. At columns=16 the field's legitimate max becomes 15 and
  // gridX:15 parses — so today, with columns=12, this must still be refused.
  // gridW is 1 so only the field-level .max() on gridX is exercised, not the
  // .refine() cross-check (15 + 1 = 16, already over today's bound either way).
  expectRejects(
    dashboardWidgetDtoSchema,
    { ...gridFixture, gridX: 15, gridW: 1 },
    "gridX 15 exceeds DASHBOARD_GRID.columns - 1 today — refused unless the constant has drifted",
  );
  expectAccepts(
    dashboardWidgetDtoSchema,
    { ...gridFixture, gridX: 11, gridW: 1 },
    "gridX at DASHBOARD_GRID.columns - 1 (the last column) is accepted",
  );

  // The .refine() cross-check, isolated from the field-level .max(): both
  // gridX (11) and gridW (2) are individually legal, but their sum (13)
  // exceeds today's 12-column canvas. Flips at the same mutation, since a
  // properly wired .refine() reads DASHBOARD_GRID.columns too.
  expectRejects(
    dashboardWidgetDtoSchema,
    { ...gridFixture, gridX: 11, gridW: 2 },
    "gridX 11 + gridW 2 (13) exceeds the 12-column canvas though both individual bounds are legal",
  );
  expectAccepts(
    dashboardWidgetDtoSchema,
    { ...gridFixture, gridX: 11, gridW: 1 },
    "gridX 11 + gridW 1 (12) exactly fills the canvas and is accepted",
  );
}

/**
 * ADR 0047 Amendment 2 — the per-type point cardinality map.
 *
 * The map is the seam between `F3.1b`'s write path and `F3.1c`'s catalog, so what these
 * assertions protect is the *agreement* between two packages that cannot import each other.
 */
export function runWidgetPointCardinalityTests(): void {
  // The `Record` type already refuses a missing key, so this loop cannot fail while the
  // declaration keeps its type. It is kept deliberately, and only for the case the type cannot
  // see: an entry reintroduced through a cast, or a weakening to `Partial<Record<…>>`. Stated
  // rather than left implicit, because `F3.1a` shipped three assertions that passed while
  // checking nothing and the fix is to say what an assertion is for.
  for (const widgetType of widgetTypeSchema.options) {
    assert(
      WIDGET_POINT_CARDINALITY[widgetType] !== undefined,
      `every widget type needs a cardinality entry, ${widgetType} has none`,
    );
  }

  // Same argument, one binding kind over. `F3.35` Stage C's source cardinality is the second
  // half of the same seam, and a missing entry here is the same silent hole.
  for (const widgetType of widgetTypeSchema.options) {
    assert(
      WIDGET_SOURCE_CARDINALITY[widgetType] !== undefined,
      `every widget type needs a source cardinality entry, ${widgetType} has none`,
    );
  }

  // The bound the type cannot express. A per-type maximum may be lower than the global cap and
  // never higher — otherwise `F3.1b` accepts a widget that `MAX_WIDGET_POINTS` (and the template
  // authoring surface's `MAX_WIDGET_POINT_KEYS`, reconciled against it) refuses one layer down.
  for (const widgetType of widgetTypeSchema.options) {
    const { min, max } = WIDGET_POINT_CARDINALITY[widgetType];
    assert(min <= max, `${widgetType} has min ${min} above max ${max}`);
    assert(
      max <= MAX_WIDGET_POINTS,
      `${widgetType} allows ${max} points, above the global cap of ${MAX_WIDGET_POINTS}`,
    );

    const source = WIDGET_SOURCE_CARDINALITY[widgetType];
    assert(
      source.min <= source.max,
      `${widgetType} has source min ${source.min} above max ${source.max}`,
    );
  }

  // **This assertion replaces `min >= 1`, which `F3.35` Stage C deleted.** Until Stage C a
  // widget bound points and nothing else, so "binds at least one point" and "binds something"
  // were the same sentence. Decision 2 separates them: a `value_tile` binds a point **or** a
  // named metric, so its point `min` is legitimately 0 and the old assertion would refuse the
  // whole feature.
  //
  // What is NOT weakened, and where it went: a widget type must still be able to bind
  // something, which is what this loop keeps. The stronger per-widget rule — a stored widget
  // binds exactly one KIND, never both and never neither — is a cross-field rule between two
  // arrays on one arm, so it cannot live on a `z.discriminatedUnion` arm at all
  // (`dashboards.schema.ts` records why). It is enforced on write, by `exactlyOneBindingKind`
  // in `apps/api/src/dashboard-builder/dashboards.schema.ts`, and asserted by
  // `runDashboardsSchemaSourceShapeTests` in that file's spec. Deleting an assertion without
  // naming its replacement is how a weakening reads as a refactor, so both halves are stated
  // here.
  //
  // **Both details in the previous sentence were wrong when written, and a correctness review
  // proved it by mutation.** The helper was named `eachWidgetBindsExactlyOneKind`, which
  // matches nothing in the repository — a reader grepping the name found no enforcement and no
  // test. And the spec asserted nothing: disabling both of the rule's conditions left the
  // entire api suite green, because the only fixture touching it submitted a state the rule
  // ACCEPTS. A comment claiming a gate exists is worse than no comment, because it stops the
  // next reader looking. The cases exist now; this note stays as the reason they do.
  for (const widgetType of widgetTypeSchema.options) {
    const bindable =
      WIDGET_POINT_CARDINALITY[widgetType].max + WIDGET_SOURCE_CARDINALITY[widgetType].max;
    assert(
      bindable >= 1,
      `${widgetType} must be able to bind something, but allows 0 points and 0 sources`,
    );
  }

  // The four values, pinned by name. Written against `MAX_WIDGET_POINTS` rather than against
  // `8`, so the pin does not become the third copy of that number.
  for (const widgetType of ["radial_gauge", "tank_level"] as const) {
    assert(
      WIDGET_POINT_CARDINALITY[widgetType].min === 1 &&
        WIDGET_POINT_CARDINALITY[widgetType].max === 1,
      `${widgetType} takes exactly one point, got ${JSON.stringify(WIDGET_POINT_CARDINALITY[widgetType])}`,
    );
    assert(
      WIDGET_SOURCE_CARDINALITY[widgetType].max === 0,
      `${widgetType} binds no catalog source, got ${JSON.stringify(WIDGET_SOURCE_CARDINALITY[widgetType])}`,
    );
  }

  // The tile is the one type that takes either kind (ADR 0048 decision 2: "a `value_tile` binds
  // a metric"). Both minimums are 0 because either array may legitimately be the empty one; the
  // *exactly one* rule is the write-time rule named above.
  assert(
    WIDGET_POINT_CARDINALITY.value_tile.min === 0 &&
      WIDGET_POINT_CARDINALITY.value_tile.max === 1,
    `value_tile takes 0..1 points, got ${JSON.stringify(WIDGET_POINT_CARDINALITY.value_tile)}`,
  );
  assert(
    WIDGET_SOURCE_CARDINALITY.value_tile.min === 0 &&
      WIDGET_SOURCE_CARDINALITY.value_tile.max === 1,
    `value_tile takes 0..1 sources, got ${JSON.stringify(WIDGET_SOURCE_CARDINALITY.value_tile)}`,
  );

  assert(
    WIDGET_POINT_CARDINALITY.chart.min === 1 &&
      WIDGET_POINT_CARDINALITY.chart.max === MAX_WIDGET_POINTS,
    `chart takes 1..MAX_WIDGET_POINTS series, got ${JSON.stringify(WIDGET_POINT_CARDINALITY.chart)}`,
  );
  assert(
    WIDGET_SOURCE_CARDINALITY.chart.max === 0,
    `chart binds no catalog source, got ${JSON.stringify(WIDGET_SOURCE_CARDINALITY.chart)}`,
  );
}

/**
 * `F3.35` Stage C (ADR 0048 decisions 1 and 2) — the metric catalog vocabulary.
 *
 * The catalog is **closed and it is code**: an entry's behaviour is a SQL query and no column
 * holds one, so an entry declared by an `INSERT` would satisfy every foreign key and then
 * return nothing, in front of an operator, with a green console. What that costs is a third
 * place the same list is written — the enum here, the `CHECK` in migration `0054`, and the
 * label map in `apps/web/src/lib/metric-catalog.ts` — and what these assertions buy is that
 * the three cannot drift apart in silence. The migration half is pinned by
 * `tests/f3.35-metric-catalog-schema.test.ts`, which parses the `CHECK` list and compares it
 * to `metricCatalogKeySchema.options`.
 */
export function runMetricCatalogTests(): void {
  // Kept for the case the `Record` type cannot see — an entry reintroduced through a cast, or
  // a weakening to `Partial<Record<…>>`. The same reason the cardinality loop above states.
  for (const key of metricCatalogKeySchema.options) {
    assert(METRIC_CATALOG[key] !== undefined, `every catalog key needs an entry, ${key} has none`);
  }

  for (const key of metricCatalogKeySchema.options) {
    const entry = METRIC_CATALOG[key];

    if (entry.shape === "dataset") {
      // A dataset with no declared columns renders an empty table — the Stage B picker has
      // nothing to offer and the resolve endpoint has nothing to project.
      assert(entry.columns.length >= 1, `dataset ${key} declares no columns`);

      const seen = new Set<string>();
      for (const column of entry.columns) {
        assert(!seen.has(column), `dataset ${key} declares the column ${column} twice`);
        seen.add(column);
      }
    }
  }

  // A metric resolves to one number and declares no columns. Asserted as the absence of the
  // key rather than as an empty array, so the two shapes stay distinguishable by `shape` alone
  // and a reader never has to check a length to know which one they hold.
  for (const key of metricCatalogKeySchema.options) {
    const entry = METRIC_CATALOG[key];
    assert(
      entry.shape === "metric" || entry.shape === "dataset",
      `${key} has an unknown shape ${JSON.stringify(entry.shape)}`,
    );
    if (entry.shape === "metric") {
      assert(
        !("columns" in entry),
        `metric ${key} declares columns; a metric resolves to one number`,
      );
    }
  }

  // The two shapes are both populated. A vocabulary that is all metrics would let Stage B ship
  // a `table` widget with nothing to bind — the dependency ADR 0048 decision 6 records.
  const shapes = metricCatalogKeySchema.options.map((key) => METRIC_CATALOG[key].shape);
  assert(shapes.includes("metric"), "the catalog declares no metric");
  assert(shapes.includes("dataset"), "the catalog declares no dataset");
}

/**
 * `F3.35` Stage C — the two response contracts the catalog adds.
 *
 * `dashboardWidgetSourceDtoSchema` is a binding as read; `metricCatalogValueDtoSchema` is the
 * resolved value. They are separate because a binding is stored and a value is computed, and
 * the resolve endpoint returns the second without the first.
 */
export function runMetricCatalogDtoTests(): void {
  const binding = {
    id: "55555555-5555-4555-8555-555555555555",
    catalogKey: metricCatalogKeySchema.options[0],
    params: { windowMinutes: 60, severity: "critical", includeCleared: false },
    sortOrder: 0,
  };
  const parsedBinding = dashboardWidgetSourceDtoSchema.safeParse(binding);
  assert(parsedBinding.success, "a well-formed source binding must parse");

  // `sortOrder` carries no `.min(0)`, the rule `dashboardWidgetPointDtoSchema` states one
  // binding kind over: `sort_order integer NOT NULL DEFAULT 0` permits a negative, so a bound
  // here would reject a row the store is entitled to produce.
  assert(
    dashboardWidgetSourceDtoSchema.safeParse({ ...binding, sortOrder: -3 }).success,
    "a negative sortOrder is a row the database can hold, so the response contract must accept it",
  );

  assert(
    !dashboardWidgetSourceDtoSchema.safeParse({ ...binding, catalogKey: "alarms.nope" }).success,
    "an unknown catalog key must not parse; the vocabulary is closed",
  );

  // A metric arm. `value` is nullable because an entry can legitimately resolve to nothing —
  // `E1.3` returns a null mean score when no tag carries a published rule, and rendering that
  // as 0 would be a fabricated number in front of an operator.
  const metricValue = {
    shape: "metric" as const,
    key: metricCatalogKeySchema.options[0],
    value: null,
    unit: null,
  };
  assert(
    metricCatalogValueDtoSchema.safeParse(metricValue).success,
    "a metric that resolves to nothing must parse as a null value, not fail",
  );

  // A dataset arm, with the closed cell union. `z.unknown()` would produce an *optional* key
  // and `z.any()`/`z.custom<unknown>()` behave identically — §4.8 records that this repo has
  // already spent an afternoon on it.
  const datasetValue = {
    shape: "dataset" as const,
    key: metricCatalogKeySchema.options[0],
    columns: ["code", "message"],
    rows: [{ code: "CH-01", message: null, active: true, count: 3 }],
    truncated: false,
  };
  assert(
    metricCatalogValueDtoSchema.safeParse(datasetValue).success,
    "a dataset row of the four cell types must parse",
  );
  assert(
    !metricCatalogValueDtoSchema.safeParse({
      ...datasetValue,
      rows: [{ code: { nested: true } }],
    }).success,
    "a nested object is not a dataset cell; the cell union is closed",
  );

  // The discriminator does the narrowing. A metric payload carrying dataset keys must fail
  // rather than parse into the wrong arm and render an empty table.
  assert(
    !metricCatalogValueDtoSchema.safeParse({ ...metricValue, shape: "dataset" }).success,
    "the shape discriminator must select the arm, so a mislabelled payload cannot pass",
  );
}

/**
 * `F3.1b` — the widened point-binding DTO carries `assetId`/`pointKey`/`unit`.
 *
 * Without these a caller cannot build the `pointRef` a telemetry read needs, and this is also
 * the shape Task 5's organization guard (`dashboard-point-scope.ts`) exists to keep tenant-pure
 * on the way out — asserted here only as "the contract requires it", not as the guard itself.
 */
export function runDashboardWidgetPointDtoTests(): void {
  const point = {
    id: "44444444-4444-4444-8444-444444444444",
    pointId: "55555555-5555-4555-8555-555555555555",
    role: "primary",
    sortOrder: 0,
    assetId: "88888888-8888-4888-8888-888888888888",
    pointKey: "kw",
    unit: "kW",
  };
  expectAccepts(
    dashboardWidgetPointDtoSchema,
    point,
    "a point binding with assetId/pointKey and a unit must parse",
  );
  expectAccepts(
    dashboardWidgetPointDtoSchema,
    { ...point, unit: null },
    "a point binding with a null unit must parse — not every point carries one",
  );
  expectRejects(
    dashboardWidgetPointDtoSchema,
    { ...point, assetId: undefined },
    "a point binding missing assetId must be refused — without it a caller cannot build a pointRef",
  );
}

// --- `F3.35` Stage A — aggregation, compare and presentation (ADR 0048) -------

/**
 * Every field `F3.35` added is **optional**, so a config stored before this
 * change still parses and still means what it meant.
 *
 * This is the assertion that would fail if someone made `aggregate` required to
 * "make the tile explicit". Nothing migrates a `jsonb` config column, so a
 * required field here does not fail at deploy — it fails the first time an
 * operator opens an old dashboard.
 */
export function runStageAOptionalityTests(): void {
  expectAccepts(
    valueTileConfigSchema,
    { unit: "kW" },
    "a value_tile config from before F3.35 must still parse",
  );
  expectAccepts(
    chartConfigSchema,
    { series: "line" },
    "a chart config from before F3.35 must still parse",
  );
}

/**
 * The two new vocabularies are closed, and closed at the schema rather than at
 * the renderer.
 *
 * `median` is the interesting refusal: it is a perfectly ordinary statistic and
 * the obvious fifth member, and the ADR 0023 rollup relations **cannot compute
 * it** — they store `sum_value`, `sample_count`, `min_value` and `max_value`.
 * A fifth member would parse here, reach `apps/api`, and find no column.
 */
export function runStageAVocabulariesAreClosedTests(): void {
  expectAccepts(pointAggregateFunctionSchema, "avg", "avg is one of the four");
  expectRejects(
    pointAggregateFunctionSchema,
    "median",
    "median must be refused — the rollup relations store no ordered samples to take one from",
  );
  expectRejects(
    pointAggregateFunctionSchema,
    "last",
    "last must be refused — a bucket keeps no ordering within itself",
  );
  expectAccepts(widgetIconSchema, "bolt", "bolt is one of the mock's six");
  expectRejects(
    widgetIconSchema,
    "wrench",
    "an icon name with no path in WIDGET_ICON_PATH must be refused at the contract, " +
      "not rendered as a blank square",
  );
}

/**
 * The tile's bounds. `windowMinutes` uses the same constant the chart has
 * carried since `F3.1a`, so the two cannot drift; `hint` is bounded because
 * `KpiTile` renders it at 11px on one line.
 */
export function runStageATileBoundsTests(): void {
  expectAccepts(
    valueTileConfigSchema,
    { aggregate: "sum", windowMinutes: MAX_WIDGET_WINDOW_MINUTES },
    "the tile must accept the same maximum window the chart accepts",
  );
  expectRejects(
    valueTileConfigSchema,
    { aggregate: "sum", windowMinutes: MAX_WIDGET_WINDOW_MINUTES + 1 },
    "a window past the shared maximum must be refused",
  );
  expectRejects(
    valueTileConfigSchema,
    { windowMinutes: 0 },
    "a zero-length window must be refused — it has no samples and no meaning",
  );
  expectRejects(
    valueTileConfigSchema,
    { hint: "x".repeat(121) },
    "a hint past 120 characters must be refused",
  );
}

/**
 * **The propagation assertion, and the reason `apps/api` needs no edit at all.**
 *
 * `dashboards.schema.ts` and `asset-templates-content.schema.ts` both compose
 * these schemas as `.strict()`. That composition is performed here, on the exact
 * same schemas, so a field added to `packages/shared` is proved to survive both
 * write paths rather than assumed to.
 *
 * It is also the guard against the nested-object mistake: `.strict()` does not
 * descend, so had `compare` been `z.object({ … })` this assertion would still
 * pass while the inner object stayed permissive on the wire. Keep every field
 * flat and this assertion means what it looks like it means.
 */
export function runStageAFieldsSurviveStrictCompositionTests(): void {
  expectAccepts(
    valueTileConfigSchema.strict(),
    {
      unit: "kWh",
      aggregate: "sum",
      windowMinutes: 1_440,
      compareToPrevious: true,
      icon: "bolt",
      hint: "Since midnight",
      tone: "warning",
    },
    "every new tile field must survive the .strict() composition apps/api performs",
  );
  expectAccepts(
    chartConfigSchema.strict(),
    { series: "line", windowMinutes: 1_440, aggregate: "avg", footerStats: true },
    "every new chart field must survive the .strict() composition apps/api performs",
  );
  expectRejects(
    valueTileConfigSchema.strict(),
    { aggregate: "sum", compareWindowMinutes: 1_440 },
    "an unknown key must still be refused — the strict composition must not have been widened",
  );
}

/**
 * The pair goes through `dashboardWidgetSpecSchema` too. The discriminated union
 * is what `F3.1c`'s exhaustive `switch` operates on, so a field that parses in
 * isolation and not through the union would be authorable and unrenderable.
 */
export function runStageASpecUnionCarriesTheNewFieldsTests(): void {
  expectAccepts(
    dashboardWidgetSpecSchema,
    { widgetType: "value_tile", config: { aggregate: "avg", windowMinutes: 60, tone: "critical" } },
    "the spec union must carry the tile's new fields",
  );
  expectAccepts(
    dashboardWidgetSpecSchema,
    { widgetType: "chart", config: { series: "area", aggregate: "max", footerStats: true } },
    "the spec union must carry the chart's new fields",
  );
}
