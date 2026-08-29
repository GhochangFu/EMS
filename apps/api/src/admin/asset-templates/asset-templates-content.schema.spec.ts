import { WIDGET_POINT_CARDINALITY, widgetTypeSchema } from "@bms/shared";

import {
  MAX_CONTENT_BYTES,
  collectContentPointRefs,
  findUnresolvedContentRefs,
  templateContentSchema,
  templateDashboardWidgetVariants,
  type TemplateContentParsed,
} from "./asset-templates-content.schema";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** Parses and fails loudly, so a broken fixture reads as a fixture bug rather
 * than as the assertion under test. */
function parse(content: unknown): TemplateContentParsed {
  const result = templateContentSchema.safeParse(content);
  if (!result.success) {
    throw new Error(`fixture should parse: ${JSON.stringify(result.error.issues)}`);
  }
  return result.data;
}

function rejects(content: unknown, message: string): void {
  assert(templateContentSchema.safeParse(content).success === false, message);
}

/** The single issue message produced by a rejected payload, joined so a test can
 * assert on *what* the author is told, not merely that they were told. */
function messagesFor(content: unknown): string {
  const result = templateContentSchema.safeParse(content);
  assert(result.success === false, "expected this payload to be rejected");
  return result.success ? "" : result.error.issues.map((issue) => issue.message).join(" | ");
}

const alarm = {
  code: "HI_PRESSURE",
  pointKey: "RO_FEED_PRESSURE",
  operator: "gt",
  thresholdValue: 12.5,
  severity: "critical",
  message: "Feed pressure above design limit",
};

/** The ADR 0019 content contract (backlog `E1.7`). */
export function runTemplateContentSchemaTests(): void {
  // ---- envelope ------------------------------------------------------------

  // Every `asset_templates` row shipped by F2.1 is `{}`. If the tightening
  // rejected it, the contract would need a migration, and ADR 0019's whole
  // "no DDL" claim would be false.
  const empty = parse({});
  assert(
    empty.contentVersion === 1,
    `{} must parse and default contentVersion to 1, got ${String(empty.contentVersion)}`,
  );

  assert(
    templateContentSchema.safeParse({ contentVersion: 2 }).success === false,
    "contentVersion is a literal 1; a future reshape adds a value, it does not accept any integer",
  );

  rejects({ kpi: [] }, "an unknown top-level key must be rejected (typo protection)");
  rejects([], "an array is not a content object");

  // ---- reserved sections ---------------------------------------------------

  // The point of rejecting rather than accepting: E5.1 must not author a shape
  // F3.1/E1.1 will contradict. And each key names its OWN blocking item —
  // pointing an author blocked on `optimisation` at E1.1 would send them to an
  // item three waves earlier.
  const healthMessage = messagesFor({ health: { model: "rul" } });
  assert(
    healthMessage.includes("E1.1"),
    `rejecting "health" must name E1.1, got: ${healthMessage}`,
  );
  const optimisationMessage = messagesFor({ optimisation: { advisories: [] } });
  assert(
    optimisationMessage.includes("E1.6"),
    `rejecting "optimisation" must name E1.6, not E1.1, got: ${optimisationMessage}`,
  );
  assert(
    optimisationMessage.includes("deferred") || optimisationMessage.includes("not yet"),
    "a reserved-key error must read as deferral, not as a mistake by the author",
  );

  // ---- alarms: bound to the live rules vocabulary ---------------------------

  const withAlarm = parse({ alarms: [alarm] });
  assert(withAlarm.alarms?.length === 1, "a valid alarm must parse");

  // `packages/shared` AutomationRuleOperator has no `neq`. A template authoring
  // one would author an alarm the rule engine cannot run — which is the entire
  // argument for importing the enum rather than restating it.
  rejects({ alarms: [{ ...alarm, operator: "neq" }] }, "`neq` is not a live operator");

  // This used to assert the schema REJECTS `severity: "major"` and `"minor"`,
  // and it did, because `severitySchema` was a `z.enum` of three values.
  //
  // **ADR 0032 moved that check, and this is the same trade ADR 0031 Amendment 1
  // already made for `category` two lines down.** The severity vocabulary is
  // `bms.alarm_severities` now, so the schema checks shape and
  // `alarms_severity_fk` closes the set — which is what lets client ask `B9`
  // add a fourth level with an INSERT instead of a migration. The alarm the
  // rule engine cannot run is still refused; it is refused by
  // `assertTemplateAlarmSeverities` in `asset-templates.service.ts`, one layer
  // out, and by the foreign key underneath it.
  //
  // Asserting acceptance here is deliberate rather than an omission: it records
  // that the boundary moved, so a future reader does not restore a `z.enum`
  // here and silently re-close a vocabulary the owner ruled open.
  assert(
    templateContentSchema.safeParse({ alarms: [{ ...alarm, severity: "major" }] }).success,
    "an unknown severity is now a shape-valid code — liveness is the service's check, not this schema's",
  );
  assert(
    templateContentSchema.safeParse({ alarms: [{ ...alarm, category: "energy" }] }).success,
    "`energy` is a live rule category and must be accepted",
  );

  // This used to assert the schema REJECTS `category: "water"`, and it did,
  // because `categorySchema` was a `z.enum` of four values.
  //
  // ADR 0031 Amendment 1 made the rule vocabulary a table (`bms.rule_categories`)
  // so that a domain pack can ship a sector with an INSERT rather than a
  // migration. A pure Zod schema cannot ask the database what is live, so
  // `categorySchema` now checks *shape* and the liveness check moved to
  // `AssetTemplatesAdminService.assertTemplateAlarmCategories` — kept, not
  // dropped, because a template is an authoring surface and a category that
  // does not exist is a defect authored now and found much later.
  //
  // Asserting acceptance here rather than deleting the case: it records the
  // boundary that actually moved, so nobody reads the absence as an oversight.
  assert(
    templateContentSchema.safeParse({ alarms: [{ ...alarm, category: "water" }] }).success,
    "an unknown category is now a SERVICE-level rejection, not a schema one — see " +
      "`assertTemplateAlarmCategories`. If this fails, `categorySchema` has been " +
      "turned back into an enum and the vocabulary is frozen in code again.",
  );

  // What the schema still owns is shape. An empty code is not a code.
  rejects({ alarms: [{ ...alarm, category: "" }] }, "an empty category is not a code");

  rejects(
    { alarms: [alarm, { ...alarm, message: "Duplicate" }] },
    "two alarms with the same code in one template must be rejected",
  );
  rejects({ alarms: [{ ...alarm, unknownField: 1 }] }, "alarm entries are strict");

  const philosophy = parse({
    alarms: [{ ...alarm, philosophy: { cause: "Fouled membrane", skill: "RO technician" } }],
  });
  assert(
    philosophy.alarms?.[0]?.philosophy?.cause === "Fouled membrane",
    "philosophy fields must round-trip",
  );
  rejects(
    { alarms: [{ ...alarm, philosophy: { etr: "4h" } }] },
    "philosophy is strict — E2.1 owns this vocabulary and `etr` is per-incident, not per-class",
  );

  // ---- maintenance: bound to the live schedule vocabulary -------------------

  const maintenance = parse({
    maintenance: [{ title: "Membrane CIP", intervalDays: 90 }],
  });
  const plan = maintenance.maintenance?.[0];
  assert(plan?.category === "preventive", "category must default to preventive");
  assert(plan?.generationMode === "calendar", "generationMode must default to calendar");
  assert(plan?.priority === "medium", "priority must default to medium");
  assert(plan?.estimatedMinutes === 60, "estimatedMinutes must default to 60");
  assert(plan?.safetyCritical === false, "safetyCritical must default to false");

  assert(
    templateContentSchema.safeParse({
      maintenance: [{ title: "Calibrate", intervalDays: 30, category: "calibration" }],
    }).success,
    "`calibration` is one of the 14 live maintenance categories",
  );
  rejects(
    { maintenance: [{ title: "X", intervalDays: 30, category: "descaling" }] },
    "`descaling` is not a live maintenance category",
  );
  rejects(
    { maintenance: [{ title: "X", intervalDays: 30, generationMode: "ai" }] },
    "`ai` is not a live generation mode",
  );
  rejects({ maintenance: [{ title: "X", intervalDays: 0 }] }, "intervalDays must be at least 1");
  rejects({ maintenance: [{ title: "X", intervalDays: 731 }] }, "intervalDays caps at 730");

  // ---- kpis: anchored ------------------------------------------------------

  const kpi = {
    code: "SPECIFIC_ENERGY",
    name: "Specific energy",
    unit: "kWh/m3",
    pointKeys: ["RO_FEED_PRESSURE", "RO_PERMEATE_FLOW"],
    expression: "power / permeate_flow",
    dialect: "unvalidated",
  };
  assert(templateContentSchema.safeParse({ kpis: [kpi] }).success, "a valid KPI must parse");

  rejects({ kpis: [{ ...kpi, dialect: undefined }] }, "dialect is required, not defaulted");
  rejects({ kpis: [{ ...kpi, dialect: "something-else" }] }, "dialect accepts only the two known values");
  rejects({ kpis: [{ ...kpi, pointKeys: [] }] }, "a KPI referencing no points cannot be checked");
  rejects({ kpis: [kpi, kpi] }, "two KPIs with the same code must be rejected");

  // ADR 0036: `dialect: "unvalidated"` still parses exactly as before —
  // nothing here forces a migration of stored content. `kpi.expression`
  // ("power / permeate_flow") is not even legal bms-calc-v1 syntax (bare
  // identifiers, no braces), and that is the point: it is accepted anyway.
  assert(
    templateContentSchema.safeParse({ kpis: [{ ...kpi, dialect: "unvalidated" }] }).success,
    "an unvalidated KPI with a garbage expression must still parse",
  );

  const validCalc = {
    code: "SPECIFIC_ENERGY_V2",
    name: "Specific energy",
    pointKeys: ["RO_FEED_PRESSURE", "RO_PERMEATE_FLOW"],
    expression: "({RO_FEED_PRESSURE} + {RO_PERMEATE_FLOW}) / 2",
    dialect: "bms-calc-v1",
  };
  assert(
    templateContentSchema.safeParse({ kpis: [validCalc] }).success,
    "a well-formed bms-calc-v1 KPI must parse",
  );

  const malformedCalc = { ...validCalc, code: "BAD1", expression: "{RO_FEED_PRESSURE} +" };
  rejects({ kpis: [malformedCalc] }, "a syntactically invalid bms-calc-v1 expression must fail");
  const malformedMessage = messagesFor({ kpis: [malformedCalc] });
  assert(
    !malformedMessage.includes("{RO_FEED_PRESSURE} +"),
    `the malformed-expression error must not echo the expression, got: ${malformedMessage}`,
  );

  const unknownFn = { ...validCalc, code: "BAD2", expression: "pow({RO_FEED_PRESSURE}, 2)" };
  rejects({ kpis: [unknownFn] }, "an unknown function such as pow must fail");
  assert(
    !messagesFor({ kpis: [unknownFn] }).includes("pow"),
    "the unknown-function error must not name the function",
  );

  const missingFromPointKeys = {
    ...validCalc,
    code: "BAD3",
    pointKeys: ["RO_FEED_PRESSURE"],
    expression: "{RO_FEED_PRESSURE} + {RO_PERMEATE_FLOW}",
  };
  rejects(
    { kpis: [missingFromPointKeys] },
    "an expression ref missing from pointKeys must fail",
  );

  const unusedPointKey = {
    ...validCalc,
    code: "BAD4",
    pointKeys: ["RO_FEED_PRESSURE", "RO_PERMEATE_FLOW", "UNUSED"],
  };
  rejects(
    { kpis: [unusedPointKey] },
    "a declared pointKeys entry the expression never uses must fail — both directions of the cross-check",
  );

  // ---- dashboards: anchored, ordering only ---------------------------------

  const dashboards = parse({
    dashboards: { overview: { featured: ["RO_FEED_PRESSURE", "RO_PERMEATE_FLOW"] } },
  });
  assert(
    dashboards.dashboards?.overview?.featured[0] === "RO_FEED_PRESSURE",
    "featured order must be preserved — the order IS the information",
  );

  // BACKWARDS COMPATIBILITY FIRST, before anything about widgets: every
  // ADR 0019-era stored row is `featured`-only, nothing backfills them, and
  // `POST :id/draft` byte-copies stored content. A view with no `widgets` key
  // must keep parsing exactly as it did.
  assert(
    parse({ dashboards: { overview: { featured: ["A"] } } }).dashboards?.overview?.widgets ===
      undefined,
    "a pre-F3.1a view carries no widgets and must still parse",
  );

  rejects(
    { dashboards: { overview: { featured: ["A"], layout: "grid" } } },
    "a dashboard view carries ordering and widgets, not an arbitrary layout key",
  );

  // ---- dashboards: widgets, opened by F3.1a (ADR 0047) ---------------------
  //
  // Drift guard first. The config schemas are the shared ones, but the
  // type→config PAIRING is restated here, because a strict authoring arm cannot
  // be built by intersecting the shared union. So assert the arm counts match:
  // a fifth widget type added to @bms/shared and not to this file would
  // otherwise be quietly unusable in a template, with nothing failing.
  assert(
    templateDashboardWidgetVariants.options.length === widgetTypeSchema.options.length,
    `every shared widget type needs a template arm — shared has ${widgetTypeSchema.options.length}, this file has ${templateDashboardWidgetVariants.options.length}`,
  );
  //
  // This block replaces two assertions that required `widgets` to be REFUSED.
  // They were correct under ADR 0019, whose §3 left `dashboards` at ordering
  // only "until F3.1 defines the widget vocabulary", and ADR 0047 is that
  // definition. The flip is the point of this row, not collateral.

  const withWidget = parse({
    dashboards: {
      overview: {
        featured: ["RO_FEED_PRESSURE"],
        widgets: [
          {
            widgetType: "radial_gauge",
            config: { min: 0, max: 100, unit: "%" },
            pointKeys: ["RO_RECOVERY"],
            gridX: 0,
            gridY: 0,
            gridW: 3,
            gridH: 3,
          },
        ],
      },
    },
  });
  assert(
    withWidget.dashboards?.overview?.widgets?.[0]?.widgetType === "radial_gauge",
    "a template widget must parse and narrow on widgetType",
  );

  // A template binds `template_points.point_key` STRINGS, where a live dashboard
  // binds `bms.asset_points.id` as foreign-key rows. The asymmetry is real: a
  // template has no asset yet, so existence is proved by the reference check
  // below rather than by a constraint.
  assert(
    withWidget.dashboards?.overview?.widgets?.[0]?.pointKeys[0] === "RO_RECOVERY",
    "a template widget binds point KEYS, not point ids",
  );

  rejects(
    {
      dashboards: {
        overview: {
          featured: ["A"],
          widgets: [{ widgetType: "mimic", config: {}, pointKeys: ["A"], gridX: 0, gridY: 0, gridW: 2, gridH: 2 }],
        },
      },
    },
    "the widget vocabulary is closed — a kind with no component is refused here too",
  );

  // The behaviour the strictness commit is NAMED for, and which it shipped no test of until
  // this item's correctness review said so. Template content is an AUTHORING body: an unknown
  // key is the author's typo, and dropping it silently loses work the author believes is
  // saved. Both levels are strict — the widget object and the config inside it.
  rejects(
    {
      dashboards: {
        overview: {
          featured: ["A"],
          widgets: [
            {
              widgetType: "value_tile",
              config: {},
              pointKeys: ["A"],
              gridX: 0,
              gridY: 0,
              gridW: 2,
              gridH: 2,
              gridwidth: 2,
            },
          ],
        },
      },
    },
    "a stray key on a template widget must be refused, not dropped",
  );
  rejects(
    {
      dashboards: {
        overview: {
          featured: ["A"],
          widgets: [
            {
              widgetType: "radial_gauge",
              config: { min: 0, max: 100, decimls: 2 },
              pointKeys: ["A"],
              gridX: 0,
              gridY: 0,
              gridW: 2,
              gridH: 2,
            },
          ],
        },
      },
    },
    "a typo inside a widget config must be refused, not dropped",
  );

  rejects(
    {
      dashboards: {
        overview: {
          featured: ["A"],
          widgets: [
            {
              widgetType: "radial_gauge",
              config: { min: 0, max: 100 },
              pointKeys: ["A"],
              gridX: 10,
              gridY: 0,
              gridW: 4,
              gridH: 2,
            },
          ],
        },
      },
    },
    "a widget must fit the 12-column canvas here as well as in SQL",
  );

  const oneWidget = {
    widgetType: "value_tile" as const,
    config: {},
    pointKeys: ["A"],
    gridX: 0,
    gridY: 0,
    gridW: 2,
    gridH: 2,
  };
  rejects(
    {
      dashboards: {
        overview: {
          featured: ["A"],
          widgets: Array.from({ length: 41 }, () => oneWidget),
        },
      },
    },
    "at most 40 widgets per view",
  );
  rejects(
    {
      dashboards: {
        overview: {
          featured: ["A"],
          widgets: [{ ...oneWidget, pointKeys: Array.from({ length: 9 }, (_u, i) => `P${i}`) }],
        },
      },
    },
    "at most 8 point keys per widget",
  );

  // ---- dashboards: per-arm cardinality (ADR 0047 Amendment 3) --------------
  //
  // A single eight-point-gauge refusal would pass against a bound that
  // tightened only radial_gauge. One case per arm, each with its own valid
  // config, because config is required per type.

  const gridFields = { gridX: 0, gridY: 0, gridW: 2, gridH: 2 };

  rejects(
    {
      dashboards: {
        overview: {
          featured: ["A"],
          widgets: [
            {
              widgetType: "radial_gauge",
              config: { min: 0, max: 100 },
              pointKeys: ["A", "B"],
              ...gridFields,
            },
          ],
        },
      },
    },
    "a radial_gauge widget binds exactly one point; two must be refused",
  );

  rejects(
    {
      dashboards: {
        overview: {
          featured: ["A"],
          widgets: [
            {
              widgetType: "tank_level",
              config: { fullScale: 100 },
              pointKeys: ["A", "B"],
              ...gridFields,
            },
          ],
        },
      },
    },
    "a tank_level widget binds exactly one point; two must be refused",
  );

  rejects(
    {
      dashboards: {
        overview: {
          featured: ["A"],
          widgets: [
            {
              widgetType: "value_tile",
              config: {},
              pointKeys: ["A", "B"],
              ...gridFields,
            },
          ],
        },
      },
    },
    "a value_tile widget binds exactly one point; two must be refused",
  );

  assert(
    templateContentSchema.safeParse({
      dashboards: {
        overview: {
          featured: ["A"],
          widgets: [
            {
              widgetType: "chart",
              config: { series: "line" },
              pointKeys: Array.from({ length: 8 }, (_u, i) => `P${i}`),
              ...gridFields,
            },
          ],
        },
      },
    }).success,
    "a chart widget binds up to eight points; eight must be accepted",
  );

  // The completeness loop. Not a substitute for the four explicit cases above
  // — it is the guard that a fifth widget type cannot arrive untested. The
  // anti-vacuity count proves the loop actually ran, so an empty scan cannot
  // read as compliance.
  let cardinalityLoopIterations = 0;
  for (const widgetType of widgetTypeSchema.options) {
    cardinalityLoopIterations += 1;
    const { max } = WIDGET_POINT_CARDINALITY[widgetType];
    const configFor: Record<(typeof widgetTypeSchema.options)[number], Record<string, unknown>> = {
      radial_gauge: { min: 0, max: 100 },
      tank_level: { fullScale: 100 },
      value_tile: {},
      chart: { series: "line" },
    };
    const widgetWith = (pointKeys: string[]) => ({
      dashboards: {
        overview: {
          featured: ["A"],
          widgets: [
            {
              widgetType,
              config: configFor[widgetType],
              pointKeys,
              ...gridFields,
            },
          ],
        },
      },
    });
    rejects(
      widgetWith(Array.from({ length: max + 1 }, (_u, i) => `P${i}`)),
      `${widgetType}: ${max + 1} point keys must be refused (cardinality max is ${max})`,
    );
    assert(
      templateContentSchema.safeParse(widgetWith(Array.from({ length: max }, (_u, i) => `P${i}`)))
        .success,
      `${widgetType}: ${max} point keys must be accepted (cardinality max is ${max})`,
    );
  }
  assert(
    cardinalityLoopIterations === widgetTypeSchema.options.length &&
      cardinalityLoopIterations === 4,
    `the completeness loop must run once per widget type, ran ${cardinalityLoopIterations} times`,
  );

  // ---- limits --------------------------------------------------------------

  const manyAlarms = Array.from({ length: 201 }, (_unused, index) => ({
    ...alarm,
    code: `A${index}`,
  }));
  rejects({ alarms: manyAlarms }, "at most 200 alarms per template");

  const manyViews = Object.fromEntries(
    Array.from({ length: 21 }, (_unused, index) => [`view${index}`, { featured: ["A"] }]),
  );
  // Asserted on the message, not just on rejection: this cap is a `.refine` on
  // the record rather than an array `.max()`, so it reports at the record level
  // with no path. If the message did not name the limit, an author would see a
  // bare "Invalid input" against the whole `dashboards` object.
  const viewsMessage = messagesFor({ dashboards: manyViews });
  assert(
    viewsMessage.includes("20") && /dashboard views/i.test(viewsMessage),
    `the view cap must name itself, got: ${viewsMessage}`,
  );

  rejects(
    { kpis: [{ ...kpi, pointKeys: Array.from({ length: 21 }, (_u, i) => `P${i}`) }] },
    "at most 20 point references per KPI",
  );

  // Bulk is bounded independently of entry counts: one enormous free-text field
  // would otherwise slip past every array cap.
  const huge = {
    alarms: [{ ...alarm, message: "x".repeat(400) }],
    maintenance: Array.from({ length: 100 }, (_unused, index) => ({
      title: `Plan ${index}`,
      intervalDays: 30,
      description: "y".repeat(3_900),
    })),
  };
  const hugeMessage = messagesFor(huge);
  assert(
    hugeMessage.includes(String(MAX_CONTENT_BYTES)),
    `an oversized payload must name the byte limit, got: ${hugeMessage}`,
  );

  // ---- hostile input -------------------------------------------------------

  // `JSON.parse` is iterative in V8, `JSON.stringify` is not. Without a depth
  // check *before* the size check, this ~10 KB payload throws a RangeError out
  // of `safeParse` — not a ZodError — which the controller's `instanceof
  // ZodError` guard rethrows into a 500, on a route whose authorization has not
  // run yet. `safeParse` must return a verdict here, never throw.
  let deep: unknown = "leaf";
  for (let i = 0; i < 5_000; i += 1) {
    deep = [deep];
  }
  let threw: string | null = null;
  let deepResult = true;
  try {
    deepResult = templateContentSchema.safeParse({ kpis: deep }).success;
  } catch (err) {
    threw = err instanceof Error ? err.name : String(err);
  }
  assert(threw === null, `deeply nested content must not throw ${String(threw)} out of safeParse`);
  assert(deepResult === false, "deeply nested content must be rejected");
  const deepMessage = messagesFor({ kpis: deep });
  assert(
    /nests deeper/i.test(deepMessage),
    `the depth rejection must say what it rejected, got: ${deepMessage}`,
  );

  // zod drops `__proto__` while merging parsed pairs, so a view named that
  // would validate, contribute no references to the check, and then vanish on
  // the jsonb write — a 200 for a dashboard that no longer exists. `constructor`
  // survives instead, which is worse for whoever iterates these keys later.
  for (const unsafe of ["__proto__", "constructor", "prototype"]) {
    rejects(
      JSON.parse(`{"dashboards":{"${unsafe}":{"featured":["A"]}}}`),
      `a dashboard view named ${unsafe} must be rejected, not silently dropped`,
    );
    rejects(
      JSON.parse(`{"${unsafe}":{"health":{}}}`),
      `${unsafe} must be rejected as a top-level section name`,
    );
  }
  // And the guard must not have polluted anything while proving it.
  assert(
    ({} as Record<string, unknown>).featured === undefined,
    "validating hostile keys must not touch Object.prototype",
  );

  // ---- reference collection ------------------------------------------------

  const full = parse({
    kpis: [kpi],
    alarms: [alarm],
    dashboards: { overview: { featured: ["RO_TEMP"] } },
  });

  const refs = collectContentPointRefs(full);
  assert(
    refs.includes("RO_FEED_PRESSURE") &&
      refs.includes("RO_PERMEATE_FLOW") &&
      refs.includes("RO_TEMP"),
    `every section must contribute references, got ${refs.join(",")}`,
  );
  // Maintenance plans carry no point keys, so they must contribute nothing —
  // a plan is calendar-driven, not tag-driven.
  const maintenanceOnly = parse({ maintenance: [{ title: "CIP", intervalDays: 90 }] });
  assert(
    collectContentPointRefs(maintenanceOnly).length === 0,
    "maintenance plans reference no point keys",
  );

  const unresolved = findUnresolvedContentRefs(full, ["RO_FEED_PRESSURE"]);
  assert(
    unresolved.join(",") === "RO_PERMEATE_FLOW,RO_TEMP",
    `unresolved refs must be deduped and sorted, got ${unresolved.join(",")}`,
  );
  assert(
    findUnresolvedContentRefs(full, ["RO_FEED_PRESSURE", "RO_PERMEATE_FLOW", "RO_TEMP"]).length ===
      0,
    "a fully declared template must report nothing unresolved",
  );
  // The catalog is deliberately NOT the scope: a key that exists org-wide but is
  // absent from this template still produces an asset without that point.
  assert(
    findUnresolvedContentRefs(parse({ alarms: [alarm] }), []).join(",") === "RO_FEED_PRESSURE",
    "an empty template declares nothing, so every reference is unresolved",
  );

  // ---- the assertion F3.1a exists to make -----------------------------------
  //
  // `collectContentPointRefs` is the single function that decides whether ADR
  // 0019's guarantee reaches the new half. `assertContentRefsResolve` calls
  // `findUnresolvedContentRefs`, which calls this, from THREE places in
  // `asset-templates.service.ts` — create, update and publish. If the walk does
  // not descend into `widgets[].pointKeys`, all three checks silently stop
  // covering widgets, nothing in the type system says so, and ADR 0019 §3's
  // tier promotion becomes a claim rather than a fact.
  //
  // The failure it prevents is concrete: `content` and `points` are patched
  // independently, so a points patch can orphan a widget binding the request
  // never mentioned, and the template still publishes.
  const widgetRefs = parse({
    dashboards: {
      overview: {
        featured: ["RO_TEMP"],
        widgets: [
          {
            widgetType: "chart",
            config: { series: "line" },
            pointKeys: ["RO_RECOVERY", "RO_FLUX"],
            gridX: 0,
            gridY: 0,
            gridW: 6,
            gridH: 4,
          },
        ],
      },
    },
  });
  assert(
    collectContentPointRefs(widgetRefs).join(",") === "RO_TEMP,RO_RECOVERY,RO_FLUX",
    `a widget's point keys must be collected after the view's featured order, got ${collectContentPointRefs(widgetRefs).join(",")}`,
  );
  assert(
    findUnresolvedContentRefs(widgetRefs, ["RO_TEMP"]).join(",") === "RO_FLUX,RO_RECOVERY",
    `a widget binding a point the template does not declare must be reported unresolved, got ${findUnresolvedContentRefs(widgetRefs, ["RO_TEMP"]).join(",")}`,
  );
}
