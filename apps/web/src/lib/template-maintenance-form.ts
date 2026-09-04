import {
  maintenanceGenerationModeSchema,
  maintenanceScheduleCategorySchema,
  workOrderPrioritySchema,
} from "@bms/shared/contracts";
import type {
  MaintenanceGenerationMode,
  MaintenanceScheduleCategory,
  TemplateMaintenancePlan,
  WorkOrderPriority,
} from "@bms/shared";

import type { PointGridProblem } from "./template-points-grid";

/**
 * The Maintenance tab's form rules (`F2.19`, ADR 0038 Amendment 5 Part B).
 *
 * Shaped after `template-alarm-form.ts`, which is the other section-authoring
 * module in this directory. The component holds the wiring; every rule that can
 * be wrong is here, because `apps/web`'s Vitest project runs
 * `environment: "node"` over `src/**` and the coverage gate's `include` reaches
 * `apps/web/src/lib/**` and nothing above it.
 *
 * ## These are class-level plans. Nothing here schedules work
 *
 * A `content.maintenance` entry is a maintenance plan an asset *class* ships
 * with. It becomes a `bms.maintenance_task_templates` row only once an asset
 * exists — that table's `asset_id` is `NOT NULL` — and nothing in this feature
 * materialises one. Saving this section creates, changes and removes no
 * schedule and no work order. ADR 0038 Amendment 5 says so explicitly, and
 * `maintenance-schedules-panel.tsx` is a different entity: its "templates" are
 * maintenance *schedule* templates that generate work orders.
 *
 * ## The three vocabularies are closed unions, and are NOT fetched
 *
 * `GET /api/v1/vocabularies` carries rule categories, asset domains, alarm
 * severities, alarm skills, asset roles and dashboard sections. It carries none
 * of these three. `category`, `generationMode` and `priority` are `z.enum`s in
 * `packages/shared/src/contracts/operations.ts` —
 * `maintenanceScheduleCategorySchema`, `maintenanceGenerationModeSchema` and
 * `workOrderPrioritySchema` — so `.options` is the only source, and it is read
 * from there rather than re-spelled. This is the `ALARM_OPERATORS` case, not
 * the `severities` one.
 *
 * **One thing the identity check cannot see, written down rather than assumed.**
 * The API validates `content.maintenance` against
 * `apps/api/src/maintenance/maintenance.schema.ts`, which **restates** the same
 * three enums locally rather than importing the shared ones — ADR 0019 §8 keeps
 * `@bms/shared` free of a runtime Zod dependency for the vocabulary the *API*
 * binds. The two agree today, and only `maintenancePrioritySchema` is bound to
 * its shared type by an `AssertAssignable` at the foot of that file. So this
 * module is bound to the **shared** enums; if the API's copy of the category or
 * generation-mode list ever drifts from the shared one, nothing here will see
 * it and the server's 400 is what reports it.
 *
 * ## Every bound below is copied from the API, and the copy is deliberate
 *
 * `templateMaintenancePlanSchema` at
 * `apps/api/src/admin/asset-templates/asset-templates-content.schema.ts:317–332`
 * is the authority. It is copied rather than imported because `apps/web` does
 * not depend on `apps/api` — the same reason `template-content-merge.ts:57–66`
 * copies `WRITABLE_KEYS`, and the same reason that file's docblock gives: a
 * five-string question does not justify dragging the whole content vocabulary
 * across a package boundary. The server still runs all of these; this is the
 * wording an author sees, not the authority.
 *
 * ## Strings in the row, numbers on the wire
 *
 * `intervalDays` and `estimatedMinutes` are `string` on the row because that is
 * what the DOM holds. `Number("")` is `0`, so an empty box and a real zero must
 * stay distinguishable — the same reason `template-alarm-form.ts` keeps
 * `thresholdValue` as text.
 *
 * The three enum-valued fields are `string` too, not their unions. A stored
 * plan can hold a code the enum never had, and the row must be able to *hold*
 * it so the tab can show it as "(retired)" and `maintenanceFormErrors` can
 * refuse it by name. Typed as the union, both of those become unrepresentable —
 * exactly the reasoning `TemplateAlarmRow.operator: string` records.
 */

/** `contentEnvelopeSchema` caps every section at 200 entries (`:152`). */
export const MAX_MAINTENANCE_ENTRIES = 200;

/** Character limits, from `templateMaintenancePlanSchema`. */
const LIMITS = {
  title: { min: 3, max: 255 },
  description: 4000,
  ownerTeam: 128,
  vendorName: 128,
  complianceRef: 128,
  triggerSummary: 2000,
} as const;

/** Integer ranges, from `templateMaintenancePlanSchema`. */
const BOUNDS = {
  estimatedMinutes: { min: 5, max: 1_440 },
  intervalDays: { min: 1, max: 730 },
} as const;

/**
 * The five values the API supplies when the key is absent.
 *
 * Seeded into the row rather than left blank, so the form shows what the server
 * would store and a read-back compares equal. `intervalDays` is deliberately
 * not here: it has no `.default()` and is required, so an absent one must show
 * as unset rather than as a repeat interval nobody authored.
 */
const API_DEFAULTS = {
  category: "preventive",
  generationMode: "calendar",
  priority: "medium",
  estimatedMinutes: "60",
  safetyCritical: false,
} as const;

export const MAINTENANCE_CATEGORIES = maintenanceScheduleCategorySchema.options;
export const MAINTENANCE_GENERATION_MODES = maintenanceGenerationModeSchema.options;
export const MAINTENANCE_PRIORITIES = workOrderPrioritySchema.options;

/** One editable maintenance plan. Text where the DOM holds text. */
export type TemplateMaintenanceRow = {
  title: string;
  description: string;
  /** `string`, not the union — a retired stored code must stay representable. */
  category: string;
  generationMode: string;
  ownerTeam: string;
  vendorName: string;
  complianceRef: string;
  triggerSummary: string;
  safetyCritical: boolean;
  priority: string;
  /** Text: `Number("")` is `0`, and an empty box is not five minutes. */
  estimatedMinutes: string;
  intervalDays: string;
};

/** Whether a stored value is still a member of the live category vocabulary. */
export function isMaintenanceCategory(value: unknown): value is MaintenanceScheduleCategory {
  return typeof value === "string" && (MAINTENANCE_CATEGORIES as readonly string[]).includes(value);
}

/** Whether a stored value is still a member of the live generation-mode vocabulary. */
export function isMaintenanceGenerationMode(value: unknown): value is MaintenanceGenerationMode {
  return (
    typeof value === "string" && (MAINTENANCE_GENERATION_MODES as readonly string[]).includes(value)
  );
}

/** Whether a stored value is still a member of the live priority vocabulary. */
export function isWorkOrderPriority(value: unknown): value is WorkOrderPriority {
  return typeof value === "string" && (MAINTENANCE_PRIORITIES as readonly string[]).includes(value);
}

/**
 * Reads the stored `content.maintenance`.
 *
 * **Defensive about the container, not only about the fields.** The read DTO's
 * `content` is `z.record(z.unknown())`, so `content.maintenance` can be an
 * object rather than an array — `template-api-shapes.spec.ts:202` pins exactly
 * that shape as one the contract accepts. `plans ?? []` would hand it to `.map`
 * and throw while rendering; a tab that cannot render is worse than one showing
 * an empty section the author can repair.
 */
export function maintenanceRowsFrom(
  plans: readonly TemplateMaintenancePlan[] | undefined,
): TemplateMaintenanceRow[] {
  const list: readonly unknown[] = Array.isArray(plans) ? plans : [];
  return list.map((entry) => {
    const plan = (entry ?? {}) as Partial<TemplateMaintenancePlan>;
    return {
      title: text(plan.title),
      description: text(plan.description),
      // A **defined** value is carried verbatim, even one the enum does not
      // offer: the tab shows it as "(retired)" and the form refuses it by name.
      // Only an absent (or non-string) value takes the API's default, which is
      // what the server would have stored.
      category: enumText(plan.category, API_DEFAULTS.category),
      generationMode: enumText(plan.generationMode, API_DEFAULTS.generationMode),
      ownerTeam: text(plan.ownerTeam),
      vendorName: text(plan.vendorName),
      complianceRef: text(plan.complianceRef),
      triggerSummary: text(plan.triggerSummary),
      safetyCritical:
        typeof plan.safetyCritical === "boolean" ? plan.safetyCritical : API_DEFAULTS.safetyCritical,
      priority: enumText(plan.priority, API_DEFAULTS.priority),
      // `String(0)` is `"0"`, which is what makes a stored zero survive the
      // round trip. `?? ""` would not.
      estimatedMinutes:
        typeof plan.estimatedMinutes === "number"
          ? String(plan.estimatedMinutes)
          : API_DEFAULTS.estimatedMinutes,
      intervalDays: typeof plan.intervalDays === "number" ? String(plan.intervalDays) : "",
    };
  });
}

/** A new plan: the API's defaults, and nothing authored yet. */
export function blankMaintenanceRow(): TemplateMaintenanceRow {
  return {
    title: "",
    description: "",
    category: API_DEFAULTS.category,
    generationMode: API_DEFAULTS.generationMode,
    ownerTeam: "",
    vendorName: "",
    complianceRef: "",
    triggerSummary: "",
    safetyCritical: API_DEFAULTS.safetyCritical,
    priority: API_DEFAULTS.priority,
    estimatedMinutes: API_DEFAULTS.estimatedMinutes,
    intervalDays: "",
  };
}

/**
 * Parses one of the two integer boxes.
 *
 * `NaN` for anything that is not a whole finite number, **including the empty
 * string** — `Number("")` is `0`. `parseInt` is deliberately not used: it reads
 * `"1.5"` as `1` and `"90 days"` as `90`, which would accept a typo as an
 * authored value.
 */
function parseWholeNumber(raw: string): number {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return Number.NaN;
  }
  const value = Number(trimmed);
  return Number.isInteger(value) ? value : Number.NaN;
}

/** What the author must fix before the plans can be sent. */
export function maintenanceFormErrors(
  rows: readonly TemplateMaintenanceRow[],
): PointGridProblem[] {
  const problems: PointGridProblem[] = [];

  if (rows.length > MAX_MAINTENANCE_ENTRIES) {
    problems.push({
      row: null,
      field: "maintenance",
      message: `A template holds at most ${MAX_MAINTENANCE_ENTRIES} maintenance plans. This one has ${rows.length}.`,
    });
  }

  rows.forEach((row, index) => {
    const push = (field: string, message: string) => problems.push({ row: index, field, message });

    const title = row.title.trim();
    if (title === "") {
      push("title", "A maintenance plan needs a title.");
    } else if (title.length < LIMITS.title.min) {
      push("title", `A title is at least ${LIMITS.title.min} characters.`);
    } else if (title.length > LIMITS.title.max) {
      push("title", `A title is at most ${LIMITS.title.max} characters.`);
    }

    // Every message names the range, because the tab renders the message and
    // "that is not valid" gives an author nothing to act on.
    const interval = row.intervalDays.trim();
    const intervalRange = `${BOUNDS.intervalDays.min}–${BOUNDS.intervalDays.max}`;
    if (interval === "") {
      push("intervalDays", `A maintenance plan needs an interval, in whole days (${intervalRange}).`);
    } else {
      const days = parseWholeNumber(interval);
      if (Number.isNaN(days)) {
        push("intervalDays", `An interval is a whole number of days (${intervalRange}).`);
      } else if (days < BOUNDS.intervalDays.min || days > BOUNDS.intervalDays.max) {
        push(
          "intervalDays",
          `An interval is a whole number of days (${intervalRange}). This one is ${days}.`,
        );
      }
    }

    const minutesRange = `${BOUNDS.estimatedMinutes.min}–${BOUNDS.estimatedMinutes.max}`;
    const minutes = parseWholeNumber(row.estimatedMinutes);
    if (Number.isNaN(minutes)) {
      push(
        "estimatedMinutes",
        `An estimate is a whole number of minutes (${minutesRange}).`,
      );
    } else if (
      minutes < BOUNDS.estimatedMinutes.min ||
      minutes > BOUNDS.estimatedMinutes.max
    ) {
      push(
        "estimatedMinutes",
        `An estimate is a whole number of minutes (${minutesRange}). This one is ${minutes}.`,
      );
    }

    if (!isMaintenanceCategory(row.category)) {
      push("category", `"${row.category}" is not a maintenance category this system offers.`);
    }
    if (!isMaintenanceGenerationMode(row.generationMode)) {
      push(
        "generationMode",
        `"${row.generationMode}" is not a generation mode this system offers.`,
      );
    }
    if (!isWorkOrderPriority(row.priority)) {
      push("priority", `"${row.priority}" is not a priority this system offers.`);
    }

    for (const [field, limit] of [
      ["description", LIMITS.description],
      ["ownerTeam", LIMITS.ownerTeam],
      ["vendorName", LIMITS.vendorName],
      ["complianceRef", LIMITS.complianceRef],
      ["triggerSummary", LIMITS.triggerSummary],
    ] as const) {
      if (row[field].trim().length > limit) {
        push(field, `This is at most ${limit} characters.`);
      }
    }
  });

  return problems;
}

/**
 * The `content.maintenance` payload.
 *
 * Optional keys are added only when set: `templateMaintenancePlanSchema` is
 * `.strict()` and every optional field is `.optional()` rather than
 * `.nullish()`, so `""` is a **rejected value**, not an empty one. Same rule as
 * `template-alarm-form.ts:293`.
 *
 * **This function must be total, because the comparator calls it on every
 * render** — including on a plan the author just added, whose title is blank
 * and whose interval is empty. It therefore never throws and never refuses.
 *
 * **An unparseable number becomes `NaN`, on purpose.** `intervalDays` is
 * required on `TemplateMaintenancePlan`, so it cannot be omitted the way the
 * alarm payload omits an unparseable `thresholdValue`. Something has to be
 * emitted, and the one thing it must not be is a plausible in-range number: a
 * silent `60` is an estimate nobody made, and a silent `1` is a plan that
 * repeats daily. `NaN` serialises to `null`, which `z.number().int()` refuses
 * with a message naming the field — the failure stays loud. Save is disabled
 * behind `maintenanceFormErrors` long before this is reachable on the wire;
 * this is what the value is when the comparator reads it.
 *
 * The three enums are narrowed through a type guard over `.options`, never
 * `as`. A stored non-member falls back to the API's own default, which is
 * unreachable on the wire behind the disabled Save.
 *
 * **The comparator does NOT use this function's enum handling**, and that is
 * deliberate — see `comparableMaintenance`. Normalising both sides here made a
 * retired code indistinguishable from the default that replaces it, so
 * repairing a retired category by choosing the API's own default value read as
 * "no change" and left Save disabled on a fix the screen had just demanded.
 */
export function buildMaintenancePayload(
  rows: readonly TemplateMaintenanceRow[],
): TemplateMaintenancePlan[] {
  return rows.map((row) => {
    const plan: TemplateMaintenancePlan = {
      title: row.title.trim(),
      category: isMaintenanceCategory(row.category) ? row.category : API_DEFAULTS.category,
      generationMode: isMaintenanceGenerationMode(row.generationMode)
        ? row.generationMode
        : API_DEFAULTS.generationMode,
      safetyCritical: row.safetyCritical,
      priority: isWorkOrderPriority(row.priority) ? row.priority : API_DEFAULTS.priority,
      estimatedMinutes: parseWholeNumber(row.estimatedMinutes),
      intervalDays: parseWholeNumber(row.intervalDays),
    };

    for (const field of [
      "description",
      "ownerTeam",
      "vendorName",
      "complianceRef",
      "triggerSummary",
    ] as const) {
      const trimmed = row[field].trim();
      if (trimmed !== "") {
        plan[field] = trimmed;
      }
    }

    return plan;
  });
}

/**
 * Whether the rows differ from what is stored, compared as they would be sent.
 *
 * **Both sides go through `buildMaintenancePayload(maintenanceRowsFrom(…))`,
 * and the asymmetry that would break is the whole reason this is one line.**
 * A stored plan may omit every field the API defaults — `{ title, intervalDays }`
 * is a real and common stored shape, because the defaults are applied on write
 * and never re-sent. The seed fills those five in, so rows carry values the
 * stored object does not. Compare the rows against the raw stored array and an
 * untouched tab reads as dirty: every tab click then prompts the author about
 * unsaved changes they never made, and they learn to dismiss the prompt.
 */
export function maintenanceHaveChanged(
  rows: readonly TemplateMaintenanceRow[],
  stored: readonly TemplateMaintenancePlan[] | undefined,
): boolean {
  return (
    JSON.stringify(comparableMaintenance(rows)) !==
    JSON.stringify(comparableMaintenance(maintenanceRowsFrom(stored)))
  );
}

/**
 * What the comparator compares: the payload, with the three enum fields taken
 * **verbatim from the row** instead of through their type guards.
 *
 * The payload builder must substitute the API default for a non-member, because
 * that is what may go on the wire. The comparator must not, and the difference
 * is a real dead end rather than a nicety. Suppose a category is retired from
 * the vocabulary while a template still stores it. The tab reports the problem
 * and disables Save. The author picks the most obvious repair — the very value
 * the API defaults to. Now both sides of a guard-normalised comparison read
 * that same default: the edited row because the author chose it, and the stored
 * baseline because the guard replaced the retired code with it. The comparator
 * says nothing changed, Save stays disabled, and the caption flips from "Fix
 * the problems above to save" to "No changes yet" — on the one repair the
 * screen had just asked for. Every other choice saves normally, which makes it
 * the kind of dead end a user reports as "it just will not save".
 *
 * Carrying the raw strings here keeps the repair visible and costs nothing
 * else: a retired code equals itself, so an untouched tab holding one is still
 * not dirty, and nothing invalid reaches the wire because Save is gated on
 * `maintenanceFormErrors` either way.
 */
function comparableMaintenance(rows: readonly TemplateMaintenanceRow[]): unknown[] {
  return buildMaintenancePayload(rows).map((plan, index) => ({
    ...plan,
    category: rows[index]?.category,
    generationMode: rows[index]?.generationMode,
    priority: rows[index]?.priority,
  }));
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function enumText(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}
