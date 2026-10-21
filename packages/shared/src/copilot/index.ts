/**
 * `@bms/shared/copilot` — the administrator copilot's code shared by the API
 * and the web (ADR 0099, `F3.85`). A subpath of its own, not re-exported from
 * `src/index.ts`: the API and the web import it as `@bms/shared/copilot`.
 *
 * Response DTOs are not here: ADR 0030 keeps them under `src/contracts/`
 * (`contracts/copilot.ts`).
 */
export { canonicalJson } from "./canonical-json";
export {
  CANVAS_ENTRY_IDS,
  cardOnlyKeysFor,
  catalogEntry,
  catalogParamsOf,
  catalogPath,
  COPILOT_API_PREFIX,
  COPILOT_CATALOG,
  DELETE_ALLOWANCE,
  EXCLUDED_ROUTES,
  formulaRefsOf,
  formulaSitesOf,
  type FormulaSite,
  hashExcludedKeysFor,
  hashExcludedKeysOf,
  pathParamsOf,
  proposeToolName,
} from "./catalog";
export { modelBodyOf } from "./catalog/model-body";
export {
  onboardingCommitCounts,
  type OnboardingCommitDraft,
  onboardingCommitSiteName,
} from "./catalog/onboarding";
export { bodyFieldsOf, objectShapeOf, stepValuesSchema } from "./catalog/object-shape";
export { writeNodeOfDto } from "./mimic-layout-write-node";
export { isCopilotOutcomeLine } from "./outcome-line";
export type {
  CatalogEntry,
  CatalogFormula,
  CatalogMethod,
  CatalogRef,
  CatalogRefKind,
  CatalogRisk,
  CatalogStep,
  CatalogSummaryInput,
  CatalogTarget,
  ExcludedRoute,
} from "./catalog/types";

/** The header that names the pending change a confirmed write applies (decision 4.5). */
export const COPILOT_CHANGE_HEADER = "X-Copilot-Change";

/**
 * `F3.86` PR 2 — the interceptor's one refusal sentence (`CHANGE_REFUSED` in
 * `copilot-change.interceptor.ts`), shared so the Confirm card can tell it from
 * a route's own 409: this sentence means the change is gone; any other failure
 * is the route's answer, recorded as `failed`.
 */
export const COPILOT_CHANGE_REFUSED_MESSAGE = "This copilot change cannot be applied";

/** `F3.86` PR 2 — the interceptor's 403 before the claim: the change stays pending (`COPILOT_UNAVAILABLE`). */
export const COPILOT_UNAVAILABLE_MESSAGE = "The copilot is not available here";
