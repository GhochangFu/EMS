import type { CopilotFillStepDto } from "@bms/shared";
import { type CatalogEntry, catalogPath, pathParamsOf, stepValuesSchema } from "@bms/shared/copilot";

/**
 * `F3.85` PR 8 / ADR 0099 decision 6 (plan §10.3, ruling Q6) — the pure logic
 * of the shared wizard shell: the steps of a catalog entry, moving between
 * them, the check on one step, and leaving with unsaved values.
 *
 * Every catalog route is a stepper (Q6): an entry's field steps, then Review.
 * An entry with no body fields (publish, archive, draft, apply) is the Review
 * step alone.
 */
export type WizardStep = { readonly id: string; readonly title: string; readonly fields: readonly string[] };

export const REVIEW_STEP: WizardStep = { id: "review", title: "Review", fields: [] };

export function wizardStepsOf(entry: Pick<CatalogEntry, "steps">): WizardStep[] {
  return [...entry.steps, REVIEW_STEP];
}

/** The step after `current`, or `current` when it is the last. */
export function nextStepId(steps: readonly WizardStep[], current: string): string {
  const index = steps.findIndex((step) => step.id === current);
  return steps[Math.min(index + 1, steps.length - 1)]?.id ?? current;
}

/** The step before `current`, or `current` when it is the first. */
export function previousStepId(steps: readonly WizardStep[], current: string): string {
  const index = steps.findIndex((step) => step.id === current);
  return steps[Math.max(index - 1, 0)]?.id ?? current;
}

/** The values of one step's fields, without the keys the form has not set. */
export function stepValuesOf(step: WizardStep, values: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of step.fields) {
    if (values[field] !== undefined) out[field] = values[field];
  }
  return out;
}

/**
 * The problems with one step's values, as `field: message` lines; empty when
 * the step may be left forward. A field left empty is not a problem here —
 * the Review step parses the whole body, refinements included.
 */
export function stepProblems(
  entry: Pick<CatalogEntry, "body">,
  step: WizardStep,
  values: Readonly<Record<string, unknown>>,
): string[] {
  if (step.fields.length === 0) return [];
  const parsed = stepValuesSchema(entry.body, step.fields).safeParse(stepValuesOf(step, values));
  return parsed.success ? [] : parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
}

/**
 * The problems with the whole body; empty when it is the request the route
 * takes. `F3.86` PR 2: it parses the route's own body (refinements included),
 * and drops the issues on a `clientOnly` field — which no step shows; the
 * page that owns the wizard adds it on submit. Not the model's body: a
 * `modelBody` may be narrower than what a person may send (PR 4).
 */
export function bodyProblems(
  entry: Pick<CatalogEntry, "body" | "clientOnly">,
  body: Readonly<Record<string, unknown>>,
): string[] {
  const parsed = entry.body.safeParse(body);
  if (parsed.success) return [];
  return parsed.error.issues
    .filter((issue) => !entry.clientOnly.includes(String(issue.path[0])))
    .map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`);
}

/**
 * The body a wizard sends: its values without the keys left unset. A route
 * with no body fields sends `{}` (plan §6.4).
 */
export function wizardBody(values: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/**
 * `F4.245` (ADR 0099 Amendment 4) — the key that names one open wizard's
 * record: its catalog id and its route with every path parameter filled. The
 * id is part of the key because two entries can share a path
 * (`assetGroup.member.setRole` and `.remove`, critique C5). `null` when the
 * parameters are not exactly the entry's or a value fails the entry's own
 * schema — the shell then shows an alert and takes no fill, rather than
 * throwing at render (critique C7).
 */
export function openWizardKey(
  entry: Pick<CatalogEntry, "id" | "path" | "params">,
  params: Readonly<Record<string, string>>,
): string | null {
  // A shell rendered without the prop (a JavaScript caller) gets no key, never a throw at render.
  if (typeof params !== "object" || params === null) return null;
  const names = pathParamsOf(entry.path).sort();
  const given = Object.keys(params).sort();
  if (names.length !== given.length || names.some((name, at) => name !== given[at])) return null;
  for (const name of names) {
    const schema = entry.params[name] as { safeParse(value: unknown): { success: boolean } } | undefined;
    if (schema === undefined || !schema.safeParse(params[name]).success) return null;
  }
  return `${entry.id} ${catalogPath(entry, params)}`;
}

/**
 * Values the copilot's `fill_step` put in a step, merged into the form. Only
 * a fill for this entry and for fields of the named step is taken; anything
 * else is ignored, so a fill can never set a field the step does not show.
 * Which record a fill is for is the store's check (`openWizardKey`).
 *
 * `F4.245` (critique C2): `fixed` names the body fields the page fixes — an
 * asset page's `assetId`, the organization a library setting is for. A fill
 * never sets one: the page sends its own value, so a filled one would only
 * make the Review card differ from the request. `null` when the fill sets no
 * field at all (review C2), so a no-op fill never marks the wizard dirty.
 */
export function applyFill(
  entryId: string,
  steps: readonly WizardStep[],
  values: Readonly<Record<string, unknown>>,
  fill: CopilotFillStepDto,
  fixed: readonly string[] = [],
): Record<string, unknown> | null {
  if (fill.catalogId !== entryId) return null;
  const step = steps.find((candidate) => candidate.id === fill.stepId);
  if (step === undefined) return null;
  const next = { ...values };
  let applied = 0;
  for (const [field, value] of Object.entries(fill.values)) {
    if (step.fields.includes(field) && !fixed.includes(field)) {
      next[field] = value;
      applied += 1;
    }
  }
  // Review C2: a fill that sets nothing is no change, so it never marks the wizard dirty.
  return applied === 0 ? null : next;
}

export type LeaveDecision =
  | { readonly allow: true }
  | { readonly allow: false; readonly prompt: string; readonly confirmLabel: string; readonly cancelLabel: string };

/**
 * The `guardTabSwitch` rule (`lib/template-tab-guard.ts`) for a wizard:
 * leaving with values the user typed asks first; leaving a clean wizard does
 * not. Moving between steps never asks — the values stay with the wizard.
 */
export function guardWizardLeave(dirty: boolean, title: string): LeaveDecision {
  if (!dirty) return { allow: true };
  return {
    allow: false,
    prompt: `Leave "${title}"? The values you entered are not saved.`,
    confirmLabel: "Discard and leave",
    cancelLabel: "Stay in the wizard",
  };
}
