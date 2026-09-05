import { z } from "zod";

import {
  alarmSkillCodeSchema,
  CALC_DIALECTS,
  // F3.1a: the four widget config schemas, reused rather than restated (§4.8 — "a vocabulary
  // is declared once and everything else is derived from it"). `@bms/shared` and not
  // `@bms/shared/contracts`, because apps/api compiles with moduleResolution "node" and
  // ignores the exports map — ADR 0030 Amendment 2.
  chartConfigSchema,
  DASHBOARD_GRID,
  formatCalcError,
  GAUGE_RANGE_MESSAGE,
  gaugeRangeIsOrdered,
  gaugeThresholdSchema,
  MAX_DASHBOARD_WIDGETS,
  MAX_FORMULA_POINT_REFS,
  MAX_GAUGE_THRESHOLDS,
  radialGaugeConfigObjectSchema,
  tankLevelConfigSchema,
  validateFormula,
  valueTileConfigSchema,
  WIDGET_POINT_CARDINALITY,
} from "@bms/shared";
import type { TemplateContent, WidgetType } from "@bms/shared";

import {
  maintenanceCategorySchema,
  maintenanceGenerationModeSchema,
  maintenancePrioritySchema,
} from "../../maintenance/maintenance.schema";
import { categorySchema, operatorSchema, severitySchema } from "../../rules/rules.schema";

/** ADR 0034 (`E2.1`): a code into `bms.alarm_skills`. Declared once and
 * re-exported, matching how `severitySchema` binds to the rule vocabulary. */
export const skillSchema = alarmSkillCodeSchema;

/**
 * The `asset_templates.content` contract (ADR 0019, backlog `E1.7`).
 *
 * ADR 0015 reserved the column and left it `z.record(z.unknown())`. This file is
 * the tightening, and its central rule is that a section is contracted only as
 * far as a consumer exists to contract it against:
 *
 * - **Bound** — the consumer is on `main`. `alarms` and `maintenance` import
 *   their enums from `rules.schema` and `maintenance.schema` rather than
 *   restating them. `alarms.philosophy.skill` joined this list under ADR 0034
 *   (`E2.1`), importing from `@bms/shared` directly rather than through
 *   `rules.schema` — a skill is not a rule concern.
 * - **Anchored** — the consumer is unbuilt but the *references* are checkable
 *   today. `kpis.expression` is validated under `bms-calc-v1` (ADR 0036,
 *   `F2.3`) when `dialect` says so, and stays opaque behind `"unvalidated"`
 *   for content written before that grammar existed. `dashboards` carried
 *   ordering and nothing else until `F3.1a`; ADR 0047 gave it the widget
 *   vocabulary, so a view now also carries typed `widgets[]` whose point keys
 *   the reference check reaches.
 *   `health` joined this list under ADR 0050 decision 7 (`E1.3`): the roll-up
 *   that consumes it lands in the same branch, so the tier is contracted rather
 *   than reserved. It carries weights and bands and nothing that computes —
 *   ADR 0050 decision 1 keeps aggregation out of the formula.
 * - **Reserved** — `optimisation` is rejected, naming its own blocking item. A
 *   reserved key that is silently accepted lets `E5.1` author a shape `E1.6`
 *   will contradict, and the contradiction surfaces a year later with packs in
 *   the field.
 *
 * Nothing here is wired to an engine. A template alarm cannot become a
 * `bms.automation_rules` row (that needs `ruleType`/`condition`/`action`, none
 * of which a template carries) and a maintenance plan cannot become a
 * `bms.maintenance_task_templates` row (its `asset_id` is `NOT NULL`). This is
 * the authoring surface; deploying it is `E2.x`/`E3.x` work with its own ADR.
 */

/**
 * Measured on the `content` subtree after JSON parse, before the object schema
 * — deliberately not a global body limit, which would apply to every route.
 *
 * Over HTTP this is a backstop, not the binding constraint: `main.ts` sets no
 * body-parser options, so `@nestjs/platform-express` applies `bodyParser.json()`
 * defaults and a body over **100 KB** is rejected with 413 before any of this
 * runs. Where this cap does bind is `parseStoredContent` — a row written under
 * `F2.1`'s permissive contract has never passed through any size check at all.
 */
export const MAX_CONTENT_BYTES = 256 * 1024;

/**
 * `JSON.parse` is iterative in V8; `JSON.stringify` is **not**. So JSON nested
 * a few thousand deep parses fine and then overflows the stack inside the size
 * check below — a `RangeError`, not a `ZodError`, which the controller's
 * `instanceof ZodError` guard rethrows into a 500. Under 10 KB of body, from
 * any authenticated caller, on a route whose authorization check has not run
 * yet.
 *
 * So depth is checked first, iteratively, and nothing recursive touches the
 * value until it passes. Real content nests about five deep
 * (`kpis` → entry → `pointKeys` → string); twelve is room to spare.
 */
const MAX_CONTENT_DEPTH = 12;

/** Iterative — a recursive depth check would be the very bug it looks for. */
function exceedsDepth(value: unknown, limit: number): boolean {
  const stack: { node: unknown; depth: number }[] = [{ node: value, depth: 1 }];
  while (stack.length > 0) {
    const frame = stack.pop();
    if (!frame) {
      break;
    }
    if (frame.depth > limit) {
      return true;
    }
    const { node, depth } = frame;
    if (Array.isArray(node)) {
      for (const child of node) {
        stack.push({ node: child, depth: depth + 1 });
      }
    } else if (node !== null && typeof node === "object") {
      for (const child of Object.values(node)) {
        stack.push({ node: child, depth: depth + 1 });
      }
    }
  }
  return false;
}

/**
 * Keys that are never legitimate content sections or view names, and that turn
 * into silent data loss if accepted: `zod` drops `__proto__` while merging
 * parsed pairs, so a `dashboards` view named `__proto__` validates, contributes
 * no point references to the check, and then vanishes on the `jsonb` write —
 * the author gets a 200 for a dashboard that no longer exists. `constructor`
 * and `prototype` survive instead, which is worse for whoever later iterates
 * these keys.
 *
 * Rejected explicitly rather than left to zod: that drop is a library
 * implementation detail under a `^3.24.1` caret range, and nothing here would
 * notice if it changed.
 */
const UNSAFE_KEYS = ["__proto__", "constructor", "prototype"];

/**
 * Guards a record's **keys**, which is the only place this can be caught.
 *
 * `zod` validates key schemas against the input's own keys, but strips
 * `__proto__` when merging the parsed pairs into its output — so a refinement
 * reading the *output* never sees it, while one on the key schema does.
 */
const safeKeySchema = z
  .string()
  .refine((name) => !UNSAFE_KEYS.includes(name), {
    message: `Not a usable key here: ${UNSAFE_KEYS.join(", ")}`,
  })
  .describe(`Must not be one of the prototype-pollution keys: ${UNSAFE_KEYS.join(", ")}.`);
const MAX_SECTION_ENTRIES = 200;
const MAX_DASHBOARD_VIEWS = 20;
const MAX_FEATURED_POINTS = 50;
// F3.1a (ADR 0047). Depth budget while these were added: raw → dashboards → view →
// widgets[] → widget → config → thresholds[] → threshold is 8 levels against
// MAX_CONTENT_DEPTH = 12. It fits; a further nested option would not.
//
// `MAX_DASHBOARD_WIDGETS` itself moved to `@bms/shared/contracts/dashboard-builder` in `F3.1b`,
// once the live dashboard table it bounds existed, so this file imports it rather than keeping
// a second copy the two write paths could drift apart on.
//
// `F3.1b` also carried a `MAX_WIDGET_POINT_KEYS = MAX_WIDGET_POINTS` here, and it is gone: `F3.1e`
// landed first and bounds each widget arm with `WIDGET_POINT_CARDINALITY[type].max` instead, which
// is per-arm where a single number was not — a gauge takes one point, a chart takes eight.
// ADR 0036 decision 8: reused, not restated, so the two numbers cannot drift.
const MAX_KPI_POINT_REFS = MAX_FORMULA_POINT_REFS;

/**
 * Keys that will mean something later and mean nothing now. Each names its own
 * blocking item: one shared message would point an author blocked on
 * `optimisation` at an item three waves earlier and a priority band off.
 *
 * **`health` left this map in `E1.3`** (ADR 0050 decision 7). It named
 * `E1.1 (ML serving foundation)`, and that edge was retired by the client's own
 * 2026-08-22 answer — the five-input SOW §4.3 score that still needs `E1.1`
 * took its own row, `E1.8`. The map keeps its plural shape on purpose:
 * `optimisation` is not the last word here, and a single-entry map that became
 * a bare constant would have to be rebuilt to add the next one.
 */
const RESERVED_SECTIONS: Record<string, string> = {
  optimisation: "E1.6 (optimisation advisories)",
};

/** A reference to a `template_points.point_key` on the same template. Existence
 * is checked separately — see `findUnresolvedContentRefs`. */
const pointKeyRef = z.string().min(1).max(128);

const alarmPhilosophySchema = z
  .object({
    cause: z.string().max(2000).optional(),
    impact: z.string().max(2000).optional(),
    action: z.string().max(2000).optional(),
    /** ADR 0034 (`E2.1`): a code into `bms.alarm_skills`, checked for shape
     * only here — `assertTemplateAlarmVocabularies` closes the set. */
    skill: skillSchema.optional(),
  })
  .strict();

/**
 * ADR 0034 landed `E2.1`: `skill` above is now coded, and its vocabulary is
 * enforced by `assertTemplateAlarmVocabularies`. The other three enrichment
 * fields — affected assets, energy/water/production impact, ETR — remain
 * properties of a **live alarm instance**, not of an asset class, so a
 * template still cannot carry them. That is a boundary, not a subset.
 *
 * **`operator` and `thresholdValue` are a paired optional group — ADR 0019
 * Amendment 2, decisions 1 and 2.** Both present makes this row a
 * site-independent proto-rule. Both absent makes it an alarm PHILOSOPHY row
 * — parameter, meaning, severity, category, philosophy, the ISA-18.2
 * rationalization record for the asset class — for a meaning whose limit is
 * set per site at commissioning (B7) and cannot be guessed at authoring
 * time. One present without the other is refused by the `superRefine` below:
 * an operator with no number, or a number with no comparator, is half a
 * rule.
 *
 * **The ADR's own file reference is stale**: decision 5 names
 * `asset-templates.schema.ts`; the alarm schema actually lives here, in
 * `asset-templates-content.schema.ts`. Corrected here rather than in the ADR
 * text, which is a historical record.
 */
const templateAlarmSchema = z
  .object({
    code: z.string().min(1).max(64),
    pointKey: pointKeyRef,
    operator: operatorSchema.optional(),
    thresholdValue: z.number().finite().optional(),
    severity: severitySchema,
    message: z.string().min(1).max(500),
    category: categorySchema.optional(),
    philosophy: alarmPhilosophySchema.optional(),
  })
  // `.strict()` must sit on the object, before `.superRefine` — a
  // `ZodEffects` has no `.strict()`. Nothing may separate `.superRefine(...)`
  // from the `.describe(...)` below it (tests/adr-0029-openapi-contract.test.ts).
  .strict()
  .superRefine((alarm, ctx) => {
    const hasOperator = alarm.operator !== undefined;
    const hasThreshold = alarm.thresholdValue !== undefined;
    if (hasOperator !== hasThreshold) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["thresholdValue"],
        message:
          "An operator with no number, or a number with no comparator, is half a rule — " +
          "supply both operator and thresholdValue, or neither.",
      });
    }
  })
  .describe(
    "`operator` and `thresholdValue` are a paired optional group: supply both to author a " +
      "site-independent proto-rule, or neither to author an alarm philosophy row with its " +
      "limit set per site at commissioning. One without the other is refused.",
  );

/**
 * The dialects a KPI may declare: the pre-ADR-0036 escape hatch, plus every
 * real grammar — **spread from `CALC_DIALECTS`, never listed** (§4.8). ADR 0055
 * decision 2 says the KPI dialect widens with the calc grammar, and the owner's
 * `F2.9` Q3 ruling took that sentence literally, so the day a third grammar
 * exists this schema must accept it without an edit here.
 */
const KPI_DIALECTS = ["unvalidated", ...CALC_DIALECTS] as const;

/** A KPI that names no point at all cannot be cross-checked against anything,
 * so it is refused rather than stored as an unverifiable row. Two messages
 * because the two cases are genuinely different: one is not parsed, the other
 * was parsed and found to reference nothing. */
const KPI_NO_POINT_KEYS_UNVALIDATED =
  'An "unvalidated" KPI is not parsed, so pointKeys is the only record of what it reads — ' +
  "it must name at least one point";
const KPI_NO_REFERENCES =
  "A KPI must reference at least one point: pointKeys is empty and expression names none, " +
  "local or cross-asset";

/**
 * `pointKeys` is separate from `expression` on purpose: it is what makes the
 * reference check possible. Historically that was "possible without a formula
 * parser" — `F2.3` had not built one yet. Now that it has (ADR 0036), a real
 * dialect turns `pointKeys` from an unverified bookkeeping array into a real
 * two-way cross-check: every `{ref}` in `expression` must appear in
 * `pointKeys`, and every entry in `pointKeys` must be used. A KPI left at
 * `dialect: "unvalidated"` still validates exactly as before — nothing here
 * forces a migration of stored content; re-validation only happens on the next
 * author write.
 *
 * **`bms-calc-v2` and what `pointKeys` means under it** (ADR 0055 decision 2;
 * the owner's `F2.9` Q3b ruling). `pointKeys` keeps its meaning: it lists the
 * **local** point keys the expression references. A key that appears solely
 * inside an aggregate (`sum({kw} @site)`) or a qualified reference
 * (`{TX_01.kwh}`) is exempt from **both** directions, because the asset it
 * resolves against is not known until evaluation time. That exemption needs no
 * code of its own: `parseFormula` already splits local `refs` from `crossRefs`,
 * and `validateFormula` checks local references only. **The check is narrowed,
 * not disabled** — under `v2` a declared key the expression uses in no local
 * reference is still refused, and
 * `asset-templates-content.schema.spec.ts` proves it with that exact case.
 *
 * **Why `pointKeys` lost its `.min(1)` array bound.** A `v2` KPI whose every
 * reference is cross-asset has no local keys at all, so `["…"].min(1)` would
 * make the ruling's own headline example unstorable. The rule it enforced is
 * kept below, one level down, where it can see what the expression actually
 * references: an empty `pointKeys` is refused unless the parse found a
 * cross-asset reference. Every `v1` and `"unvalidated"` outcome is unchanged
 * (`crossRefs` is always `[]` under `v1`); only the issue code moves from
 * `too_small` to `custom`.
 */
const templateKpiSchema = z
  .object({
    code: z.string().min(1).max(64),
    name: z.string().min(1).max(255),
    unit: z.string().max(32).optional(),
    pointKeys: z.array(pointKeyRef).max(MAX_KPI_POINT_REFS),
    expression: z.string().min(1).max(1000),
    dialect: z.enum(KPI_DIALECTS),
    higherIsBetter: z.boolean().optional(),
  })
  .strict()
  .superRefine((kpi, ctx) => {
    if (kpi.dialect === "unvalidated") {
      if (kpi.pointKeys.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["pointKeys"],
          message: KPI_NO_POINT_KEYS_UNVALIDATED,
        });
      }
      return;
    }
    // Parsed under whichever real dialect the KPI names — not under a
    // hardcoded `v1`. A `v2` expression handed to the `v1` parser fails at the
    // `@`, which would refuse the grammar the row is allowed to declare.
    const result = validateFormula(kpi.expression, kpi.pointKeys, { dialect: kpi.dialect });
    if (!result.ok) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expression"],
        message: `Invalid expression: ${formatCalcError(result.errors[0])}`,
      });
      return;
    }
    if (kpi.pointKeys.length === 0 && result.crossRefs.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["pointKeys"],
        message: KPI_NO_REFERENCES,
      });
    }
    // The other direction — every LOCAL `{ref}` in `expression` resolves to a
    // declared key — was already checked by `validateFormula` above
    // (`unknown_reference` fails it). This is only the reverse: a declared
    // key the expression never uses. Does not also catch a *duplicate*
    // pointKeys entry (["A","A"] with expression "{A}" passes both checks) —
    // harmless, and pre-existing: pointKeys carried no uniqueness rule before
    // this dialect existed either.
    //
    // `result.refs` is local-only by construction, which is exactly the Q3b
    // rule: a key used only inside an aggregate does not count as "used", so
    // declaring it is still an error, and NOT declaring it is still fine.
    const used = new Set(result.refs);
    const unused = kpi.pointKeys.filter((key) => !used.has(key));
    if (unused.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["pointKeys"],
        message: "Every entry in pointKeys must be referenced by expression at least once",
      });
    }
  })
  .describe(
    `When dialect is one of ${CALC_DIALECTS.join(" / ")}, expression is parsed under that ` +
      "grammar and rejected on syntax error or unknown function; every entry in pointKeys must " +
      "be used by expression at least once as a LOCAL reference, and every local {ref} in " +
      "expression must appear in pointKeys. A cross-asset reference (an aggregate such as " +
      "sum({kw} @site), or a qualified {CODE.key}) is exempt from both directions — the asset " +
      'it resolves against is not known until evaluation time. A "unvalidated" KPI is not ' +
      "parsed, and must then declare at least one pointKey.",
  );

/** `createMaintenanceScheduleBodySchema` minus the two fields only an instance
 * can know (`assetId`, `firstDueAt`). */
const templateMaintenancePlanSchema = z
  .object({
    title: z.string().min(3).max(255),
    description: z.string().max(4000).optional(),
    category: maintenanceCategorySchema.default("preventive"),
    generationMode: maintenanceGenerationModeSchema.default("calendar"),
    ownerTeam: z.string().max(128).optional(),
    vendorName: z.string().max(128).optional(),
    complianceRef: z.string().max(128).optional(),
    triggerSummary: z.string().max(2000).optional(),
    safetyCritical: z.boolean().default(false),
    priority: maintenancePrioritySchema.default("medium"),
    estimatedMinutes: z.number().int().min(5).max(1_440).default(60),
    intervalDays: z.number().int().min(1).max(730),
  })
  .strict();

/**
 * One widget on a template dashboard (`F3.1a`, ADR 0047).
 *
 * The type-and-config half is the **shared** union, re-exported and not restated — §4.8's "a
 * vocabulary is declared once and everything else is derived from it", the rule
 * `rules.schema.ts` already follows. `z.intersection` because §4.8 prescribes it for `A & B`
 * and because a `z.discriminatedUnion` cannot be `.extend()`ed anyway.
 *
 * `pointKeyRef` stays local rather than moving to `@bms/shared`: it is this file's
 * character-class contract for a `template_points.point_key`, and moving it would drag the
 * whole content vocabulary across a package boundary.
 *
 * The grid is bounded here as well as by `dashboard_widgets_grid_bounds_check`, so a template
 * author gets a 400 naming the field rather than a 500 carrying a constraint name.
 *
 * **The numbers come from `DASHBOARD_GRID` and are not restated** (`F3.1d`). This is the same
 * canvas, not a coincidence that two bounds match: the docblock above already names
 * `dashboard_widgets_grid_bounds_check` as the other enforcer of *this* rule, and `F3.2`
 * instantiates a template's dashboard straight into `bms.dashboard_widgets`, so a template
 * widget that this schema accepts and that check refuses is a defect by construction. It is the
 * `WIDGET_POINT_CARDINALITY` case one field down, decided the same way ADR 0047 Amendment 3
 * decided that one: a rule enforced only by the surface that happens to be convenient is not
 * enforced. `tests/f3.1d-grid-bounds-single-source.test.ts` is what keeps a copy from returning.
 */
const templateWidgetIdentityFields = {
  title: z.string().max(255).optional(),
  gridX: z.number().int().min(0).max(DASHBOARD_GRID.columns - 1),
  gridY: z.number().int().min(0),
  gridW: z.number().int().min(DASHBOARD_GRID.minWidgetW).max(DASHBOARD_GRID.columns),
  gridH: z.number().int().min(DASHBOARD_GRID.minWidgetH).max(DASHBOARD_GRID.maxWidgetH),
};

/**
 * How many point keys one widget of this type may bind (ADR 0047 Amendment 3).
 *
 * The numbers are **not** restated here. `WIDGET_POINT_CARDINALITY` is where the
 * cardinality is declared (ADR 0047 Amendment 2 §1) and every surface derives from
 * it; an arm that hardcodes `1` re-opens the seam that amendment closed.
 *
 * `.min(1)` stays on every arm even though the shared docblock's *"`min` is an
 * authoring rule and never a stored invariant"* (`dashboard-builder.ts:214-218`)
 * says a live widget may legitimately fall to zero bindings after a cascaded
 * point deletion. That note is about the **read** path `F3.1b`/`F3.1c` own — this
 * is the **authoring** body, where a widget with no binding is not a widget an
 * author can usefully create.
 */
const widgetPointKeys = (widgetType: WidgetType) =>
  z
    .array(pointKeyRef)
    .min(WIDGET_POINT_CARDINALITY[widgetType].min)
    .max(WIDGET_POINT_CARDINALITY[widgetType].max);

/**
 * The four arms, spread rather than intersected — and the reason is that this surface must
 * stay **strict** while `@bms/shared`'s must not.
 *
 * The first draft wrote `z.intersection(identity.strict(), dashboardWidgetSpecSchema)`. It
 * parsed nothing: two strict halves each reject the other's keys, so every widget failed with
 * `unrecognized_keys: widgetType, config`. Dropping `.strict()` is the fix on the shared side,
 * where §4.8 requires a tolerant *response* contract — but `content` is an **authoring** body,
 * where an unknown key is an author's typo that must be refused rather than silently dropped,
 * and `contentEnvelopeSchema` and every sibling here are strict for exactly that reason.
 *
 * So the identity fields are spread into each arm, which is the same technique the shared file
 * uses for its common config fields and for the same underlying constraint:
 * `z.discriminatedUnion` accepts only `ZodObject` arms, so neither `.extend()` (banned in
 * `contracts/`, and flattening anyway) nor `z.intersection` can build one.
 *
 * **The config schemas are still the shared ones** — the vocabulary is declared once. What is
 * restated here is only the type→config pairing, and `templateDashboardWidgetVariants` is
 * exported so the spec can check its arms against the shared vocabulary: a widget type added to
 * `@bms/shared` and not to this file fails the build rather than being quietly unusable in
 * templates.
 *
 * **The arms are the types a template can fully bind, which since `F3.35` Stage B is not all of
 * them.** `table` is absent deliberately — see `TemplateDashboardWidget`'s docblock in
 * `packages/shared/src/asset-template-content.ts` for the whole argument. In short: a template
 * binds point-key strings and cannot express a `bms.dashboard_widget_sources` row, and a
 * `table` binds no point and requires exactly one source. An arm here would let an author
 * create a widget that `F3.2` instantiates into a card that can never render.
 *
 * The spec derives the expected arm list from `WIDGET_SOURCE_CARDINALITY` rather than counting
 * to four, so this stays honest when a sixth type lands: a type needing a source is expected to
 * be absent, and any other type is expected to be present.
 */
export const templateDashboardWidgetVariants = z.discriminatedUnion("widgetType", [
  z
    .object({
      ...templateWidgetIdentityFields,
      widgetType: z.literal("radial_gauge"),
      pointKeys: widgetPointKeys("radial_gauge"),
      // `.strict()` before `.refine()`: the shared export is a ZodEffects, which has no
      // `.strict()`, so the object and the range rule are composed here from the two pieces
      // `@bms/shared` exports for exactly this. The rule is still declared once.
      // `.strict()` before `.refine()`, and the thresholds array restated with a strict item:
      // the shared exports stay tolerant for the response direction (§4.8), so every level an
      // author can type into is tightened here instead. `.extend()` preserves `unknownKeys`,
      // so the object stays strict — and `.extend()` is legal in `apps/api`; the ADR 0030 ban
      // covers `packages/shared/src/contracts/` only.
      config: radialGaugeConfigObjectSchema
        .strict()
        .extend({
          thresholds: z
            .array(gaugeThresholdSchema.strict())
            .max(MAX_GAUGE_THRESHOLDS)
            .optional(),
        })
        .refine(gaugeRangeIsOrdered, { message: GAUGE_RANGE_MESSAGE, path: ["max"] })
        .describe(
          "A radial gauge's scale. `max` must be greater than `min`: an inverted or empty " +
            "range gives the needle no defined position, and zod-to-json-schema emits nothing " +
            "for a refinement, so without this line the document would promise a 200 the API " +
            "answers with a 400 (ADR 0029 Amendment 1).",
        ),
    })
    .strict(),
  z
    .object({
      ...templateWidgetIdentityFields,
      widgetType: z.literal("tank_level"),
      pointKeys: widgetPointKeys("tank_level"),
      config: tankLevelConfigSchema.strict(),
    })
    .strict(),
  z
    .object({
      ...templateWidgetIdentityFields,
      widgetType: z.literal("value_tile"),
      pointKeys: widgetPointKeys("value_tile"),
      config: valueTileConfigSchema.strict(),
    })
    .strict(),
  z
    .object({
      ...templateWidgetIdentityFields,
      widgetType: z.literal("chart"),
      pointKeys: widgetPointKeys("chart"),
      config: chartConfigSchema.strict(),
    })
    .strict(),
]);

const templateDashboardWidgetSchema = templateDashboardWidgetVariants
  .refine((widget) => widget.gridX + widget.gridW <= DASHBOARD_GRID.columns, {
    message: `a widget must fit inside the ${DASHBOARD_GRID.columns}-column canvas`,
    path: ["gridW"],
  })
  .describe(
    "A widget on a template's default dashboard. `gridX` plus its width must not exceed " +
      `${DASHBOARD_GRID.columns}: that is the width of the canvas, and ` +
      "`dashboard_widgets_grid_bounds_check` enforces the same bound in SQL, so an author who " +
      "overflows it gets a 400 naming the field rather than a 500 carrying a constraint name.",
  );

/**
 * A dashboard view: the ADR 0019 ordering, and — since `F3.1a` — the widgets drawn from it.
 *
 * `featured` is unchanged and stays required: it is what a consumer with no widget support
 * reads, and every row stored before ADR 0047 has only this key. `widgets` is **optional** for
 * the same reason — nothing backfills those rows, and `POST :id/draft` byte-copies stored
 * content, so requiring `widgets` would strand a pre-`F3.1a` template behind its own immutable
 * published version.
 *
 * This schema used to refuse a `widgets` key outright, and its comment said the vocabulary was
 * `F3.1`'s. ADR 0047 is that vocabulary. The refusal has moved down a level rather than
 * disappearing: an *undeclared widget type* is still refused, by
 * `dashboardWidgetSpecSchema`'s closed enum.
 */
const templateDashboardViewSchema = z
  .object({
    featured: z.array(pointKeyRef).min(1).max(MAX_FEATURED_POINTS),
    widgets: z.array(templateDashboardWidgetSchema).max(MAX_DASHBOARD_WIDGETS).optional(),
  })
  .strict();

const uniqueBy = <T>(
  entries: T[],
  key: (entry: T) => string,
  ctx: z.RefinementCtx,
  label: string,
): void => {
  const seen = new Set<string>();
  entries.forEach((entry, index) => {
    const value = key(entry);
    if (seen.has(value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index, "code"],
        message: `Duplicate ${label} code "${value}" in this template`,
      });
    }
    seen.add(value);
  });
};

/**
 * At most this many bands. Five are the client's own (Excellent / Good / Fair /
 * Poor / Critical); the cap exists so a pack cannot author a band per percent
 * and turn a legend into a scrollbar.
 */
const MAX_HEALTH_BANDS = 10;

/**
 * The largest weight a tag may carry. A weight is relative, so the ratio is
 * what matters and the absolute bound only stops an author expressing "this one
 * matters" as `1e9` and making every other tag round to nothing in a float sum.
 */
const MAX_HEALTH_WEIGHT = 1000;

const templateHealthBandSchema = z
  .object({
    code: z.string().min(1).max(64),
    label: z.string().min(1).max(128),
    /**
     * Inclusive lower bound, in `0..1` — ADR 0050 Amendment 1 decision 2. Not
     * `0..100`: a band in the other unit is how a cut-point of `0.9` ends up
     * compared against a score of `90`.
     */
    minScore: z.number().min(0).max(1),
  })
  .strict();

/**
 * `health` — weights and bands, and nothing that computes.
 *
 * The two superRefine rules below are the ones worth reading.
 *
 * **Bands must be ordered strictly descending by `minScore`, and the last must
 * be `0`.** Descending because the authored order is the display order, and a
 * band list that reads Critical-first in the UI while resolving Excellent-first
 * in code is the kind of disagreement nobody finds by looking. Strict, because
 * two bands sharing a cut-point make the resolved band depend on array order —
 * legal, but silently unstable across a re-save. And a final `0` because
 * without it a score can fall through every band, which would make `band: null`
 * mean *two* things: "this template has no health block" and "this template's
 * bands do not cover the score". Amendment 1 decision 3 gives `band: null` the
 * first meaning only.
 *
 * **A weight must be finite and positive.** Zero is rejected rather than
 * treated as "exclude this tag": excluding a tag is what ADR 0050 decision 3
 * does, by there being no rule for it, and a second way to spell it that only
 * some code paths honour is worse than no way at all.
 */
export const templateHealthSchema = z
  .object({
    weights: z
      .record(safeKeySchema.pipe(pointKeyRef), z.number().finite().positive().max(MAX_HEALTH_WEIGHT))
      .refine(
        (weights) => Object.keys(weights).length <= MAX_SECTION_ENTRIES,
        `At most ${MAX_SECTION_ENTRIES} weighted points per template`,
      )
      .describe(
        "Point key to relative weight. An omitted point weighs 1.0; a weight must be " +
          `finite, greater than 0 and at most ${MAX_HEALTH_WEIGHT}.`,
      )
      .optional(),
    bands: z
      .array(templateHealthBandSchema)
      .min(1)
      .max(MAX_HEALTH_BANDS)
      .superRefine((bands, ctx) => {
        uniqueBy(bands, (band) => band.code, ctx, "health band");
        bands.forEach((band, index) => {
          const previous = bands[index - 1];
          if (previous !== undefined && band.minScore >= previous.minScore) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: [index, "minScore"],
              message:
                `Health band "${band.code}" has minScore ${band.minScore}, which is not below ` +
                `"${previous.code}"'s ${previous.minScore}. Bands are ordered cut-points and ` +
                "must descend strictly.",
            });
          }
        });
        const last = bands[bands.length - 1];
        if (last !== undefined && last.minScore !== 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [bands.length - 1, "minScore"],
            message:
              `The lowest health band "${last.code}" must start at 0 so every score lands in a ` +
              `band; it starts at ${last.minScore}.`,
          });
        }
      })
      .describe(
        "Ordered cut-points, strictly descending by `minScore`, the last starting at 0 so " +
          "every score in 0..1 lands in exactly one band.",
      ),
  })
  .strict();

const contentEnvelopeSchema = z
  .object({
    contentVersion: z.literal(1).default(1),
    kpis: z
      .array(templateKpiSchema)
      .max(MAX_SECTION_ENTRIES)
      .superRefine((kpis, ctx) => uniqueBy(kpis, (kpi) => kpi.code, ctx, "KPI"))
      .describe("Every KPI `code` must be unique within this array.")
      .optional(),
    alarms: z
      .array(templateAlarmSchema)
      .max(MAX_SECTION_ENTRIES)
      .superRefine((alarms, ctx) => uniqueBy(alarms, (alarm) => alarm.code, ctx, "alarm"))
      .describe("Every alarm `code` must be unique within this array.")
      .optional(),
    maintenance: z.array(templateMaintenancePlanSchema).max(MAX_SECTION_ENTRIES).optional(),
    dashboards: z
      .record(safeKeySchema.pipe(z.string().min(1).max(64)), templateDashboardViewSchema)
      .refine(
        (views) => Object.keys(views).length <= MAX_DASHBOARD_VIEWS,
        `At most ${MAX_DASHBOARD_VIEWS} dashboard views per template`,
      )
      .describe(`At most ${MAX_DASHBOARD_VIEWS} dashboard views per template.`)
      .optional(),
    /** ADR 0050 decision 7 (`E1.3`). Optional: nothing backfills a stored row,
     * and `POST :id/draft` byte-copies published content, so a required `health`
     * would strand every template written before this branch. */
    health: templateHealthSchema.optional(),
  })
  .strict();

/**
 * The `content` contract.
 *
 * Built as record → refine → pipe rather than a bare `.strict()` object so the
 * reserved-key and size checks can produce their own messages: a `.strict()`
 * failure short-circuits the object's own `superRefine`, so the generic
 * "Unrecognized key(s)" would be the only thing an author ever saw.
 *
 * `{}` stays valid and parses to `{ contentVersion: 1 }`. No migration rewrites
 * anything; a row gains the field when someone next writes it, so **absent means
 * 1** on read.
 */
export const templateContentSchema = z
  .record(safeKeySchema, z.unknown())
  .superRefine((raw, ctx) => {
    // Depth first, and return rather than fall through: everything below this
    // point either recurses or serializes.
    if (exceedsDepth(raw, MAX_CONTENT_DEPTH)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Template content nests deeper than ${MAX_CONTENT_DEPTH} levels`,
      });
      return;
    }

    const bytes = Buffer.byteLength(JSON.stringify(raw) ?? "", "utf8");
    if (bytes > MAX_CONTENT_BYTES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Template content is ${bytes} bytes; the limit is ${MAX_CONTENT_BYTES}`,
      });
    }

    for (const [key, owner] of Object.entries(RESERVED_SECTIONS)) {
      if (Object.hasOwn(raw, key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message:
            `"${key}" is reserved for ${owner} and is not yet specified. ` +
            "It is deferred, not dropped — authoring it now would fix a shape that item has not chosen.",
        });
      }
    }
  })
  .describe(
    `Must nest no deeper than ${MAX_CONTENT_DEPTH} levels, must serialise within ` +
      `${MAX_CONTENT_BYTES} bytes, must not use the prototype-pollution keys ` +
      `(${UNSAFE_KEYS.join(", ")}), and must not carry a key reserved for a ` +
      "backlog item that has not specified its shape yet.",
  )
  .pipe(contentEnvelopeSchema);

export type TemplateContentParsed = z.infer<typeof templateContentSchema>;

/**
 * Compile-time drift guard for the ADR 0015 §Resolved-decision-2 split: the DTO
 * types live in `@bms/shared` (types-only, no runtime deps) and the validator
 * lives here (where `zod` already is). Nothing links the two at runtime, so
 * assert assignability in both directions — a field added to one and not the
 * other stops `pnpm typecheck` rather than shipping a DTO that lies.
 */
type AssertAssignable<A extends B, B> = A;

/** Both directions, and both exported so `noUnusedLocals` cannot quietly delete
 * the guard along with the protection it provides. */
export type ParsedContentMatchesDto = AssertAssignable<TemplateContentParsed, TemplateContent>;
export type DtoMatchesParsedContent = AssertAssignable<TemplateContent, TemplateContentParsed>;

/**
 * Every point key the content references, in the order encountered.
 *
 * Takes the *parsed* shape, so a caller cannot pass unvalidated JSON and get a
 * silently empty list back — the empty list would read as "no references" and
 * the reference check would pass a template that is entirely broken.
 */
export function collectContentPointRefs(content: TemplateContentParsed): string[] {
  const refs: string[] = [];
  for (const kpi of content.kpis ?? []) {
    refs.push(...kpi.pointKeys);
  }
  for (const alarm of content.alarms ?? []) {
    refs.push(alarm.pointKey);
  }
  for (const view of Object.values(content.dashboards ?? {})) {
    refs.push(...view.featured);
    // F3.1a: a widget's bindings are references too, and this line is what makes ADR 0019's
    // guarantee reach them. `assertContentRefsResolve` calls this from three places —
    // create, update and publish — because `content` and `points` are patched independently
    // and a points patch can orphan a binding the request never mentioned. Omit this walk and
    // all three checks silently stop covering widgets, with nothing in the type system to say
    // so, and ADR 0019 §3's tier promotion becomes a claim rather than a fact.
    for (const widget of view.widgets ?? []) {
      refs.push(...widget.pointKeys);
    }
  }
  // `E1.3`: a weight names a point, so it is a reference like any other. Without
  // this walk a template can weight a point it does not declare, and the weight
  // is then silently ignored by the roll-up — which shifts the score rather than
  // failing, and shifts it in the direction the author was trying to correct.
  //
  // Only the KEYS are references. The values are numbers and belong to the
  // schema above, not here.
  refs.push(...Object.keys(content.health?.weights ?? {}));
  return refs;
}

/**
 * The point keys `content` references that the template does not declare.
 *
 * Deduplicated and sorted so the error message is stable — an author fixing a
 * pack should get the same list twice, and a test should not depend on object
 * iteration order.
 */
export function findUnresolvedContentRefs(
  content: TemplateContentParsed,
  declared: Iterable<string>,
): string[] {
  const available = new Set(declared);
  const missing = new Set(
    collectContentPointRefs(content).filter((ref) => !available.has(ref)),
  );
  return [...missing].sort();
}
