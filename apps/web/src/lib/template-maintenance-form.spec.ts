import {
  maintenanceGenerationModeSchema,
  maintenanceScheduleCategorySchema,
  workOrderPrioritySchema,
} from "@bms/shared/contracts";
import type { TemplateMaintenancePlan } from "@bms/shared";

import {
  MAINTENANCE_CATEGORIES,
  MAINTENANCE_GENERATION_MODES,
  MAINTENANCE_PRIORITIES,
  MAX_MAINTENANCE_ENTRIES,
  blankMaintenanceRow,
  buildMaintenancePayload,
  maintenanceFormErrors,
  maintenanceHaveChanged,
  maintenanceRowsFrom,
  type TemplateMaintenanceRow,
} from "./template-maintenance-form";

/**
 * The Maintenance tab's form rules (`F2.19`, ADR 0038 Amendment 5 Part B).
 *
 * Assertions live here; `template-maintenance-form.test.ts` is the Vitest entry
 * point (ADR 0014). Node environment — nothing here touches the DOM.
 *
 * ## The one case that is not a bounds check
 *
 * `runReadBackIsNeverDirtyTests` is the reason this file was written before the
 * module. A stored plan may omit every field the API defaults, because the
 * defaults are applied on the way *in* and the read DTO's `content` is
 * `z.record(z.unknown())` — `{ title, intervalDays }` is a real stored shape,
 * and it is the shape the stock catalog packs authored most of their plans in.
 * The seed fills those defaults, so the rows carry five values the stored plan
 * does not. Compare the two sides differently and every read-back is dirty.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * A stored `content.maintenance`, cast once and here rather than at each call.
 *
 * The read DTO types `content` as `z.record(z.unknown())`, so a stored plan is
 * whatever was written — commonly a partial one, since the API's defaults are
 * applied on write and never re-sent. Typing the fixtures as
 * `TemplateMaintenancePlan` would make the partial shapes below unwritable and
 * would hide the exact case the seed exists to handle.
 */
function stored(plans: unknown): readonly TemplateMaintenancePlan[] {
  return plans as readonly TemplateMaintenancePlan[];
}

/** A row that passes every check, as the starting point for a single edit. */
function validRow(patch: Partial<TemplateMaintenanceRow> = {}): TemplateMaintenanceRow {
  return { ...blankMaintenanceRow(), title: "Membrane CIP", intervalDays: "90", ...patch };
}

function messagesFor(row: TemplateMaintenanceRow, field: string): string[] {
  return maintenanceFormErrors([row])
    .filter((problem) => problem.row === 0 && problem.field === field)
    .map((problem) => problem.message);
}

/**
 * Case 1 — the seed fills every API default.
 *
 * The five with a `.default()` in `templateMaintenancePlanSchema`: `category`,
 * `generationMode`, `priority`, `estimatedMinutes` and `safetyCritical`.
 * `intervalDays` has none and is required, so an absent one seeds empty rather
 * than guessing a repeat interval nobody authored.
 */
export function runSeedsEveryApiDefaultTests(): void {
  const rows = maintenanceRowsFrom(stored([{ title: "Membrane CIP", intervalDays: 90 }]));

  assert(rows.length === 1, `one stored plan seeds one row — got ${rows.length}`);
  const row = rows[0];
  assert(row.title === "Membrane CIP", `the title is carried — got "${row.title}"`);
  assert(row.intervalDays === "90", `intervalDays is text — got ${JSON.stringify(row.intervalDays)}`);
  assert(row.category === "preventive", `category defaults to preventive — got "${row.category}"`);
  assert(
    row.generationMode === "calendar",
    `generationMode defaults to calendar — got "${row.generationMode}"`,
  );
  assert(row.priority === "medium", `priority defaults to medium — got "${row.priority}"`);
  assert(
    row.estimatedMinutes === "60",
    `estimatedMinutes defaults to 60 — got ${JSON.stringify(row.estimatedMinutes)}`,
  );
  assert(row.safetyCritical === false, "safetyCritical defaults to false");
  for (const [field, value] of [
    ["description", row.description],
    ["ownerTeam", row.ownerTeam],
    ["vendorName", row.vendorName],
    ["complianceRef", row.complianceRef],
    ["triggerSummary", row.triggerSummary],
  ] as const) {
    assert(value === "", `an absent ${field} seeds as "" — got ${JSON.stringify(value)}`);
  }
}

/**
 * Case 2 — a section that is not an array seeds empty and does not throw.
 *
 * `template-api-shapes.spec.ts:202` pins the exact shape this defends against:
 * `content: { maintenance: { intervalDays: 90 } }` parses, because the read DTO
 * is `z.record(z.unknown())`. `plans ?? []` would hand that object to `.map`
 * and throw while rendering — a tab that cannot render at all is worse than
 * one showing an empty section the author can repair.
 */
export function runNonArrayStoredSectionTests(): void {
  assert(maintenanceRowsFrom(undefined).length === 0, "an absent section seeds no rows");
  assert(
    maintenanceRowsFrom(stored({ intervalDays: 90 })).length === 0,
    "a stored object rather than an array seeds no rows and must not throw",
  );
  assert(maintenanceRowsFrom(stored([])).length === 0, "an empty section seeds no rows");
}

/** Case 3 — a new plan carries the same defaults, with nothing authored yet. */
export function runBlankRowTests(): void {
  const row = blankMaintenanceRow();
  assert(row.title === "", `a new plan has no title — got "${row.title}"`);
  assert(row.intervalDays === "", `a new plan has no interval — got "${row.intervalDays}"`);
  assert(row.category === "preventive", "a new plan is preventive, as the API would default it");
  assert(row.generationMode === "calendar", "a new plan is calendar-generated");
  assert(row.priority === "medium", "a new plan is medium priority");
  assert(row.estimatedMinutes === "60", "a new plan is 60 minutes");
  assert(row.safetyCritical === false, "a new plan is not safety critical");
}

/** Case 4 — the title bound, both sides of both edges. */
export function runTitleBoundsTests(): void {
  assert(messagesFor(validRow({ title: "" }), "title").length === 1, "an empty title is refused");
  assert(messagesFor(validRow({ title: "  " }), "title").length === 1, "a blank title is refused");
  assert(
    messagesFor(validRow({ title: "ab" }), "title").length === 1,
    'a two-character title is refused — the schema is `min(3)`',
  );
  assert(
    messagesFor(validRow({ title: "abc" }), "title").length === 0,
    "a three-character title is accepted — the low edge must be inclusive",
  );
  assert(
    messagesFor(validRow({ title: "t".repeat(255) }), "title").length === 0,
    "a 255-character title is accepted — the high edge must be inclusive",
  );
  assert(
    messagesFor(validRow({ title: "t".repeat(256) }), "title").length === 1,
    "a 256-character title is refused",
  );
}

/**
 * Case 5 — `intervalDays`, the field with no default and the tightest range.
 *
 * Every message names `1–730`, because the Maintenance tab renders the message
 * and an author reading "that is not valid" has nothing to act on.
 */
export function runIntervalDaysBoundsTests(): void {
  for (const refused of ["", "0", "731", "1.5", "abc", "-1", " "]) {
    const messages = messagesFor(validRow({ intervalDays: refused }), "intervalDays");
    assert(
      messages.length === 1,
      `intervalDays ${JSON.stringify(refused)} must be refused — got ${messages.length} problems`,
    );
    assert(
      messages[0].includes("1–730"),
      `the intervalDays message must name the 1–730 range — got "${messages[0]}"`,
    );
  }
  for (const accepted of ["1", "730", "90", " 90 "]) {
    assert(
      messagesFor(validRow({ intervalDays: accepted }), "intervalDays").length === 0,
      `intervalDays ${JSON.stringify(accepted)} must be accepted`,
    );
  }
}

/** Case 6 — `estimatedMinutes`, both sides of both edges. */
export function runEstimatedMinutesBoundsTests(): void {
  for (const refused of ["4", "1441", "0", "", "12.5", "abc"]) {
    const messages = messagesFor(validRow({ estimatedMinutes: refused }), "estimatedMinutes");
    assert(
      messages.length === 1,
      `estimatedMinutes ${JSON.stringify(refused)} must be refused — got ${messages.length}`,
    );
    assert(
      messages[0].includes("5–1440"),
      `the estimatedMinutes message must name the 5–1440 range — got "${messages[0]}"`,
    );
  }
  for (const accepted of ["5", "1440", "60"]) {
    assert(
      messagesFor(validRow({ estimatedMinutes: accepted }), "estimatedMinutes").length === 0,
      `estimatedMinutes ${JSON.stringify(accepted)} must be accepted`,
    );
  }
}

/** Case 7 — every optional string's length bound, one over and one on. */
export function runOptionalStringBoundsTests(): void {
  for (const [field, limit] of [
    ["description", 4000],
    ["ownerTeam", 128],
    ["vendorName", 128],
    ["complianceRef", 128],
    ["triggerSummary", 2000],
  ] as const) {
    assert(
      messagesFor(validRow({ [field]: "x".repeat(limit) }), field).length === 0,
      `${field} at exactly ${limit} characters must be accepted`,
    );
    const over = messagesFor(validRow({ [field]: "x".repeat(limit + 1) }), field);
    assert(over.length === 1, `${field} at ${limit + 1} characters must be refused`);
    assert(
      over[0].includes(String(limit)),
      `the ${field} message must name its limit — got "${over[0]}"`,
    );
    assert(
      messagesFor(validRow({ [field]: "" }), field).length === 0,
      `${field} is optional, so empty is not a problem`,
    );
  }
}

/**
 * Case 8 — a value outside a closed vocabulary is refused, and the problem
 * names the field it belongs to.
 *
 * A stored plan can hold a code that was never in the enum, or one the enum
 * dropped. The tab keeps such a value selectable as "(retired)" so the row says
 * what it holds; this is what stops it being saved.
 */
export function runVocabularyMembershipTests(): void {
  for (const [field, value] of [
    ["category", "descaling"],
    ["generationMode", "ai"],
    ["priority", "urgent"],
  ] as const) {
    const problems = maintenanceFormErrors([validRow({ [field]: value })]).filter(
      (problem) => problem.row === 0,
    );
    assert(
      problems.length === 1,
      `${field}="${value}" must produce exactly one problem — got ${problems.length}`,
    );
    assert(
      problems[0].field === field,
      `the problem must be reported against ${field} — got "${problems[0].field}"`,
    );
    assert(
      problems[0].message.includes(value),
      `the message must name the refused value — got "${problems[0].message}"`,
    );
  }

  // Every live member is accepted, so the check is membership and not a
  // hardcoded shorter list.
  for (const category of MAINTENANCE_CATEGORIES) {
    assert(
      messagesFor(validRow({ category }), "category").length === 0,
      `${category} is a live category and must be accepted`,
    );
  }
  for (const mode of MAINTENANCE_GENERATION_MODES) {
    assert(
      messagesFor(validRow({ generationMode: mode }), "generationMode").length === 0,
      `${mode} is a live generation mode and must be accepted`,
    );
  }
  for (const priority of MAINTENANCE_PRIORITIES) {
    assert(
      messagesFor(validRow({ priority }), "priority").length === 0,
      `${priority} is a live priority and must be accepted`,
    );
  }
}

/** Case 9 — the section cap is a section-level problem, not a row's. */
export function runSectionCapTests(): void {
  assert(MAX_MAINTENANCE_ENTRIES === 200, "the envelope caps every section at 200 entries");

  const atCap = Array.from({ length: MAX_MAINTENANCE_ENTRIES }, () => validRow());
  assert(
    maintenanceFormErrors(atCap).length === 0,
    "exactly 200 plans is accepted — the cap is inclusive",
  );

  const overCap = [...atCap, validRow()];
  const section = maintenanceFormErrors(overCap).filter((problem) => problem.row === null);
  assert(section.length === 1, `201 plans must be refused — got ${section.length} section problems`);
  assert(
    section[0].field === "maintenance",
    `the cap is a section problem — got field "${section[0].field}"`,
  );
  assert(
    section[0].message.includes("201"),
    `the message must say how many there are — got "${section[0].message}"`,
  );
}

/**
 * Case 10 — the payload shape.
 *
 * `templateMaintenancePlanSchema` is `.strict()` and every optional field is
 * `.optional()` rather than `.nullish()`, so an unset field is an **absent
 * key**. Sending `""` is a rejected value, not an empty one — the same rule
 * `template-alarm-form.ts:293` records for the alarm payload.
 */
export function runPayloadShapeTests(): void {
  const [plan] = buildMaintenancePayload([
    validRow({
      title: "  Membrane CIP  ",
      intervalDays: "90",
      estimatedMinutes: "120",
      category: "compliance",
      generationMode: "runtime",
      priority: "high",
      safetyCritical: true,
      ownerTeam: "  Water team  ",
      vendorName: "",
      complianceRef: "   ",
      triggerSummary: "Run when the CIP counter trips.",
      description: "",
    }),
  ]);

  assert(plan.title === "Membrane CIP", `the title is trimmed — got ${JSON.stringify(plan.title)}`);
  assert(
    plan.intervalDays === 90 && typeof plan.intervalDays === "number",
    `intervalDays is a number, not text — got ${JSON.stringify(plan.intervalDays)}`,
  );
  assert(
    plan.estimatedMinutes === 120 && typeof plan.estimatedMinutes === "number",
    `estimatedMinutes is a number — got ${JSON.stringify(plan.estimatedMinutes)}`,
  );
  assert(plan.category === "compliance", `the category is sent — got ${plan.category}`);
  assert(plan.generationMode === "runtime", `the generation mode is sent — got ${plan.generationMode}`);
  assert(plan.priority === "high", `the priority is sent — got ${plan.priority}`);
  assert(plan.safetyCritical === true, "safetyCritical is sent as a boolean");
  assert(plan.ownerTeam === "Water team", `ownerTeam is trimmed — got ${JSON.stringify(plan.ownerTeam)}`);
  assert(
    plan.triggerSummary === "Run when the CIP counter trips.",
    "a set triggerSummary is sent",
  );

  for (const key of ["vendorName", "complianceRef", "description"] as const) {
    assert(
      !Object.hasOwn(plan, key),
      `an emptied ${key} must be an absent key, never "" — the schema is .strict() and ` +
        `.optional(), so "" is a rejected value. Got ${JSON.stringify(plan[key])}`,
    );
  }

  // A blank row still produces a whole object: the comparator calls this on
  // every render, including on rows that cannot be saved.
  const [blank] = buildMaintenancePayload([blankMaintenanceRow()]);
  assert(blank.title === "", "a blank row sends an empty title rather than throwing");
  assert(
    Number.isNaN(blank.intervalDays),
    `an unparseable interval must not become a plausible number — got ${JSON.stringify(
      blank.intervalDays,
    )}`,
  );
  assert(
    JSON.parse(JSON.stringify(blank)).intervalDays === null,
    "NaN serialises to null, which the server refuses — that is the point of choosing it",
  );
}

/**
 * Case 11 — THE TRAP. A read-back is never dirty.
 *
 * Both sides are normalised through `buildMaintenancePayload(
 * maintenanceRowsFrom(…))`, so the five defaults the seed fills in are filled
 * on both sides. Compare the rows against the raw stored plan instead and the
 * consequence is not a failing save: **an untouched Maintenance tab reads as
 * dirty, and every tab click prompts the author about unsaved changes they
 * never made.** They learn to dismiss the prompt, which is what makes the
 * guard useless on the day it matters.
 */
export function runReadBackIsNeverDirtyTests(): void {
  const NEVER_MADE =
    "an untouched Maintenance tab reads as dirty, so every tab click prompts about " +
    "unsaved changes the author never made";

  // The shape the stock packs authored most of their plans in: no category, no
  // priority, no generationMode, no estimatedMinutes, no safetyCritical.
  const minimal = stored([
    { title: "Membrane CIP", intervalDays: 90 },
    { title: "Pressure vessel inspection", intervalDays: 365 },
  ]);
  assert(
    !maintenanceHaveChanged(maintenanceRowsFrom(minimal), minimal),
    `a stored plan that omits every defaulted field must read clean — ${NEVER_MADE}`,
  );

  // And on a plan that spells every field out, so the case above is not passing
  // because both sides are equally empty.
  const complete = stored([
    {
      title: "Membrane CIP",
      description: "Clean in place.",
      category: "compliance",
      generationMode: "runtime",
      ownerTeam: "Water team",
      vendorName: "Ion Exchange",
      complianceRef: "IS 10500",
      triggerSummary: "Run when the CIP counter trips.",
      safetyCritical: true,
      priority: "high",
      estimatedMinutes: 120,
      intervalDays: 90,
    },
  ]);
  assert(
    !maintenanceHaveChanged(maintenanceRowsFrom(complete), complete),
    `a fully specified stored plan must read clean — ${NEVER_MADE}`,
  );

  // Every edit the tab offers is seen, and reverting each one clears it.
  const base = maintenanceRowsFrom(minimal);
  const edits: [string, TemplateMaintenanceRow[]][] = [
    ["a title edit", base.map((row, index) => (index === 0 ? { ...row, title: "CIP" } : row))],
    [
      "an intervalDays edit",
      base.map((row, index) => (index === 0 ? { ...row, intervalDays: "45" } : row)),
    ],
    [
      "a safetyCritical toggle",
      base.map((row, index) => (index === 0 ? { ...row, safetyCritical: true } : row)),
    ],
    ["an added plan", [...base, blankMaintenanceRow()]],
    ["a removed plan", base.slice(0, 1)],
  ];
  for (const [what, rows] of edits) {
    assert(
      maintenanceHaveChanged(rows, minimal),
      `${what} must read as changed, or Save stays disabled on a real edit`,
    );
  }

  // Reverted: the same rows the seed produces, rebuilt rather than reused, so
  // this cannot pass by comparing one object with itself.
  assert(
    !maintenanceHaveChanged(maintenanceRowsFrom(minimal), minimal),
    `a reverted edit must read clean again — ${NEVER_MADE}`,
  );
  const edited = base.map((row, index) => (index === 0 ? { ...row, title: "CIP" } : row));
  const revertedByHand = edited.map((row, index) =>
    index === 0 ? { ...row, title: base[0].title } : row,
  );
  assert(
    !maintenanceHaveChanged(revertedByHand, minimal),
    `an edit typed back to the stored value must read clean again — ${NEVER_MADE}`,
  );
}

/**
 * Repairing a retired enum with the API's own default value must read as a
 * change.
 *
 * The dead end this closes: a category is retired while a template still stores
 * it, the tab reports the problem and disables Save, and the author picks the
 * most obvious repair — the value the API itself defaults to. If the comparator
 * normalised both sides through the payload builder's type guards, the edited
 * row and the stored baseline would both read that default, the comparator
 * would say nothing changed, and Save would stay disabled on the one repair the
 * screen had just demanded. Every other category saves normally, so it presents
 * as "it just will not save" for one choice.
 *
 * Unreachable today — the three enums agree with the API's copies byte for byte
 * — but it is exactly the state the `(retired)` option exists for.
 */
export function runRepairingARetiredEnumReadsAsAChangeTests(): void {
  const stored = [
    { title: "Membrane CIP", intervalDays: 90, category: "descaling" },
  ] as unknown as TemplateMaintenancePlan[];

  const untouched = maintenanceRowsFrom(stored);
  assert(
    untouched[0]?.category === "descaling",
    `a retired code must survive the seed verbatim, got ${String(untouched[0]?.category)}`,
  );
  assert(
    !maintenanceHaveChanged(untouched, stored),
    "a template holding a retired category must not read as dirty before it is touched",
  );

  const repaired = untouched.map((row) => ({ ...row, category: "preventive" }));
  assert(
    maintenanceHaveChanged(repaired, stored),
    "repairing a retired category with the API's own default must enable Save — " +
      "normalising both sides through the payload builder's guards hides this edit",
  );

  // The payload still sends a legal member either way; only the comparison changed.
  assert(
    buildMaintenancePayload(repaired)[0]?.category === "preventive",
    "the repaired row must send the chosen category",
  );
}

/**
 * Case 12 — the vocabularies are the contract's own arrays, by identity.
 *
 * `===`, not `toEqual`. A re-spelled copy of the fourteen categories would
 * satisfy a deep-equality check on the day it was written and drift the day the
 * enum changed. These three lists are **not** in `GET /api/v1/vocabularies` —
 * that payload carries rule categories, domains, severities, skills, roles and
 * sections — so `.options` is the only source there is.
 */
export function runVocabularyIdentityTests(): void {
  assert(
    MAINTENANCE_CATEGORIES === maintenanceScheduleCategorySchema.options,
    "MAINTENANCE_CATEGORIES must be maintenanceScheduleCategorySchema.options itself",
  );
  assert(
    MAINTENANCE_GENERATION_MODES === maintenanceGenerationModeSchema.options,
    "MAINTENANCE_GENERATION_MODES must be maintenanceGenerationModeSchema.options itself",
  );
  assert(
    MAINTENANCE_PRIORITIES === workOrderPrioritySchema.options,
    "MAINTENANCE_PRIORITIES must be workOrderPrioritySchema.options itself",
  );
  assert(
    MAINTENANCE_CATEGORIES.length === 14,
    `ADR 0019 §4 binds fourteen categories — got ${MAINTENANCE_CATEGORIES.length}`,
  );
}
