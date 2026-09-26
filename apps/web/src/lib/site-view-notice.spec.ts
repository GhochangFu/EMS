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

/**
 * `N3`–`N5` — each code maps to its own text, not only to a distinct one: N1
 * stays green when two codes swap strings, these do not. Each phrase appears
 * in exactly one of the three strings.
 */
export function runN3(): void {
  const text = siteViewNoticeText("dashboard_removed") ?? "";
  assert(/has been removed/.test(text), `dashboard_removed must say the dashboard was removed — got ${text}`);
}

export function runN4(): void {
  const text = siteViewNoticeText("dashboard_out_of_scope") ?? "";
  assert(
    /no longer in your access scope/.test(text),
    `dashboard_out_of_scope must say the dashboard left the access scope — got ${text}`,
  );
}

export function runN5(): void {
  const text = siteViewNoticeText("builtin_unknown") ?? "";
  assert(/built-in view/.test(text), `builtin_unknown must name the built-in view — got ${text}`);
}

/** `N2` — a `null` notice maps to `null` (no banner). */
export function runN2(): void {
  assert(siteViewNoticeText(null) === null, "null must map to null");
}
