import {
  MAX_CONTENT_BYTES,
  collectContentPointRefs,
  findUnresolvedContentRefs,
  templateContentSchema,
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

  // `packages/shared` AutomationRuleOperator has no `neq`, and severity is three
  // values. A template authoring either would author an alarm the rule engine
  // cannot run — which is the entire argument for importing the enums.
  rejects({ alarms: [{ ...alarm, operator: "neq" }] }, "`neq` is not a live operator");
  rejects({ alarms: [{ ...alarm, severity: "major" }] }, "`major` is not a live severity");
  rejects({ alarms: [{ ...alarm, severity: "minor" }] }, "`minor` is not a live severity");
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

  // The dialect literal is what lets F2.3 add its own value and migrate on its
  // own schedule. Accepting an arbitrary string here would let a pack claim its
  // expressions had been validated when nothing has a parser yet.
  rejects({ kpis: [{ ...kpi, dialect: "bms-calc-v1" }] }, "F2.3 has not landed its dialect yet");
  rejects({ kpis: [{ ...kpi, dialect: undefined }] }, "dialect is required, not defaulted");
  rejects({ kpis: [{ ...kpi, pointKeys: [] }] }, "a KPI referencing no points cannot be checked");
  rejects({ kpis: [kpi, kpi] }, "two KPIs with the same code must be rejected");

  // ---- dashboards: anchored, ordering only ---------------------------------

  const dashboards = parse({
    dashboards: { overview: { featured: ["RO_FEED_PRESSURE", "RO_PERMEATE_FLOW"] } },
  });
  assert(
    dashboards.dashboards?.overview?.featured[0] === "RO_FEED_PRESSURE",
    "featured order must be preserved — the order IS the information",
  );

  // F3.1 owns the widget vocabulary. A pack that authors one now is a pack that
  // gets rewritten when F3.1 disagrees.
  rejects(
    { dashboards: { overview: { featured: ["A"], layout: "grid" } } },
    "a dashboard view carries ordering and nothing else",
  );
  rejects(
    { dashboards: { overview: { widgets: [] } } },
    "`widgets` is F3.1's vocabulary, not this contract's",
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
}
