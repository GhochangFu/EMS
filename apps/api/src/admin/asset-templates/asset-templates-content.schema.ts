import { z } from "zod";

import {
  alarmSkillCodeSchema,
  CALC_DIALECT,
  // F3.1a: the four widget config schemas, reused rather than restated (§4.8 — "a vocabulary
  // is declared once and everything else is derived from it"). `@bms/shared` and not
  // `@bms/shared/contracts`, because apps/api compiles with moduleResolution "node" and
  // ignores the exports map — ADR 0030 Amendment 2.
  chartConfigSchema,
  formatCalcError,
  GAUGE_RANGE_MESSAGE,
  gaugeRangeIsOrdered,
  gaugeThresholdSchema,
  MAX_FORMULA_POINT_REFS,
  MAX_GAUGE_THRESHOLDS,
  radialGaugeConfigObjectSchema,
  tankLevelConfigSchema,
  validateFormula,
  valueTileConfigSchema,
} from "@bms/shared";
import type { TemplateContent } from "@bms/shared";

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
 * - **Reserved** — `health` and `optimisation` are rejected, each naming its own
 *   blocking item. A reserved key that is silently accepted lets `E5.1` author a
 *   shape `F3.1`/`E1.1` will contradict, and the contradiction surfaces a year
 *   later with packs in the field.
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
const MAX_DASHBOARD_WIDGETS = 40;
const MAX_WIDGET_POINT_KEYS = 8;
// ADR 0036 decision 8: reused, not restated, so the two numbers cannot drift.
const MAX_KPI_POINT_REFS = MAX_FORMULA_POINT_REFS;

/**
 * Keys that will mean something later and mean nothing now. Each names its own
 * blocking item: one shared message would point an author blocked on
 * `optimisation` at an item three waves earlier and a priority band off.
 */
const RESERVED_SECTIONS: Record<string, string> = {
  health: "E1.1 (ML serving foundation)",
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
 */
const templateAlarmSchema = z
  .object({
    code: z.string().min(1).max(64),
    pointKey: pointKeyRef,
    operator: operatorSchema,
    thresholdValue: z.number().finite(),
    severity: severitySchema,
    message: z.string().min(1).max(500),
    category: categorySchema.optional(),
    philosophy: alarmPhilosophySchema.optional(),
  })
  .strict();

/**
 * `pointKeys` is separate from `expression` on purpose: it is what makes the
 * reference check possible. Historically that was "possible without a formula
 * parser" — `F2.3` had not built one yet. Now that it has (ADR 0036),
 * `dialect: "bms-calc-v1"` turns `pointKeys` from an unverified bookkeeping
 * array into a real two-way cross-check: every `{ref}` in `expression` must
 * appear in `pointKeys`, and every entry in `pointKeys` must be used. A KPI
 * left at `dialect: "unvalidated"` still validates exactly as before —
 * nothing here forces a migration of stored content; re-validation only
 * happens on the next author write.
 */
const templateKpiSchema = z
  .object({
    code: z.string().min(1).max(64),
    name: z.string().min(1).max(255),
    unit: z.string().max(32).optional(),
    pointKeys: z.array(pointKeyRef).min(1).max(MAX_KPI_POINT_REFS),
    expression: z.string().min(1).max(1000),
    dialect: z.enum(["unvalidated", CALC_DIALECT]),
    higherIsBetter: z.boolean().optional(),
  })
  .strict()
  .superRefine((kpi, ctx) => {
    if (kpi.dialect !== CALC_DIALECT) {
      return;
    }
    const result = validateFormula(kpi.expression, kpi.pointKeys);
    if (!result.ok) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expression"],
        message: `Invalid expression: ${formatCalcError(result.errors[0])}`,
      });
      return;
    }
    // The other direction — every `{ref}` in `expression` resolves to a
    // declared key — was already checked by `validateFormula` above
    // (`unknown_reference` fails it). This is only the reverse: a declared
    // key the expression never uses. Does not also catch a *duplicate*
    // pointKeys entry (["A","A"] with expression "{A}" passes both checks) —
    // harmless, and pre-existing: pointKeys carried no uniqueness rule before
    // this dialect existed either.
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
    'When dialect is "bms-calc-v1", expression is parsed under bms-calc-v1 and rejected on ' +
      "syntax error or unknown function; every entry in pointKeys must be used by expression " +
      'at least once, and every {ref} in expression must appear in pointKeys. A "unvalidated" ' +
      "KPI is not parsed.",
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
 */
const templateWidgetIdentityFields = {
  pointKeys: z.array(pointKeyRef).min(1).max(MAX_WIDGET_POINT_KEYS),
  title: z.string().max(255).optional(),
  gridX: z.number().int().min(0).max(11),
  gridY: z.number().int().min(0),
  gridW: z.number().int().min(1).max(12),
  gridH: z.number().int().min(1).max(24),
};

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
 * exported so the spec can assert its arm count against `widgetTypeSchema.options.length`: a
 * fifth widget type added to `@bms/shared` and not to this file fails the build rather than
 * being quietly unusable in templates.
 */
export const templateDashboardWidgetVariants = z.discriminatedUnion("widgetType", [
  z
    .object({
      ...templateWidgetIdentityFields,
      widgetType: z.literal("radial_gauge"),
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
      config: tankLevelConfigSchema.strict(),
    })
    .strict(),
  z
    .object({
      ...templateWidgetIdentityFields,
      widgetType: z.literal("value_tile"),
      config: valueTileConfigSchema.strict(),
    })
    .strict(),
  z
    .object({
      ...templateWidgetIdentityFields,
      widgetType: z.literal("chart"),
      config: chartConfigSchema.strict(),
    })
    .strict(),
]);

const templateDashboardWidgetSchema = templateDashboardWidgetVariants
  .refine((widget) => widget.gridX + widget.gridW <= 12, {
    message: "a widget must fit inside the 12-column canvas",
    path: ["gridW"],
  })
  .describe(
    "A widget on a template's default dashboard. `gridX + gridW` must not exceed 12: the " +
      "canvas is twelve columns, and `dashboard_widgets_grid_bounds_check` enforces the same " +
      "bound in SQL, so an author who overflows it gets a 400 naming the field rather than a " +
      "500 carrying a constraint name.",
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
