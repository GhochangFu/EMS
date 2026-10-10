/**
 * `@bms/shared/copilot` — the administrator copilot's code shared by the API
 * and the web (ADR 0099, `F3.85`). A subpath of its own, not re-exported from
 * `src/index.ts`: the API and the web import it as `@bms/shared/copilot`.
 *
 * Response DTOs are not here: ADR 0030 keeps them under `src/contracts/`
 * (`contracts/copilot.ts`).
 */
export { canonicalJson } from "./canonical-json";

/** The header that names the pending change a confirmed write applies (decision 4.5). */
export const COPILOT_CHANGE_HEADER = "X-Copilot-Change";
