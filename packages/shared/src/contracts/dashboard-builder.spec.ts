import {
  MAX_WIDGET_POINTS,
  WIDGET_POINT_CARDINALITY,
  chartConfigSchema,
  chartSeriesKindSchema,
  dashboardWidgetDtoSchema,
  dashboardWidgetSpecSchema,
  radialGaugeConfigSchema,
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
      },
      {
        id: "66666666-6666-4666-8666-666666666666",
        pointId: "77777777-7777-4777-8777-777777777777",
        role: "series",
        sortOrder: 1,
      },
    ],
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

  // The bound the type cannot express. A per-type maximum may be lower than the global cap and
  // never higher — otherwise `F3.1b` accepts a widget that `MAX_WIDGET_POINTS` (and the template
  // authoring surface's `MAX_WIDGET_POINT_KEYS`, reconciled against it) refuses one layer down.
  for (const widgetType of widgetTypeSchema.options) {
    const { min, max } = WIDGET_POINT_CARDINALITY[widgetType];
    assert(min >= 1, `${widgetType} must bind at least one point, got min ${min}`);
    assert(min <= max, `${widgetType} has min ${min} above max ${max}`);
    assert(
      max <= MAX_WIDGET_POINTS,
      `${widgetType} allows ${max} points, above the global cap of ${MAX_WIDGET_POINTS}`,
    );
  }

  // The four values, pinned by name. Written against `MAX_WIDGET_POINTS` rather than against
  // `8`, so the pin does not become the third copy of that number.
  for (const widgetType of ["radial_gauge", "tank_level", "value_tile"] as const) {
    assert(
      WIDGET_POINT_CARDINALITY[widgetType].min === 1 &&
        WIDGET_POINT_CARDINALITY[widgetType].max === 1,
      `${widgetType} takes exactly one point, got ${JSON.stringify(WIDGET_POINT_CARDINALITY[widgetType])}`,
    );
  }
  assert(
    WIDGET_POINT_CARDINALITY.chart.min === 1 &&
      WIDGET_POINT_CARDINALITY.chart.max === MAX_WIDGET_POINTS,
    `chart takes 1..MAX_WIDGET_POINTS series, got ${JSON.stringify(WIDGET_POINT_CARDINALITY.chart)}`,
  );
}
