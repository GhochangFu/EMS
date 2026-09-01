import { z } from "zod";

/**
 * The template lifecycle — **declared once**, read by both template tables.
 *
 * ADR 0049 decision 2 rules full lifecycle parity between `bms.asset_templates`
 * (ADR 0015/0019/0039) and `bms.dashboard_templates` (`F3.36`, migration
 * `0056`), and then says how that parity is held: *"The status vocabulary and
 * the legal transitions are declared once and both tables read that
 * declaration; a source scan fails a second copy. A convention that the two
 * 'stay in step' is not a gate."*
 *
 * This is the declaration.
 * `tests/f3.36-template-lifecycle-single-source.test.ts` is the scan.
 *
 * **Two permanent exceptions, both recorded rather than hidden.**
 *
 * 1. **Migration `0056`'s `dashboard_templates_status_check`**, and `0024`'s
 *    before it, restate the three values in SQL. SQL has no imports, so this is
 *    a principled exception rather than an oversight — the same shape `f3.1d`
 *    accepts for `dashboard_widgets_grid_bounds_check`. The scan does not read
 *    `.sql` and is not expected to.
 * 2. **`automationRuleLifecycleStatusSchema`** in `./operations` spells the same
 *    three states and is a **different vocabulary**. Read
 *    `apps/api/src/rules/rules.service.ts` before collapsing them: `archiveRule`
 *    carries no status guard at all, so a rule goes `draft -> archived`
 *    directly, and `publishRule` refuses only `archived`, so re-publish is
 *    legal. The template lifecycle permits neither. §4.8 records this from
 *    `F4.45` — *"an asymmetry that will not resolve is often two vocabularies
 *    wearing one name"*.
 */

/**
 * The three states, in lifecycle order.
 *
 * `as const` and no spread at the use site: `z.enum` accepts a `readonly` tuple
 * on the zod version this package pins, so `z.enum(TEMPLATE_LIFECYCLE_STATUSES)`
 * compiles as written. A spread would copy the array and defeat the single
 * declaration this file exists to be.
 */
export const TEMPLATE_LIFECYCLE_STATUSES = ["draft", "published", "archived"] as const;

export const templateLifecycleStatusSchema = z.enum(TEMPLATE_LIFECYCLE_STATUSES);

export type TemplateLifecycleStatus = (typeof TEMPLATE_LIFECYCLE_STATUSES)[number];

/**
 * The legal transitions, exhaustively.
 *
 * **`archived` is terminal on purpose.** "Revive an archived version" creates a
 * NEW row through `createDraftFrom`, at `max(version) + 1` — it is not a
 * transition of the archived row, and the archived row must stay exactly as the
 * assets and dashboards built from it saw it. Do not add `archived: ["draft"]`
 * here; that would mutate a version other rows are pinned to, which is the one
 * thing ADR 0039's versioning exists to prevent.
 *
 * `published -> published` is absent for the same reason: a second publish of a
 * published version is a no-op that hides a mistake, and the caller meant to
 * publish a draft.
 */
export const TEMPLATE_LIFECYCLE_TRANSITIONS: Readonly<
  Record<TemplateLifecycleStatus, readonly TemplateLifecycleStatus[]>
> = {
  draft: ["published"],
  published: ["archived"],
  archived: [],
};

/** Whether `from -> to` is one of the legal transitions above. */
export function canTransition(
  from: TemplateLifecycleStatus,
  to: TemplateLifecycleStatus,
): boolean {
  return TEMPLATE_LIFECYCLE_TRANSITIONS[from].includes(to);
}

/**
 * The statuses whose row may still be **mutated in place** — edited, or deleted.
 *
 * This is a lifecycle rule and not a transition, which is why it is a second
 * declaration rather than a row of the map above: editing a draft leaves it a
 * draft. It lives here because a service that imported the transitions and then
 * hand-rolled `status !== "draft"` would satisfy the letter of decision 2 and
 * none of it.
 *
 * A published or archived version is immutable so that the assets and
 * dashboards pinned to it never change under them — ADR 0039's whole point.
 */
export const TEMPLATE_MUTABLE_STATUSES: readonly TemplateLifecycleStatus[] = ["draft"];

/** Whether a version may still be edited or deleted in place. */
export function canMutate(status: TemplateLifecycleStatus): boolean {
  return TEMPLATE_MUTABLE_STATUSES.includes(status);
}

/**
 * The statuses a **new draft** may be opened from — `createDraftFrom`.
 *
 * Declared rather than derived, even though it currently holds the same single
 * member as "can be archived". That coincidence is not the rule: a draft is
 * already editable and needs no branch, and an archived version is frozen for
 * the rows pinned to it. Writing `canTransition(status, "archived")` at the call
 * site would work today and mean something else the day the lifecycle grows.
 */
export const TEMPLATE_BRANCHABLE_STATUSES: readonly TemplateLifecycleStatus[] = ["published"];

/** Whether a NEW draft may be branched from this version. */
export function canOpenDraftFrom(status: TemplateLifecycleStatus): boolean {
  return TEMPLATE_BRANCHABLE_STATUSES.includes(status);
}

/** Refusal for branching a version that is not published. */
export function branchRefusedMessage(status: TemplateLifecycleStatus): string {
  return `Only a published template can open a new draft; this one is ${status}`;
}

/** The actions a non-draft version refuses. `published` is here because
 * publishing is only legal from a draft, so its refusal reads the same way. */
export type TemplateDraftRequiredVerb = "edited" | "published" | "deleted";

/**
 * ---------------------------------------------------------------------------
 * THE REFUSAL MESSAGES ARE ASSERTED ON, BYTE FOR BYTE.
 * ---------------------------------------------------------------------------
 *
 * `apps/api/src/admin/asset-templates/asset-templates.lifecycle.integration.spec.ts`
 * matches these exact strings. They are moved here unchanged from
 * `asset-templates.service.ts`, so that the two template services cannot drift
 * into two different sentences for the same refusal.
 *
 * If one must change, change it here **and** change that suite in the same
 * commit — never loosen the suite to make a rewire pass.
 */

/** Refusal for editing, publishing or deleting a version that is not a draft. */
export function draftRequiredMessage(
  status: TemplateLifecycleStatus,
  verb: TemplateDraftRequiredVerb,
): string {
  return (
    `A ${status} template cannot be ${verb}. Create a new draft version instead — ` +
    "published versions are immutable so that assets built from them never change."
  );
}

/** Refusal for archiving a version that is not published. */
export function archiveRefusedMessage(status: TemplateLifecycleStatus): string {
  return `Only a published template can be archived; this one is ${status}`;
}
