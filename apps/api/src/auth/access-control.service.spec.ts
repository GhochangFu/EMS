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

const USER_ID = "u1";
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
