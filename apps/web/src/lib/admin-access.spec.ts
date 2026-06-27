import { pathToFileURL } from "node:url";

import {
  canAccessOnboarding,
  canCreateLocations,
  canWriteOrganizations,
  canWritePointKeys,
  defaultAdminRoute,
  isGlobalAdmin,
  isMasterDataAdmin,
} from "./admin-access";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** Unit checks for admin route access helpers. */
export function runAdminAccessTests(): void {
  assert(isMasterDataAdmin("admin"), "admin is master data admin");
  assert(isMasterDataAdmin("organization_admin"), "organization_admin is master data admin");
  assert(isMasterDataAdmin("location_admin"), "location_admin is master data admin");
  assert(!isMasterDataAdmin("operator"), "operator is not master data admin");
  assert(isGlobalAdmin("admin"), "admin is global admin");
  assert(!isGlobalAdmin("organization_admin"), "organization_admin is not global admin");
  assert(!isGlobalAdmin("location_admin"), "location_admin is not global admin");
  assert(canWriteOrganizations("admin"), "admin can write organizations");
  assert(!canWriteOrganizations("organization_admin"), "org admin cannot write organizations");
  assert(canCreateLocations("organization_admin"), "org admin can create locations");
  assert(!canCreateLocations("location_admin"), "location admin cannot create locations");
  assert(canWritePointKeys("organization_admin"), "org admin can write point keys");
  assert(!canWritePointKeys("location_admin"), "location admin cannot write point keys");
  assert(defaultAdminRoute("admin") === "/admin/organizations", "admin default route");
  assert(defaultAdminRoute("organization_admin") === "/admin/organizations", "org admin default route");
  assert(canAccessOnboarding("organization_admin"), "org admin can onboard");
  assert(!canAccessOnboarding("location_admin"), "location admin cannot onboard");
}

const isMain =
  import.meta.url === pathToFileURL(process.argv[1] ?? "").href;

if (isMain) {
  runAdminAccessTests();
  process.stdout.write("admin-access tests: ok\n");
}
