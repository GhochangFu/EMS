import { RequestMethod } from "@nestjs/common";
import { mapToExcludeRoute } from "@nestjs/core/middleware/utils";
import { isRouteExcluded } from "@nestjs/core/router/utils";

import { readRepoFile } from "./testing/repo-root";
import { GLOBAL_PREFIX, GLOBAL_PREFIX_OPTIONS } from "./global-prefix";

/**
 * `F4.175` — the exclude list `main.ts` hands `setGlobalPrefix`, run through
 * Nest's own matcher (`mapToExcludeRoute` + `isRouteExcluded`, the pair
 * `nest-application.js` applies). A path the matcher does not exclude is
 * mounted under `/api/v1`, and a probe on the bare path answers 404.
 *
 * The last row is a source scan: the list is only the process's list if
 * `main.ts` passes it, and no spec boots through `main.ts`.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function excluded(path: string): boolean {
  const routes = mapToExcludeRoute(GLOBAL_PREFIX_OPTIONS.exclude ?? []);
  return isRouteExcluded(routes, path, RequestMethod.GET);
}

export function assertTheProbesAreUnprefixed(): void {
  for (const path of ["/health", "/health/ready", "/metrics"]) {
    assert(excluded(path), `expected GET ${path} to be excluded from the ${GLOBAL_PREFIX} prefix`);
  }
}

export function assertAnApiRouteIsStillPrefixed(): void {
  // The adjacent positive: an exclude list that matched everything would pass
  // the row above.
  for (const path of ["/dashboards", "/health/other", "/healthz"]) {
    assert(!excluded(path), `expected GET ${path} to stay under the ${GLOBAL_PREFIX} prefix`);
  }
}

export function assertMainPassesTheList(): void {
  const source = readRepoFile("apps/api/src/main.ts");
  assert(
    /app\.setGlobalPrefix\(GLOBAL_PREFIX, GLOBAL_PREFIX_OPTIONS\)/.test(source),
    "expected main.ts to call app.setGlobalPrefix(GLOBAL_PREFIX, GLOBAL_PREFIX_OPTIONS)",
  );
}
