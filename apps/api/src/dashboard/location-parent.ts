import type { AccessibleScope } from "@bms/shared";

/**
 * `F4.240` (ADR 0139 decision 12, plan D10) — the `parentId` the location KPI
 * items carry, keyed by location id.
 *
 * It is the caller's own scope's `parentId`, passed through unchanged:
 * `withVisibleParents` (`../auth/access-scope-sources.ts`) is the one place a
 * scope's `parentId` is decided, and it has already nulled every parent the
 * caller cannot read. Re-deciding visibility here would be a second rule that
 * could drift from `/auth/me`'s. A location absent from the map is `null` at
 * the service (fail closed).
 */
export function parentIdByLocation(scope: AccessibleScope): Map<string, string | null> {
  return new Map(scope.locations.map((location) => [location.id, location.parentId]));
}
