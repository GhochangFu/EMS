import { z } from "zod";

import type { TemplateContent } from "@bms/shared";

import {
  maintenanceCategorySchema,
  maintenanceGenerationModeSchema,
  maintenancePrioritySchema,
} from "../../maintenance/maintenance.schema";
import { categorySchema, operatorSchema, severitySchema } from "../../rules/rules.schema";

/**
 * The `asset_templates.content` contract (ADR 0019, backlog `E1.7`).
 *
 * ADR 0015 reserved the column and left it `z.record(z.unknown())`. This file is
 * the tightening, and its central rule is that a section is contracted only as
 * far as a consumer exists to contract it against:
 *
 * - **Bound** — the consumer is on `main`. `alarms` and `maintenance` import
 *   their enums from `rules.schema` and `maintenance.schema` rather than
 *   restating them. (`alarms.philosophy` is the one Anchored sub-object inside
 *   a Bound section; `E2.1` owns its vocabulary and has not been built.)
 * - **Anchored** — the consumer is unbuilt but the *references* are checkable
 *   today. `kpis.expression` is opaque behind a `dialect` discriminator because
 *   `F2.3` owns formula syntax; `dashboards` carries ordering and nothing else
 *   because `F3.1` owns the widget vocabulary.
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
const MAX_KPI_POINT_REFS = 20;

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
    skill: z.string().max(255).optional(),
  })
  .strict();

/**
 * `E2.1` names seven enrichment fields; four are here. The other three —
 * affected assets, energy/water/production impact, ETR — are properties of a
 * **live alarm instance**, not of an asset class, so a template cannot carry
 * them. That is a boundary, not a subset.
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
 * reference check possible without a formula parser, which is exactly the thing
 * `F2.3` has not built yet.
 */
const templateKpiSchema = z
  .object({
    code: z.string().min(1).max(64),
    name: z.string().min(1).max(255),
    unit: z.string().max(32).optional(),
    pointKeys: z.array(pointKeyRef).min(1).max(MAX_KPI_POINT_REFS),
    expression: z.string().min(1).max(1000),
    /** `F2.3` adds its own value beside this one and migrates on its own
     * schedule. Until then no expression claims to have been validated. */
    dialect: z.literal("unvalidated"),
    higherIsBetter: z.boolean().optional(),
  })
  .strict();

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

/** Ordering, and nothing else. No widget types, no layout, no sizes — that is
 * `F3.1`'s vocabulary and this schema will not pre-empt it. */
const templateDashboardViewSchema = z
  .object({
    featured: z.array(pointKeyRef).min(1).max(MAX_FEATURED_POINTS),
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
