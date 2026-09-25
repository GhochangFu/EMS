import { siteViewNoticeText } from "./site-view-notice";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** `N1` — the three fail-safe codes map to three distinct, non-empty strings. */
export function runN1(): void {
  const removed = siteViewNoticeText("dashboard_removed");
  const outOfScope = siteViewNoticeText("dashboard_out_of_scope");
  const builtinUnknown = siteViewNoticeText("builtin_unknown");

  assert(!!removed && removed.length > 0, "dashboard_removed must be non-empty");
  assert(!!outOfScope && outOfScope.length > 0, "dashboard_out_of_scope must be non-empty");
  assert(!!builtinUnknown && builtinUnknown.length > 0, "builtin_unknown must be non-empty");
  assert(removed !== outOfScope, "dashboard_removed and dashboard_out_of_scope must differ");
  assert(removed !== builtinUnknown, "dashboard_removed and builtin_unknown must differ");
  assert(outOfScope !== builtinUnknown, "dashboard_out_of_scope and builtin_unknown must differ");
}

/** `N2` — a `null` notice maps to `null` (no banner). */
export function runN2(): void {
  assert(siteViewNoticeText(null) === null, "null must map to null");
}
