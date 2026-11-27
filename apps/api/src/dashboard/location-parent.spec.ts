import type { AccessibleScope } from "@bms/shared";

import { parentIdByLocation } from "./location-parent";

/**
 * `F4.240` (ADR 0139 decision 12, plan D10) — the dashboard's `parentId` is the
 * scope's own, as `withVisibleParents` (`access-scope-sources.ts`) already
 * decided it. Assertions live here; `location-parent.test.ts` is the Vitest
 * entry point (ADR 0014, AGENTS.md §4.6). The SQL facts (a hidden parent
 * stays off the wire) are in `dashboard-parent.integration.spec.ts`.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

type ScopeLocation = AccessibleScope["locations"][number];

function location(id: string, parentId: string | null): ScopeLocation {
  return { id, code: id.toUpperCase(), slug: id, name: `Location ${id}`, type: "pump_station", province: null, parentId };
}

function scope(locations: ScopeLocation[]): AccessibleScope {
  return { kind: "location", locations, assetGroups: [], assetIds: [] };
}

/** L1 — each scope location maps to its `parentId` exactly as the scope carries it, `null` included. */
export function assertEachLocationKeepsTheScopesParentId(): void {
  const map = parentIdByLocation(
    scope([location("station", null), location("site-i", "station"), location("site-ii", "station"), location("orphan", null)]),
  );
  const got = JSON.stringify([...map.entries()]);
  const want = JSON.stringify([
    ["station", null],
    ["site-i", "station"],
    ["site-ii", "station"],
    ["orphan", null],
  ]);
  assert(got === want, `parentIdByLocation = ${got}, expected ${want}`);
}

/**
 * L2 — the map does not re-decide visibility: a `parentId` the scope carries is
 * passed through even when that parent is not itself in the scope. Hiding it
 * is `withVisibleParents`' job, done once; a second rule here would drift.
 */
export function assertTheMapDoesNotReDecideVisibility(): void {
  const map = parentIdByLocation(scope([location("site-i", "station")]));
  assert(map.get("site-i") === "station", `site-i → ${String(map.get("site-i"))}, expected the scope's own "station"`);
  assert(map.size === 1, `the map has ${map.size} entries, expected 1 (one per scope location, nothing added)`);
}

/** L3 — an empty scope gives an empty map, so every item falls back to `null`. */
export function assertAnEmptyScopeGivesAnEmptyMap(): void {
  const map = parentIdByLocation({ kind: "none", locations: [], assetGroups: [], assetIds: [] });
  assert(map.size === 0, `an empty scope gave ${map.size} entries, expected 0`);
}
