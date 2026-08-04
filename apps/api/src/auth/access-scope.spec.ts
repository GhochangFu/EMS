import type { UserRole } from "@bms/shared";

import {
  isMasterDataRole,
  noAccessScope,
  readScopeSourcesForRole,
} from "./access-scope";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const grantSources = ["organization", "location", "asset_group"] as const;

/**
 * F4.11 — operator/viewer read scope.
 *
 * Before the fix `scopeForUser` had no branch for `operator` or `viewer`, so
 * both fell through to `kind: "none"` and every scoped read (`readableAssetIds`
 * → dashboard/alarms/assets/rules/reports) returned an empty set. These roles
 * must resolve their read scope from the same grant tables the scoped admin
 * roles use, while staying out of every write path.
 */
export function runAccessScopeTests(): void {
  // --- The bug: operator must consult the grant tables. ---
  const operatorSources = readScopeSourcesForRole("operator");
  for (const grantSource of grantSources) {
    assert(
      operatorSources.includes(grantSource),
      `operator must resolve read scope from ${grantSource} grants`,
    );
  }
  assert(
    operatorSources[operatorSources.length - 1] === "none",
    'operator must fail closed to "none" when it holds no grant',
  );
  assert(
    !operatorSources.includes("global"),
    "operator must never receive global (cross-organization) read scope",
  );

  // --- viewer is held back on purpose, and this asserts it stays that way. ---
  // Every operations mutation endpoint (alarm ack, rule publish, work orders,
  // maintenance) authorizes solely on the read scope produced here and rejects
  // only when it is empty. Granting viewer a read scope would therefore grant
  // it those writes too. Flipping this assertion is only correct once those
  // endpoints carry their own write gate.
  assert(
    readScopeSourcesForRole("viewer").join() === "none",
    "viewer stays fail-closed until operations writes are role-gated",
  );

  // --- Read-only stays read-only. ---
  assert(isMasterDataRole("admin"), "admin is a master-data role");
  assert(
    isMasterDataRole("organization_admin"),
    "organization_admin is a master-data role",
  );
  assert(
    isMasterDataRole("location_admin"),
    "location_admin is a master-data role",
  );
  assert(!isMasterDataRole("operator"), "operator must not gain write access");
  assert(!isMasterDataRole("viewer"), "viewer must not gain write access");
  assert(
    !isMasterDataRole("asset_group_admin"),
    "asset_group_admin must not gain master-data write access",
  );

  // --- Existing roles keep their current source, unchanged. ---
  assert(
    readScopeSourcesForRole("admin").join() === "global",
    "admin keeps unrestricted global scope",
  );
  assert(
    readScopeSourcesForRole("organization_admin").join() === "organization",
    "organization_admin keeps organization-grant scope",
  );
  assert(
    readScopeSourcesForRole("location_admin").join() === "location",
    "location_admin keeps location-grant scope",
  );
  assert(
    readScopeSourcesForRole("asset_group_admin").join() === "asset_group",
    "asset_group_admin keeps asset-group-grant scope",
  );

  // --- Unknown role strings from `bms.users.role` fail closed. ---
  const unknownRole = "future_role" as unknown as UserRole;
  assert(
    readScopeSourcesForRole(unknownRole).join() === "none",
    "an unrecognised role resolves to no access",
  );
  assert(
    !isMasterDataRole(unknownRole),
    "an unrecognised role has no write access",
  );

  // --- Fail-closed scope literal, freshly allocated per call. ---
  const empty = noAccessScope();
  assert(empty.kind === "none", "no-access scope kind is none");
  assert(empty.assetIds.length === 0, "no-access scope has no assets");
  assert(empty.locations.length === 0, "no-access scope has no locations");
  assert(empty.assetGroups.length === 0, "no-access scope has no asset groups");
  assert(
    noAccessScope().assetIds !== empty.assetIds,
    "no-access scope must not share arrays between requests",
  );
}
