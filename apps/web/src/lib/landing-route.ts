import type { AccessibleScope } from "@bms/shared";

/** Returns the first page a user should see after login based on access scope. */
export function landingRouteForScope(scope: AccessibleScope): string {
  if (
    (scope.kind === "location" || scope.kind === "asset_group") &&
    scope.locations.length === 1
  ) {
    return `/locations/${scope.locations[0]!.id}/dashboard`;
  }
  return "/";
}
