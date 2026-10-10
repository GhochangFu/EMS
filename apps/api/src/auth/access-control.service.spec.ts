import { ForbiddenException } from "@nestjs/common";

import { AccessControlService } from "./access-control.service";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

async function rejectsWith(
  run: () => Promise<unknown>,
  is: (err: unknown) => boolean,
  why: string,
): Promise<void> {
  try {
    await run();
  } catch (err) {
    assert(is(err), `${why}: threw ${String(err)}`);
    return;
  }
  throw new Error(`${why}: it did not throw`);
}

type Ctor = ConstructorParameters<typeof AccessControlService>;

// A uuid since F3.78: local auth resolves `id = sub`, and a non-uuid subject
// matches no row by construction (`identity-resolver.ts`), never reaching the fake.
const USER_ID = "00000000-0000-4000-8000-0000000000e1";
const USER_EMAIL = "u1@bms.local";
const OWN_ORG_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_ORG_ID = "22222222-2222-2222-2222-222222222222";

/** A fake `authDb` — the one query `resolveDbUser` makes, role fixed per test. */
function fakeAuthDb(role: string): Ctor[0] {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () =>
            Promise.resolve([
              { id: USER_ID, email: USER_EMAIL, displayName: "U1", role },
            ]),
        }),
      }),
    }),
  } as unknown as Ctor[0];
}

/**
 * A fake `fleetDb` — `directOrganizationIds` is the only pre-tenant grant walk
 * `canManageOrganization` needs for this gate (`organization_admin`'s own
 * direct `user_organization_access` grants).
 */
function fakeFleetDb(ownOrgIds: string[]): Ctor[1] {
  return {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(ownOrgIds.map((id) => ({ id }))),
      }),
    }),
  } as unknown as Ctor[1];
}

function serviceFor(role: string, ownOrgIds: string[] = [OWN_ORG_ID]): AccessControlService {
  return new AccessControlService(fakeAuthDb(role), fakeFleetDb(ownOrgIds));
}

/**
 * A fake `fleetDb` that refuses every query — for the cases whose claim is
 * "answered from the role alone, no grant walk". A `select` here is the
 * failure, not a value the case could compare against.
 */
function refusingFleetDb(why: string): Ctor[1] {
  return {
    select: () => {
      throw new Error(`unexpected fleet query: ${why}`);
    },
  } as unknown as Ctor[1];
}

const jwtOf = (role: "admin" | "organization_admin" | "location_admin" | "viewer") => ({
  sub: USER_ID,
  email: USER_EMAIL,
  name: "U1",
  role,
});

/**
 * `F2.10` / ADR 0098 decision 12 — `isOrganizationLevelAdmin` answers from the
 * role and, for an `organization_admin`, from the **direct**
 * `user_organization_access` row for that organization. Never from
 * `canManageOrganization`, which is location-derived for a `location_admin`.
 *
 * The `Y` case is the one a role-only implementation fails: an
 * `organization_admin` holding X must be refused on Y, and the live twin
 * (`location-tree.integration.spec.ts`, `assertForeignOrganizationAdminIsNotOrganizationLevel`)
 * proves it against real grant rows.
 */
export async function runIsOrganizationLevelAdminTests(): Promise<void> {
  {
    const svc = new AccessControlService(fakeAuthDb("admin"), refusingFleetDb("admin is role-only"));
    assert(
      (await svc.isOrganizationLevelAdmin(jwtOf("admin"), OWN_ORG_ID)) === true,
      "a global admin is organization-level for any organization",
    );
    assert(
      (await svc.isOrganizationLevelAdmin(jwtOf("admin"), OTHER_ORG_ID)) === true,
      "a global admin is organization-level for an organization nobody granted",
    );
  }
  {
    const svc = serviceFor("organization_admin", [OWN_ORG_ID]);
    assert(
      (await svc.isOrganizationLevelAdmin(jwtOf("organization_admin"), OWN_ORG_ID)) === true,
      "an organization_admin with a direct row for X is organization-level for X",
    );
    assert(
      (await svc.isOrganizationLevelAdmin(jwtOf("organization_admin"), OTHER_ORG_ID)) === false,
      "an organization_admin with a direct row for X is NOT organization-level for Y — " +
        "a role-only answer is the ADR 0098 decision 12 defect",
    );
  }
  {
    const svc = new AccessControlService(
      fakeAuthDb("location_admin"),
      refusingFleetDb("location_admin is refused from the role alone"),
    );
    assert(
      (await svc.isOrganizationLevelAdmin(jwtOf("location_admin"), OWN_ORG_ID)) === false,
      "a location_admin is never organization-level, and no grant is walked to decide it",
    );
  }
  {
    const svc = new AccessControlService(fakeAuthDb("viewer"), refusingFleetDb("viewer is refused from the role alone"));
    assert(
      (await svc.isOrganizationLevelAdmin(jwtOf("viewer"), OWN_ORG_ID)) === false,
      "a viewer is false, not a throw — the caller decides the 403",
    );
  }
}

/**
 * `F2.10` / ADR 0098 Drafter choice 9 — `grantedLocationIds` is the direct
 * grant set, never the closure: `null` for `admin`, `[]` for an
 * `organization_admin` (whose stamp is the empty array, Amendment 1 item 2).
 * The `location_admin` answer needs real grant rows and is proved in
 * `location-tree.integration.spec.ts`.
 */
export async function runGrantedLocationIdsTests(): Promise<void> {
  {
    const svc = new AccessControlService(fakeAuthDb("admin"), refusingFleetDb("admin holds no grant row"));
    assert(
      (await svc.grantedLocationIds(jwtOf("admin"))) === null,
      "a global admin's granted set is the unrestricted sentinel",
    );
  }
  {
    const svc = new AccessControlService(
      fakeAuthDb("organization_admin"),
      refusingFleetDb("organization_admin holds no location grant row"),
    );
    const granted = await svc.grantedLocationIds(jwtOf("organization_admin"));
    assert(
      Array.isArray(granted) && granted.length === 0,
      `an organization_admin's granted set is [], got ${JSON.stringify(granted)}`,
    );
  }
  {
    const svc = new AccessControlService(fakeAuthDb("viewer"), refusingFleetDb("viewer is refused first"));
    await rejectsWith(
      () => svc.grantedLocationIds(jwtOf("viewer")),
      (e) => e instanceof ForbiddenException,
      "a viewer is refused master-data administration before any grant is read",
    );
  }
}

/**
 * `F2.10` U2 — `readableLocationIds` is `/auth/me`'s location list: `null` for
 * a global admin with no grant walk, and exactly the ids `scopeForUser`
 * returns for anyone else. `scopeForUser` is stubbed on the instance: its
 * grant walk (`selectReadScopeSourceFor` + `scopeFromSource`) has its own
 * integration suite, and the claim here is only that this method hands that
 * scope's ids through — not `null`, not the asset list, not a re-derivation.
 */
export async function runReadableLocationIdsTests(): Promise<void> {
  {
    const svc = new AccessControlService(fakeAuthDb("admin"), refusingFleetDb("admin reads everything"));
    assert(
      (await svc.readableLocationIds(jwtOf("admin"))) === null,
      "a global admin's readable location set is the unrestricted sentinel",
    );
  }
  {
    const svc = new AccessControlService(
      fakeAuthDb("location_admin"),
      refusingFleetDb("the scope is stubbed"),
    );
    const stubbed = svc as unknown as { scopeForUser: () => Promise<unknown> };
    stubbed.scopeForUser = async () => ({
      kind: "locations",
      organizations: [],
      locations: [
        { id: "loc-a", code: "A", name: "A", organizationId: OWN_ORG_ID, parentId: null },
        { id: "loc-a1", code: "A1", name: "A1", organizationId: OWN_ORG_ID, parentId: "loc-a" },
      ],
      assetGroups: [],
      assetIds: ["asset-1"],
    });
    const ids = await svc.readableLocationIds(jwtOf("location_admin"));
    assert(
      JSON.stringify(ids) === JSON.stringify(["loc-a", "loc-a1"]),
      `a location admin reads exactly its scope's location ids, got ${JSON.stringify(ids)}`,
    );
  }
}

/**
 * `E7.1c` (ADR 0043 Amendment 5, decision 7) — the four cases
 * `canManageNotificationChannel` must answer, mirroring `canManagePointKey`'s
 * own four (`point-keys.service.ts`) exactly but for the one deviation: a
 * `null` organizationId names a fleet-managed global channel, and it is
 * fleet-only.
 *
 * `canManagePointKey` itself carries **no covering test today** (found by
 * CodeGraph's blast-radius report) — this file exists so the gate this item
 * adds does not inherit that gap.
 */
export async function runAccessControlServiceTests(): Promise<void> {
  // --- admin: true, including for a null (global) channel ------------------
  {
    const svc = serviceFor("admin");
    assert(
      (await svc.canManageNotificationChannel({ sub: USER_ID, email: USER_EMAIL, name: "U1", role: "admin" }, OWN_ORG_ID)) === true,
      "a global admin may manage an org-scoped channel",
    );
    assert(
      (await svc.canManageNotificationChannel({ sub: USER_ID, email: USER_EMAIL, name: "U1", role: "admin" }, null)) === true,
      "a global admin may manage a fleet-managed global channel",
    );
  }

  // --- organization_admin: own org true, another org false, null false -----
  {
    const svc = serviceFor("organization_admin", [OWN_ORG_ID]);
    const jwt = { sub: USER_ID, email: USER_EMAIL, name: "U1", role: "organization_admin" as const };
    assert(
      (await svc.canManageNotificationChannel(jwt, OWN_ORG_ID)) === true,
      "an organization_admin may manage a channel in its own organization",
    );
    assert(
      (await svc.canManageNotificationChannel(jwt, OTHER_ORG_ID)) === false,
      "an organization_admin may not manage a channel in another organization",
    );
    assert(
      (await svc.canManageNotificationChannel(jwt, null)) === false,
      "an organization_admin may not manage a fleet-managed global channel — " +
        "a global row is a fleet actor's row, not a tenant's",
    );
  }

  // --- every other master-data role: false, not a throw ---------------------
  {
    const svc = serviceFor("location_admin");
    const jwt = { sub: USER_ID, email: USER_EMAIL, name: "U1", role: "location_admin" as const };
    assert(
      (await svc.canManageNotificationChannel(jwt, OWN_ORG_ID)) === false,
      "location_admin is a master-data role but may not manage notification channels",
    );
    assert(
      (await svc.canManageNotificationChannel(jwt, null)) === false,
      "location_admin may not manage a global channel either",
    );
  }

  // --- a role outside the master-data set: assertMasterDataRole THROWS -----
  //
  // The difference CodeGraph flagged as observable: canManagePointKey's shape
  // is "the gate throws before it ever reaches a true/false answer" for a
  // role assertMasterDataRole refuses outright, and this must not collapse to
  // a plain `false` return.
  {
    const svc = serviceFor("viewer");
    const jwt = { sub: USER_ID, email: USER_EMAIL, name: "U1", role: "viewer" as const };
    await rejectsWith(
      () => svc.canManageNotificationChannel(jwt, OWN_ORG_ID),
      (e) => e instanceof ForbiddenException,
      "a viewer is refused master-data administration outright",
    );
  }
}
