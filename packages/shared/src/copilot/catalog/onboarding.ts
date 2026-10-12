import type { CatalogEntry, ExcludedRoute } from "./types";

/**
 * `F3.86` (ADR 0099 release 2) — the catalog entries for the onboarding skill's commit (decision 7).
 * One file per area, so the wizard PRs never edit the same catalog file
 * (plan §4.5). Until its PR lands, each write route of the area waits in
 * {@link ONBOARDING_PENDING}; the PR moves it to {@link ONBOARDING_ENTRIES}.
 */
export const ONBOARDING_ENTRIES: readonly CatalogEntry[] = [];

const PENDING = "F3.86 PR 6";
const DRAFT = "a draft step writes no master data (decision 7)";
const CREDENTIAL = "a credential route (ADR 0022)";

/** The area's write routes that are not entries: waiting for their PR, or excluded for good (with the reason). */
export const ONBOARDING_PENDING: readonly ExcludedRoute[] = [
  { method: "POST", path: "/admin/onboarding/sessions/:id/commit", reason: PENDING },
  { method: "POST", path: "/admin/onboarding/sessions", reason: DRAFT },
  { method: "POST", path: "/admin/onboarding/sessions/:id/chat", reason: DRAFT },
  { method: "POST", path: "/admin/onboarding/sessions/:id/upload", reason: DRAFT },
  { method: "PATCH", path: "/admin/onboarding/sessions/:id/draft", reason: DRAFT },
  { method: "POST", path: "/admin/onboarding/sessions/:id/credentials", reason: CREDENTIAL },
  { method: "POST", path: "/admin/onboarding/sessions/:id/rollback", reason: DRAFT },
  { method: "POST", path: "/admin/onboarding/sessions/:id/validate", reason: DRAFT },
];
