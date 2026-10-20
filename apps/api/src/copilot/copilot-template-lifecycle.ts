import {
  archiveRefusedMessage,
  branchRefusedMessage,
  canInstantiate,
  canMutate,
  canOpenDraftFrom,
  canTransition,
  draftRequiredMessage,
  instantiateRefusedMessage,
  type TemplateLifecycleStatus,
} from "@bms/shared";

/**
 * The propose tool's refusal for a target it may not name: missing, outside
 * the turn's allowed set, or one the caller may not manage — one sentence,
 * so the tool never tells a model which (ADR 0099 decision 10). It lives here
 * because the lifecycle mirror below fails closed with it, and
 * `copilot-propose-tools.ts` re-exports it, so its importers do not move.
 */
export const PROPOSE_TARGET_ERROR =
  "That record was not found among the organizations this conversation may change, or you may not change it.";

type Rule = (status: TemplateLifecycleStatus) => string | null;

const edit: Rule = (status) => (canMutate(status) ? null : draftRequiredMessage(status, "edited"));
const publish: Rule = (status) => (canTransition(status, "published") ? null : draftRequiredMessage(status, "published"));
const archive: Rule = (status) => (canTransition(status, "archived") ? null : archiveRefusedMessage(status));
const instantiateAs =
  (table: "asset" | "dashboard"): Rule =>
  (status) =>
    canInstantiate(status) ? null : instantiateRefusedMessage(status, table);

/**
 * `F4.246` / ADR 0049 decision 2 — each template route's lifecycle refusal,
 * mirrored at propose time so a card that could only meet a 409 at Confirm is
 * never stored, and the model reads the route's own sentence and corrects
 * itself. Each row reads the shared declaration the route reads:
 *
 * - `*.update` — `assertDraft(template, "edited")` in `asset-templates.service.ts`
 *   and `dashboard-templates.service.ts` (`canMutate`).
 * - `*.publish`, `*.archive` — the transition guard in
 *   `asset-templates-write-guards.ts` and `dashboard-templates.service.ts`
 *   (`canTransition`; publish refuses with the "published" sentence, archive
 *   with its own).
 * - `dashboardTemplate.draft` — `createDraftFrom`'s `canOpenDraftFrom` in
 *   `dashboard-templates.service.ts`.
 * - `*.instantiate` — `asset-templates-instantiate-core.ts` and
 *   `dashboard-templates-instantiate.service.ts`, each with its own sentence.
 *
 * **Absent on purpose:** `assetTemplate.draft` and
 * `dashboardTemplate.applyToSites` hold no status guard on the row (their 409
 * is "a draft already exists", which needs a second query), so they stay a
 * Confirm-time refusal. Every other entry has no lifecycle.
 *
 * The rows use only the shared predicates, never a status literal. That is a
 * convention: `tests/f3.36-template-lifecycle-single-source.test.ts` scans
 * only its pinned transition owners, not this file.
 */
const RULES: Readonly<Record<string, Rule>> = Object.freeze({
  "assetTemplate.update": edit,
  "dashboardTemplate.update": edit,
  "assetTemplate.publish": publish,
  "dashboardTemplate.publish": publish,
  "assetTemplate.archive": archive,
  "dashboardTemplate.archive": archive,
  "dashboardTemplate.draft": (status: TemplateLifecycleStatus) => (canOpenDraftFrom(status) ? null : branchRefusedMessage(status)),
  "assetTemplate.instantiate": instantiateAs("asset"),
  "dashboardTemplate.instantiate": instantiateAs("dashboard"),
});

/** The catalog ids the mirror rules, for the spec that pins them to the catalog. */
export const TEMPLATE_LIFECYCLE_RULED_IDS: readonly string[] = Object.keys(RULES);

/**
 * The route's refusal for `entryId` on a target at `status`, or `null` when
 * the route would admit it (or holds no lifecycle rule). A ruled entry whose
 * target carries no status — a resolver that did not read it, or a value
 * outside the vocabulary — fails closed with `PROPOSE_TARGET_ERROR`.
 */
export function templateLifecycleRefusal(entryId: string, status: TemplateLifecycleStatus | undefined): string | null {
  const rule = Object.hasOwn(RULES, entryId) ? RULES[entryId] : undefined;
  if (rule === undefined) return null;
  if (status === undefined) return PROPOSE_TARGET_ERROR;
  return rule(status);
}
