/**
 * What a template version allows at each lifecycle status (`F2.5`, ADR 0038
 * decision 3 — Unit 6).
 *
 * ADR 0015 makes a row a *version*, and a published version immutable except
 * for `status -> archived`. The page therefore cannot decide "editable" from a
 * permission alone: a global admin editing a published version is still
 * refused, by the API and by this module.
 *
 * Kept in `lib/` for the reason `vocabulary.ts` records — the root
 * `vitest.config.ts` counts only `apps/web/src/lib/**` toward coverage, so a
 * lifecycle rule left in a `.tsx` is untestable and invisible to the gate.
 */
import type { AssetTemplateStatus } from "@bms/shared";

/** Every lifecycle action the detail page can offer. */
export type TemplateLifecycleAction =
  | "publish"
  | "delete"
  | "createDraft"
  | "instantiate"
  | "archive";

export type TemplateCapabilities = {
  /** Whether any authoring field on the page accepts input. */
  editable: boolean;
  /**
   * The lifecycle buttons to render, in the order they are rendered.
   *
   * `readonly` is load-bearing: `capabilities()` hands back the stored object
   * rather than a copy, so a caller that sorted this array in place would
   * change what every later caller sees. `ReadonlyArray` exposes no `sort`,
   * `push` or `splice`, which closes that at compile time for every caller
   * that does not cast.
   */
  actions: readonly TemplateLifecycleAction[];
};

/**
 * The table, mirroring the server's own guards.
 *
 * Each entry is checked against `asset-templates.service.ts`:
 * `assertDraft` gates `update` (line 198), `publish` (271) and `deleteDraft`
 * (413); `archive` requires `published` (321); and
 * `asset-templates-instantiate.service.ts:128` requires `published`.
 *
 * **One deliberate divergence.** `createDraftFrom` (line 349) carries **no**
 * status guard, so the API would accept a new draft from an archived version.
 * ADR 0038 states "An `archived` version is read-only with no actions", so the
 * page does not offer it. The rule is a product choice, not a server
 * constraint, and it is written here rather than left implicit — otherwise the
 * next reader compares this table to the service and reads the gap as a defect.
 */
const CAPABILITIES: Readonly<Record<AssetTemplateStatus, TemplateCapabilities>> = {
  draft: { editable: true, actions: ["publish", "delete"] },
  published: { editable: false, actions: ["createDraft", "instantiate", "archive"] },
  archived: { editable: false, actions: [] },
};

/** What this status allows. */
export function capabilities(status: AssetTemplateStatus): TemplateCapabilities {
  return CAPABILITIES[status];
}

/**
 * Whether every formula field renders read-only.
 *
 * ADR 0038 decision 3: *"The page must never render an editable formula field
 * on a published template."* Derived from `editable` rather than listing the
 * statuses again, so the two can never disagree — a status added to the union
 * with `editable: false` is read-only here without a second edit.
 */
export function formulaFieldsAreReadOnly(status: AssetTemplateStatus): boolean {
  return !capabilities(status).editable;
}
