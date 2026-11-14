import type { AlarmPageQuery } from "../api/alarms";
import { hasScope, type ScopeFilter } from "./scope-filter";

/**
 * `F4.361` (ADR 0132 decisions 3, 7 and 9; plan D15) — the Alarm Centre's own two filters,
 * Severity and State, kept in the URL beside the scope filter (decision 8).
 *
 * State is All (absent), Active or Suppressed. `unacknowledged` is left out: it is one page with
 * no cursor (ADR 0130), so it cannot back a paged table (decision 7). A URL naming it, `all` or
 * anything else reads as All.
 */
export type AlarmStateChoice = "active" | "suppressed";

export type AlarmPageFilter = {
  readonly state?: AlarmStateChoice;
  readonly severity?: string;
};

/** A URL or picker value as a State choice: `active` or `suppressed`, anything else All (`undefined`). */
export function toAlarmStateChoice(value: string | null): AlarmStateChoice | undefined {
  return value === "active" || value === "suppressed" ? value : undefined;
}

/** The page's Severity and State from the URL; an empty severity or an unknown state reads as All. */
export function readAlarmPageFilter(params: URLSearchParams): AlarmPageFilter {
  const state = toAlarmStateChoice(params.get("state"));
  const severity = params.get("severity")?.trim();
  return {
    ...(state ? { state } : {}),
    ...(severity ? { severity } : {}),
  };
}

/** A copy of `params` with `state` and `severity` replaced; the scope keys are kept. */
export function writeAlarmPageFilter(params: URLSearchParams, filter: AlarmPageFilter): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const key of ["state", "severity"] as const) {
    const value = filter[key];
    if (value) {
      next.set(key, value);
    } else {
      next.delete(key);
    }
  }
  return next;
}

/** One list request: the scope's ids and the page's two keys, with no key for one left out. */
export function alarmListQuery(scope: ScopeFilter, page: AlarmPageFilter): AlarmPageQuery {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries({ ...scope, ...page })) {
    if (value) {
      out[key] = value;
    }
  }
  return out as AlarmPageQuery;
}

/**
 * Whether Critical may say "all clear" (D15). A zero under a chosen severity or under Suppressed
 * is a statement about the filter, not about the plant.
 */
export function criticalMayReadAllClear(page: AlarmPageFilter): boolean {
  return !page.severity && page.state !== "suppressed";
}

/** Whether any key narrows the list, so an empty answer is "nothing matches", not "no alarms yet". */
export function isAlarmListFiltered(query: AlarmPageQuery): boolean {
  return hasScope(query) || Boolean(query.state) || Boolean(query.severity);
}
