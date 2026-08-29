import { ForbiddenException } from "@nestjs/common";
import type pg from "pg";

import type { JwtPayload, UserRole } from "@bms/shared";

import type { AccessControlService } from "./access-control.service";

/**
 * `F4.10` — access-control assertions that only a real database can make.
 *
 * ADR 0017's write matrix is proven by `operations-write.spec.ts` over a pure
 * function, and `access-scope.spec.ts` proves which *sources* a role resolves
 * from. Neither executes a query. Everything below lives in the gap between
 * them: `scopeFromSource`'s four query branches, the precedence walk in
 * `scopeForUser`, and `resolveDbUser`'s choice of authority. Codegraph reports
 * no covering tests on `writableLocationIds` (5 callers), `canManageLocation`
 * (15 callers) or `scopeFromSource` — this file is that coverage.
 *
 * **Every expectation is computed with independent SQL through the pool**, not
 * read back from the service. Asserting a service against its own queries
 * proves only that it is self-consistent, which is exactly the property a
 * wrong `INNER JOIN` also has.
 *
 * Read-only by construction, with **one bounded exception since `F3.1b`**: the
 * fixtures are the ones `pnpm db:seed` creates, and nothing here inserts,
 * updates or deletes — except `assertCanManageDashboard`, which creates a
 * foreign asset group when the seed supplied none, and deletes that same row on
 * the way out. It never touches a seeded row. The exception exists because a
 * fresh seed gives the second organization locations but no asset groups, so
 * the refusal that block asserts had nothing foreign to be refused on the only
 * database that is actually clean — CI's.
 */

/** Emails seeded by `packages/db/src/seed.ts`, one per read-scope source. */
export const SEEDED = {
  globalAdmin: "admin@bms.local",
  organizationAdmin: "phe-admin@bms.local",
  locationAdmin: "wc-admin@bms.local",
  assetGroupAdmin: "wc-hvac-admin@bms.local",
} as const;

/**
 * Builds a token payload. `sub` is deliberately a value that matches no user
 * row, so `resolveDbUser` is forced down its email branch — the branch every
 * real OIDC token takes, since Keycloak's `sub` is not a `bms.users.id`.
 */
export const SYNTHETIC_SUB = "00000000-0000-4000-8000-000000000000";

export function jwtFor(email: string, role: UserRole): JwtPayload {
  return {
    sub: SYNTHETIC_SUB,
    email,
    name: `integration:${email}`,
    role,
  };
}

const ids = (rows: { id: string }[]): Set<string> => new Set(rows.map((r) => r.id));

/**
 * The ids of a live table that a concurrent suite cannot have moved under us
 * (`F4.53`).
 *
 * Takes the same `SELECT` run twice, around whatever is being asserted, and
 * keeps only what both saw. `bms.assets` and `bms.locations` are shared with
 * every other `apps/api` integration suite in the run, so a single read is a
 * snapshot of a set that is being both inserted into and deleted from. An id in
 * both reads was there at both ends, and these are `defaultRandom()` uuids that
 * are never reused, so the row existed for the whole interval between them.
 */
const stableIds = (
  before: { rows: { id: string }[] },
  after: { rows: { id: string }[] },
): string[] => {
  const stillPresent = ids(after.rows);
  return before.rows.map((r) => r.id).filter((id) => stillPresent.has(id));
};

/**
 * Asserts a call is refused *for the right reason*.
 *
 * A bare `catch {}` would score a dropped connection, a TypeError, or a
 * ReferenceError as "correctly denied" — the same green-because-it-found-nothing
 * shape this file exists to rule out. Only `ForbiddenException` counts.
 */
async function expectForbidden(run: () => Promise<unknown>, what: string): Promise<void> {
  try {
    await run();
  } catch (err) {
    if (err instanceof ForbiddenException) {
      return;
    }
    throw new Error(
      `${what}: expected ForbiddenException, got ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`,
    );
  }
  throw new Error(`${what}: expected a denial, but the call succeeded`);
}

/**
 * Fails when the database is reachable but not seeded.
 *
 * Without this, every containment assertion below ("no ESKOM asset appears in
 * the PHE admin's scope") passes vacuously on an empty schema. A suite that is
 * green because it found nothing is the failure mode this repo keeps shipping:
 * an unjournaled migration, an unwrapped spec, a `.dockerignore` string check.
 */
export async function assertFixturesPresent(pool: pg.Pool): Promise<void> {
  const { rows } = await pool.query<{ email: string; role: string }>(
    `SELECT email, role FROM bms.users WHERE email = ANY($1)`,
    [Object.values(SEEDED)],
  );
  const byEmail = new Map(rows.map((r) => [r.email, r.role]));
  const expected: [string, UserRole][] = [
    [SEEDED.globalAdmin, "admin"],
    [SEEDED.organizationAdmin, "organization_admin"],
    [SEEDED.locationAdmin, "location_admin"],
    [SEEDED.assetGroupAdmin, "asset_group_admin"],
  ];
  const wrong = expected
    .filter(([email, role]) => byEmail.get(email) !== role)
    .map(([email, role]) => `${email} should be ${role}, is ${byEmail.get(email) ?? "absent"}`);
  if (wrong.length > 0) {
    throw new Error(
      `F4.10 fixtures missing — run 'pnpm db:seed'. Without these users every ` +
        `containment assertion in this file passes vacuously:\n- ${wrong.join("\n- ")}`,
    );
  }

  const { rows: counts } = await pool.query<{
    assets: string;
    groups: string;
    gatewayless: string;
    inactive_locations: string;
    sub_collision: string;
  }>(
    `SELECT (SELECT COUNT(*)::text FROM bms.assets) AS assets,
            (SELECT COUNT(*)::text FROM bms.asset_group_members) AS groups,
            (SELECT COUNT(*)::text FROM bms.assets WHERE rtu_id IS NULL) AS gatewayless,
            (SELECT COUNT(*)::text FROM bms.locations WHERE active = false) AS inactive_locations,
            (SELECT COUNT(*)::text FROM bms.users WHERE id = $1) AS sub_collision`,
    [SYNTHETIC_SUB],
  );
  const row2 = counts[0];
  const shortfalls: string[] = [];
  if (Number(row2?.assets ?? 0) === 0) shortfalls.push("bms.assets is empty");
  if (Number(row2?.groups ?? 0) === 0) shortfalls.push("bms.asset_group_members is empty");

  // These two states are what make the tripwires below mean anything, and the
  // rest of the seed produces neither: `assignEskomAssetRtus` wires every ESKOM
  // asset and the PHE seed wires every PHE one, and every operational location
  // is active. `seedAccessControlFixtures` adds one of each. Measured before it
  // existed: 147 assets / 0 gateway-less, 16 locations / 0 inactive — so the
  // "gateway-less assets stay visible" loop never executed a single iteration
  // and `WHERE active = true` was indistinguishable from no predicate.
  if (Number(row2?.gatewayless ?? 0) === 0) {
    shortfalls.push(
      "no asset has a null rtu_id, so the ADR 0018 visibility tripwire cannot execute",
    );
  }
  if (Number(row2?.inactive_locations ?? 0) === 0) {
    shortfalls.push(
      "no location is inactive, so `WHERE active = true` cannot be told apart from no filter",
    );
  }

  // `jwtFor` asserts in prose that SYNTHETIC_SUB matches no user row, and every
  // negative control in this file depends on it. Prove it rather than trust it:
  // a collision would silently resolve the wrong user everywhere at once.
  if (Number(row2?.sub_collision ?? 0) !== 0) {
    shortfalls.push(
      `a bms.users row carries ${SYNTHETIC_SUB}, the id this suite assumes matches nobody`,
    );
  }

  if (shortfalls.length > 0) {
    throw new Error(
      `F4.10 fixtures missing — run 'pnpm db:seed'. Without these, assertions below ` +
        `pass vacuously:\n- ${shortfalls.join("\n- ")}`,
    );
  }
}

/** `global`: every active location and every asset, with `kind: "global"`. */
export async function assertGlobalAdminScope(
  svc: AccessControlService,
  pool: pg.Pool,
): Promise<void> {
  // **Every expected set is bracketed: read once before the scope call and
  // once after, and only the ids present in BOTH are asserted (`F4.53`).**
  //
  // Nine `apps/api` integration suites commit assets and leave `rtu_id` NULL,
  // then delete them again in their own `afterAll`. Against that live table,
  // `scope` and any `SELECT` are two snapshots of a moving set, so an equal
  // count was a property of the schedule and not of the code.
  //
  // The first repair (2026-08-28) read every expected set BEFORE `scope` and
  // asserted `scope ⊇ expected`, on the argument that "a row committed after
  // this read can only ADD to `scope`, never remove from it". **That argument
  // was wrong, and it failed the same day in the mirror direction**: a foreign
  // suite's asset was committed, read into `expected` here, and DELETED by that
  // suite before `scope` was computed — so `expected` named a row `scope`
  // could not contain. Reading early fixes insertions and creates deletions.
  //
  // Bracketing fixes both, and the argument is about identity rather than
  // timing: an id in both reads was present at both ends, and `id` is a
  // `defaultRandom()` uuid that is never reused, so that row existed for the
  // whole interval — including the instant `scope` was computed. A row
  // inserted after the first read is not in it; a row deleted before the
  // second is not in it either. Neither can be asserted, and neither should be.
  //
  // **The count equality is still gone, and that is still the substantive
  // change.** Over-breadth is proven by the inactive-location check below, by
  // identity, which is exactly what that check's own comment already said.
  //
  // No `LIMIT` on any of these. An unordered `LIMIT` is `F4.53`'s own shape,
  // and it is what let the gateway-less read reach a foreign transient in the
  // first place. Each set is bounded by the seed; taking all of it costs
  // nothing.
  const readActiveLocations = () =>
    pool.query<{ id: string }>(`SELECT id FROM bms.locations WHERE active = true`);
  const readAssets = () => pool.query<{ id: string }>(`SELECT id FROM bms.assets`);
  // ADR 0018 made assets.rtu_id nullable. A gateway-less asset must still be
  // visible — the silent-invisibility shape that ADR closed in the admin list
  // would reappear here if any scope query joined through rtus.
  const readGatewayless = () =>
    pool.query<{ id: string }>(`SELECT id FROM bms.assets WHERE rtu_id IS NULL`);

  const locationsBefore = await readActiveLocations();
  const inactive = await pool.query<{ id: string; code: string }>(
    `SELECT id, code FROM bms.locations WHERE active = false`,
  );
  const assetsBefore = await readAssets();
  const gatewaylessBefore = await readGatewayless();

  const { scope } = await svc.currentUser(jwtFor(SEEDED.globalAdmin, "admin"));

  const expectedLocations = stableIds(locationsBefore, await readActiveLocations());
  const expectedAssets = stableIds(assetsBefore, await readAssets());
  const expectedGatewayless = stableIds(gatewaylessBefore, await readGatewayless());

  if (scope.kind !== "global") {
    throw new Error(`global admin scope kind: expected "global", got "${scope.kind}"`);
  }

  // An empty intersection would pass every loop below vacuously. It cannot
  // happen against a seeded database — and if it does, the diagnosis is the
  // seed, not the scope query.
  const empty = [
    expectedLocations.length === 0 ? "active locations" : undefined,
    expectedAssets.length === 0 ? "assets" : undefined,
    expectedGatewayless.length === 0 ? "gateway-less assets (ADR 0018)" : undefined,
  ].filter((label): label is string => label !== undefined);
  if (empty.length > 0) {
    throw new Error(
      `F4.10 global-scope fixtures missing — run 'pnpm db:seed'. No stable ` +
        `${empty.join(", ")}, so the assertions below pass vacuously.`,
    );
  }

  const visible = new Set(scope.assetIds);
  const visibleLocations = new Set(scope.locations.map((location) => location.id));

  for (const id of expectedLocations) {
    if (!visibleLocations.has(id)) {
      throw new Error(
        `active location ${id} is missing from the global admin's scope — ` +
          "a scope query is filtering where a global admin must see everything",
      );
    }
  }
  for (const id of expectedAssets) {
    if (!visible.has(id)) {
      throw new Error(
        `asset ${id} is missing from the global admin's scope — ` +
          "a scope query is filtering where a global admin must see everything",
      );
    }
  }

  // Subsumed by the loop above, and kept deliberately: it is the only assertion
  // that names ADR 0018 and `bms.rtus`, so a future weakening of the asset
  // check still fails here with the diagnosis attached rather than a bare id.
  for (const id of expectedGatewayless) {
    if (!visible.has(id)) {
      throw new Error(
        `asset ${id} has no gateway and is invisible to a global admin — ` +
          "a scope query is joining through bms.rtus (ADR 0018)",
      );
    }
  }

  // An inactive location must be absent by identity, not just by count. Counts
  // alone cannot tell "filtered correctly" from "filtered something else".
  for (const row of inactive.rows) {
    if (visibleLocations.has(row.id)) {
      throw new Error(
        `inactive location ${row.code} is in the global admin's scope — ` +
          "a scope query dropped its `active = true` filter",
      );
    }
  }
  if ((await svc.readableAssetIds(jwtFor(SEEDED.globalAdmin, "admin"))) !== null) {
    throw new Error("global admin readableAssetIds must be null (unrestricted), not a list");
  }
  if ((await svc.writableLocationIds(jwtFor(SEEDED.globalAdmin, "admin"))) !== null) {
    throw new Error("global admin writableLocationIds must be null (unrestricted), not a list");
  }
}

/** `organization`: locations of granted orgs only — and nothing from another org. */
export async function assertOrganizationScope(
  svc: AccessControlService,
  pool: pg.Pool,
): Promise<void> {
  const jwt = jwtFor(SEEDED.organizationAdmin, "organization_admin");
  const { scope } = await svc.currentUser(jwt);

  if (scope.kind !== "location") {
    throw new Error(`organization admin scope kind: expected "location", got "${scope.kind}"`);
  }

  const granted = await pool.query<{ id: string }>(
    `SELECT l.id FROM bms.locations l
       JOIN bms.user_organization_access uoa ON uoa.organization_id = l.organization_id
       JOIN bms.users u ON u.id = uoa.user_id
      WHERE u.email = $1 AND l.active = true`,
    [SEEDED.organizationAdmin],
  );
  if (granted.rowCount === 0) {
    throw new Error("organization admin has no granted locations — fixture is not exercising this branch");
  }

  const expected = ids(granted.rows);
  const actual = ids(scope.locations);
  if (actual.size !== expected.size) {
    throw new Error(
      `organization admin locations: expected ${expected.size}, got ${actual.size}`,
    );
  }
  for (const id of expected) {
    if (!actual.has(id)) throw new Error(`organization admin is missing granted location ${id}`);
  }

  // The negative half, and the one that matters: another organization's assets
  // must be absent. A scope that is merely "non-empty and plausible" is what a
  // broken predicate also produces.
  const foreign = await pool.query<{ id: string }>(
    `SELECT a.id FROM bms.assets a
      WHERE a.location_id NOT IN (
        SELECT l.id FROM bms.locations l
          JOIN bms.user_organization_access uoa ON uoa.organization_id = l.organization_id
          JOIN bms.users u ON u.id = uoa.user_id
         WHERE u.email = $1)`,
    [SEEDED.organizationAdmin],
  );
  if (foreign.rowCount === 0) {
    throw new Error(
      "no out-of-organization asset exists — this fixture cannot prove isolation, " +
        "so the assertion below would pass vacuously",
    );
  }
  const readable = new Set(scope.assetIds);
  const leaked = foreign.rows.filter((r) => readable.has(r.id));
  if (leaked.length > 0) {
    throw new Error(
      `organization admin can read ${leaked.length} asset(s) outside their organization, ` +
        `e.g. ${leaked[0]?.id} — cross-tenant read leak`,
    );
  }
}

/** `location`: explicit grants only, assets confined to them. */
export async function assertLocationScope(
  svc: AccessControlService,
  pool: pg.Pool,
): Promise<void> {
  const jwt = jwtFor(SEEDED.locationAdmin, "location_admin");
  const { scope } = await svc.currentUser(jwt);

  if (scope.kind !== "location") {
    throw new Error(`location admin scope kind: expected "location", got "${scope.kind}"`);
  }

  const granted = await pool.query<{ id: string }>(
    `SELECT l.id FROM bms.locations l
       JOIN bms.user_location_access ula ON ula.location_id = l.id
       JOIN bms.users u ON u.id = ula.user_id
      WHERE u.email = $1 AND l.active = true`,
    [SEEDED.locationAdmin],
  );
  if (granted.rowCount === 0) {
    throw new Error("location admin has no grants — fixture is not exercising this branch");
  }

  const expected = ids(granted.rows);
  const actual = ids(scope.locations);
  for (const id of actual) {
    if (!expected.has(id)) {
      throw new Error(
        `location admin sees location ${id} with no user_location_access row — ` +
          "scope is wider than the grants that produced it",
      );
    }
  }
  if (actual.size !== expected.size) {
    throw new Error(`location admin locations: expected ${expected.size}, got ${actual.size}`);
  }

  const outside = await pool.query<{ id: string }>(
    `SELECT id FROM bms.assets WHERE location_id <> ALL($1)`,
    [[...expected]],
  );
  if (outside.rowCount === 0) {
    throw new Error("every asset is inside the grant — isolation cannot be proven here");
  }
  const readable = new Set(scope.assetIds);
  const leaked = outside.rows.filter((r) => readable.has(r.id));
  if (leaked.length > 0) {
    throw new Error(
      `location admin can read ${leaked.length} asset(s) outside their granted locations, ` +
        `e.g. ${leaked[0]?.id}`,
    );
  }

  // Per-asset check must agree with the bulk list. They are separate code paths
  // (`canReadAsset` vs `readableAssetIds`) and either can drift.
  const stranger = outside.rows[0];
  if (stranger && (await svc.canReadAsset(jwt, stranger.id))) {
    throw new Error(
      `canReadAsset allowed asset ${stranger.id} that readableAssetIds excluded — ` +
        "the two authorization paths disagree",
    );
  }
}

/** `asset_group`: membership only — strictly narrower than the group's location. */
export async function assertAssetGroupScope(
  svc: AccessControlService,
  pool: pg.Pool,
): Promise<void> {
  const jwt = jwtFor(SEEDED.assetGroupAdmin, "asset_group_admin");
  const { scope } = await svc.currentUser(jwt);

  if (scope.kind !== "asset_group") {
    throw new Error(`asset group admin scope kind: expected "asset_group", got "${scope.kind}"`);
  }
  if (scope.assetGroups.length === 0) {
    throw new Error("asset group admin has no groups — fixture is not exercising this branch");
  }

  const members = await pool.query<{ id: string }>(
    `SELECT agm.asset_id AS id FROM bms.asset_group_members agm
       JOIN bms.user_asset_group_access uaga ON uaga.asset_group_id = agm.asset_group_id
       JOIN bms.users u ON u.id = uaga.user_id
      WHERE u.email = $1`,
    [SEEDED.assetGroupAdmin],
  );
  const expected = ids(members.rows);
  if (expected.size === 0) {
    throw new Error(
      "the granted asset group has no members — every comparison below would be " +
        "0 === 0 and this branch would pass while proving nothing",
    );
  }
  const actual = new Set(scope.assetIds);
  for (const id of actual) {
    if (!expected.has(id)) {
      throw new Error(`asset group admin sees asset ${id} that is in none of their groups`);
    }
  }
  if (actual.size !== expected.size) {
    throw new Error(`asset group admin assets: expected ${expected.size}, got ${actual.size}`);
  }

  // The point of the group axis is that it is *narrower* than the location.
  // If a group happens to contain every asset in its location the two branches
  // are indistinguishable, and this test proves nothing about the difference.
  const inLocation = await pool.query<{ id: string }>(
    `SELECT a.id FROM bms.assets a WHERE a.location_id IN (
       SELECT ag.location_id FROM bms.asset_groups ag
         JOIN bms.user_asset_group_access uaga ON uaga.asset_group_id = ag.id
         JOIN bms.users u ON u.id = uaga.user_id
        WHERE u.email = $1)`,
    [SEEDED.assetGroupAdmin],
  );
  if (inLocation.rowCount === expected.size) {
    throw new Error(
      "the granted group contains every asset in its location, so group scope is " +
        "indistinguishable from location scope — this fixture cannot prove narrowing",
    );
  }
  const siblings = inLocation.rows.filter((r) => !expected.has(r.id));
  const leaked = siblings.filter((r) => actual.has(r.id));
  if (leaked.length > 0) {
    throw new Error(
      `asset group admin can read ${leaked.length} same-location asset(s) outside their group`,
    );
  }
}

/**
 * The keystone of ADR 0017: for a user that exists in `bms.users`, the role on
 * that row is the authority and the token claim is ignored.
 *
 * The qualifier is load-bearing. `resolveDbUser` deliberately falls back to the
 * claim when no row matches, and `assertUngrantedRolesFailClosed` below depends
 * on exactly that fallback. Both halves are real; only the first is a security
 * boundary.
 *
 * A token outlives a demotion by up to `JWT_TTL`, and in OIDC mode
 * `roleFromClaims` falls back to `viewer` when realm roles are missing. Reading
 * the claim would make the gate fail-open on demotion. No pure-function test
 * can see this — both roles are valid inputs to `canPerformOperationsWrite`;
 * only a database says which one is real.
 */
export async function assertDbRoleBeatsJwtClaim(svc: AccessControlService): Promise<void> {
  // A location admin presenting a token that claims global admin.
  const lying = jwtFor(SEEDED.locationAdmin, "admin");

  const { user, scope } = await svc.currentUser(lying);
  if (user.role !== "location_admin") {
    throw new Error(
      `currentUser trusted the JWT claim: reported "${user.role}" for a location_admin row`,
    );
  }
  if (scope.kind === "global") {
    throw new Error(
      "a forged admin claim produced a global scope — read scope is resolved from the claim",
    );
  }

  const writable = await svc.writableLocationIds(lying);
  if (writable === null) {
    throw new Error(
      "writableLocationIds returned the unrestricted sentinel for a location_admin " +
        "presenting a forged admin claim — privilege escalation by token claim",
    );
  }
  if ((await svc.readableAssetIds(lying)) === null) {
    throw new Error("readableAssetIds returned unrestricted for a forged admin claim");
  }

  // And the reverse polarity: a real admin whose token under-claims must not be
  // demoted, or an OIDC token missing realm roles locks out a genuine admin.
  const underclaiming = jwtFor(SEEDED.globalAdmin, "viewer");
  const restored = await svc.currentUser(underclaiming);
  if (restored.user.role !== "admin") {
    throw new Error(
      `a real admin presenting a viewer claim resolved to "${restored.user.role}" — ` +
        "an OIDC token without realm roles would lock out a genuine admin",
    );
  }
  await svc.assertOperationsWriteRole(underclaiming, "configuration");
}

/**
 * Pins what happens when the token names a user this database has never heard
 * of — **ADR 0044's decision, not the pre-0044 behaviour this test used to
 * pin.**
 *
 * `resolveDbUser` still falls back to the claim when neither `sub` nor
 * `email` matches, for every role except `admin`. That fallback is
 * load-bearing for a real reason: it is what lets the operator/viewer
 * fail-closed checks above run without seeding those roles, and what lets a
 * freshly federated OIDC principal reach the app — with a correctly empty
 * scope — before a local row exists.
 *
 * An `admin` claim for an unprovisioned email is different: `writableXIds`
 * returns the unrestricted `null` sentinel only inside the `admin` branch, so
 * that one claim alone turned "no row" into "everything" — meaning deleting a
 * `bms.users` row did not revoke a token, it *restored* whatever role the
 * token claimed, until `JWT_TTL` expires (default 8h). Not client-forgeable:
 * the guard verifies RS256, issuer and audience, and local mode signs the DB
 * role. Still, "deprovision by deleting the row" is the obvious admin action
 * and it did the opposite of what it looks like. ADR 0044 closes exactly this
 * one branch and leaves every other role's fallback untouched — see that ADR
 * for why a blanket refusal was rejected.
 */
export async function assertUnprovisionedTokenBehaviour(
  svc: AccessControlService,
): Promise<void> {
  const ghost = jwtFor("deprovisioned-admin@integration.invalid", "admin");
  await expectForbidden(
    () => svc.currentUser(ghost),
    "an unprovisioned admin token must be refused (ADR 0044), not resolved to a global scope",
  );

  // The non-admin half of the same fallback must still work — ADR 0044 closes
  // only the admin branch, on purpose.
  const nonAdminGhost = jwtFor("unprovisioned-viewer@integration.invalid", "viewer");
  const { user, scope } = await svc.currentUser(nonAdminGhost);
  if (user.role !== "viewer" || scope.kind !== "none") {
    throw new Error(
      `an unprovisioned viewer token: expected role "viewer" and scope "none", got role ` +
        `"${user.role}" and scope "${scope.kind}" — ADR 0044 did not intend to touch this path`,
    );
  }
}

/**
 * `operator`/`viewer` walk four sources and must land on `none` with no grants.
 *
 * `access-scope.spec.ts` proves the *list* is four long. Only a database proves
 * the walk actually terminates fail-closed instead of returning the first
 * source's empty-but-permissive scope.
 */
export async function assertUngrantedRolesFailClosed(
  svc: AccessControlService,
): Promise<void> {
  for (const role of ["operator", "viewer"] as const) {
    // An email with no bms.users row: resolveDbUser falls back to the claim, so
    // the role is honoured while every grant lookup returns nothing.
    const jwt = jwtFor(`no-grants-${role}@integration.invalid`, role);
    const { scope } = await svc.currentUser(jwt);
    if (scope.kind !== "none") {
      throw new Error(
        `ungranted ${role} resolved to scope kind "${scope.kind}", expected "none" — ` +
          "the precedence walk is not falling through to the fail-closed source",
      );
    }
    if (scope.assetIds.length > 0 || scope.locations.length > 0) {
      throw new Error(`ungranted ${role} received a non-empty scope`);
    }

    const readable = await svc.readableAssetIds(jwt);
    if (readable === null) {
      throw new Error(`ungranted ${role} received the unrestricted sentinel`);
    }
  }

  // ADR 0017's gate, resolved through the same path the controllers use.
  const viewer = jwtFor("no-grants-viewer@integration.invalid", "viewer");
  for (const writeClass of ["configuration", "operational"] as const) {
    await expectForbidden(
      () => svc.assertOperationsWriteRole(viewer, writeClass),
      `viewer performing an ${writeClass} write (ADR 0017)`,
    );
  }

  const operator = jwtFor("no-grants-operator@integration.invalid", "operator");
  await expectForbidden(
    () => svc.assertOperationsWriteRole(operator, "configuration"),
    "operator performing a configuration write (ADR 0017)",
  );
  // …but keeps today's work.
  await svc.assertOperationsWriteRole(operator, "operational");
}

/**
 * Location management is **flat today**, and this pins that fact deliberately.
 *
 * ADR 0018 recorded the decision that a grant on a parent location *does* imply
 * its descendants, to be implemented by the companion location-depth ADR. That
 * change turns `writableLocationIds` from a direct `user_location_access`
 * lookup into a transitive closure, silently widening all 15 `canManageLocation`
 * callers. ADR 0018's own words: "it silently widens access, which is the
 * failure mode that will not announce itself."
 *
 * So this assertion is the announcement. When the companion ADR lands it will
 * fail, and whoever is holding it must then prove the widening is exactly the
 * intended subtree and nothing more. Do not relax it to make depth compile.
 */
export async function assertLocationManagementIsFlat(
  svc: AccessControlService,
  pool: pg.Pool,
): Promise<void> {
  const jwt = jwtFor(SEEDED.locationAdmin, "location_admin");

  const granted = await pool.query<{ id: string }>(
    `SELECT l.id FROM bms.locations l
       JOIN bms.user_location_access ula ON ula.location_id = l.id
       JOIN bms.users u ON u.id = ula.user_id
      WHERE u.email = $1`,
    [SEEDED.locationAdmin],
  );
  const expected = ids(granted.rows);
  if (expected.size === 0) {
    throw new Error(
      "location admin has no grants — the size comparison below would be 0 === 0 " +
        "and this tripwire would pass while proving nothing",
    );
  }
  const writable = await svc.writableLocationIds(jwt);
  if (writable === null) {
    throw new Error("location admin writableLocationIds must be a list, not unrestricted");
  }

  const actual = new Set(writable);
  if (actual.size !== expected.size) {
    throw new Error(
      `writableLocationIds returned ${actual.size} location(s) for ${expected.size} grant row(s). ` +
        "If the companion location-depth ADR just landed this is the expected subtree widening — " +
        "re-point this assertion at the intended closure and prove it stops there. " +
        "Otherwise it is an unintended scope widening.",
    );
  }
  for (const id of expected) {
    if (!actual.has(id)) throw new Error(`writableLocationIds dropped granted location ${id}`);
  }

  // Every ungranted location must be refused, one at a time — `canManageLocation`
  // is what 15 call sites actually invoke, and it can drift from the bulk list.
  const ungranted = await pool.query<{ id: string }>(
    `SELECT id FROM bms.locations WHERE id <> ALL($1) LIMIT 10`,
    [[...expected]],
  );
  if (ungranted.rowCount === 0) {
    throw new Error("no ungranted location exists — denial cannot be proven");
  }
  for (const row of ungranted.rows) {
    if (await svc.canManageLocation(jwt, row.id)) {
      throw new Error(
        `canManageLocation allowed ungranted location ${row.id}. No location has a parent ` +
          "today, so no subtree rule can justify this — it is a scope leak.",
      );
    }
  }
  for (const id of expected) {
    if (!(await svc.canManageLocation(jwt, id))) {
      throw new Error(`canManageLocation refused granted location ${id}`);
    }
  }
}

/**
 * `canManageAsset` resolves through `assets.location_id`, which ADR 0018 made
 * `NOT NULL`. Its `!row?.locationId` branch is now unreachable for real rows —
 * a missing asset must still fail closed rather than throwing.
 */
export async function assertAssetManagementFollowsLocation(
  svc: AccessControlService,
  pool: pg.Pool,
): Promise<void> {
  const jwt = jwtFor(SEEDED.locationAdmin, "location_admin");

  const inScope = await pool.query<{ id: string }>(
    `SELECT a.id FROM bms.assets a
       JOIN bms.user_location_access ula ON ula.location_id = a.location_id
       JOIN bms.users u ON u.id = ula.user_id
      WHERE u.email = $1 LIMIT 1`,
    [SEEDED.locationAdmin],
  );
  const outOfScope = await pool.query<{ id: string }>(
    `SELECT a.id FROM bms.assets a WHERE a.location_id NOT IN (
       SELECT ula.location_id FROM bms.user_location_access ula
         JOIN bms.users u ON u.id = ula.user_id WHERE u.email = $1) LIMIT 1`,
    [SEEDED.locationAdmin],
  );
  const owned = inScope.rows[0];
  const foreign = outOfScope.rows[0];
  if (!owned || !foreign) {
    throw new Error("need one in-scope and one out-of-scope asset to prove canManageAsset");
  }

  if (!(await svc.canManageAsset(jwt, owned.id))) {
    throw new Error(`canManageAsset refused in-scope asset ${owned.id}`);
  }
  if (await svc.canManageAsset(jwt, foreign.id)) {
    throw new Error(`canManageAsset allowed out-of-scope asset ${foreign.id}`);
  }
  // Unknown id: no row, so no location — must be denied, not thrown.
  if (await svc.canManageAsset(jwt, "00000000-0000-4000-8000-0000000000ff")) {
    throw new Error("canManageAsset allowed a non-existent asset");
  }
}

/**
 * `F3.1b` — `canManageDashboard` (ADR 0047 Amendment 2 ruling 2).
 *
 * Every case below is asserted against a REAL organization/location/group
 * the seed produced, never an invented uuid — a fabricated id would pass
 * every "false" assertion vacuously regardless of whether the method reads
 * the database at all.
 */
export async function assertCanManageDashboard(
  svc: AccessControlService,
  pool: pg.Pool,
): Promise<void> {
  const orgAdminOrg = await pool.query<{ id: string }>(
    `SELECT uoa.organization_id AS id
       FROM bms.user_organization_access uoa
       JOIN bms.users u ON u.id = uoa.user_id
      WHERE u.email = $1 LIMIT 1`,
    [SEEDED.organizationAdmin],
  );
  const orgAId = orgAdminOrg.rows[0]?.id;
  if (!orgAId) {
    throw new Error(`F3.1b: ${SEEDED.organizationAdmin} has no organization grant`);
  }
  const foreignOrg = await pool.query<{ id: string }>(
    `SELECT id FROM bms.organizations WHERE id <> $1 LIMIT 1`,
    [orgAId],
  );
  const orgBId = foreignOrg.rows[0]?.id;
  if (!orgBId) {
    throw new Error("F3.1b: need a second organization to prove organization_admin is refused");
  }

  const locationAdminLocation = await pool.query<{ id: string; organization_id: string }>(
    `SELECT l.id, l.organization_id
       FROM bms.locations l
       JOIN bms.user_location_access ula ON ula.location_id = l.id
       JOIN bms.users u ON u.id = ula.user_id
      WHERE u.email = $1 LIMIT 1`,
    [SEEDED.locationAdmin],
  );
  const locId = locationAdminLocation.rows[0]?.id;
  const locOrgId = locationAdminLocation.rows[0]?.organization_id;
  if (!locId || !locOrgId) {
    throw new Error(`F3.1b: ${SEEDED.locationAdmin} has no location grant`);
  }
  // Dedicated, relative to locOrgId — NOT orgBId (that is "not orgAId", and with exactly two
  // seeded organizations it can coincide with locOrgId itself, which silently turns finding
  // 4's regression test into a no-op assertion about the location_admin's own organization).
  const locForeignOrg = await pool.query<{ id: string }>(
    `SELECT id FROM bms.organizations WHERE id <> $1 LIMIT 1`,
    [locOrgId],
  );
  const locForeignOrgId = locForeignOrg.rows[0]?.id;
  if (!locForeignOrgId) {
    throw new Error("F3.1b: need a second organization to prove the location's own org does not authorize a foreign org's dashboard");
  }

  const groupAdminGroup = await pool.query<{ id: string; location_id: string; organization_id: string }>(
    `SELECT ag.id, ag.location_id, ag.organization_id
       FROM bms.asset_groups ag
       JOIN bms.user_asset_group_access uaga ON uaga.asset_group_id = ag.id
       JOIN bms.users u ON u.id = uaga.user_id
      WHERE u.email = $1 LIMIT 1`,
    [SEEDED.assetGroupAdmin],
  );
  const groupId = groupAdminGroup.rows[0]?.id;
  const groupOrgId = groupAdminGroup.rows[0]?.organization_id;
  if (!groupId || !groupOrgId) {
    throw new Error(`F3.1b: ${SEEDED.assetGroupAdmin} has no asset-group grant`);
  }
  const foreignGroup = await pool.query<{ id: string }>(
    `SELECT id FROM bms.asset_groups WHERE id <> $1 AND organization_id <> $2 LIMIT 1`,
    [groupId, groupOrgId],
  );
  let foreignGroupId = foreignGroup.rows[0]?.id;
  /** Set only when the seed supplied no foreign asset group and this function made one. */
  let createdForeignGroupId: string | undefined;
  if (!foreignGroupId) {
    // **A fresh `pnpm db:seed` gives the second organization locations but no asset groups.**
    // This threw "run pnpm db:seed" until CI proved the advice wrong: a developer database
    // accumulates them from the pilot seed and from other suites' fixtures, so the requirement
    // held on every machine and failed on the only database that is actually clean. Without
    // this the refusal below has nothing foreign to be refused, which is the assertion the
    // whole block exists for.
    const foreignLocation = await pool.query<{ id: string; organization_id: string }>(
      `SELECT id, organization_id FROM bms.locations WHERE organization_id <> $1 ORDER BY created_at, id LIMIT 1`,
      [groupOrgId],
    );
    const foreignLocationId = foreignLocation.rows[0]?.id;
    const foreignLocationOrgId = foreignLocation.rows[0]?.organization_id;
    if (!foreignLocationId || !foreignLocationOrgId) {
      throw new Error("F3.1b: need a location in a second organization to build a foreign asset group");
    }
    const created = await pool.query<{ id: string }>(
      `INSERT INTO bms.asset_groups (organization_id, location_id, code, name)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [foreignLocationOrgId, foreignLocationId, `f31b-foreign-${Date.now()}`, "F3.1b foreign group"],
    );
    foreignGroupId = created.rows[0]?.id;
    createdForeignGroupId = foreignGroupId;
  }
  if (!foreignGroupId) {
    throw new Error("F3.1b: could not read or create a foreign asset group");
  }
  const groupForeignOrg = await pool.query<{ id: string }>(
    `SELECT id FROM bms.organizations WHERE id <> $1 LIMIT 1`,
    [groupOrgId],
  );
  const groupForeignOrgId = groupForeignOrg.rows[0]?.id;
  if (!groupForeignOrgId) {
    throw new Error("F3.1b: need a second organization to prove the group's own org does not authorize a foreign org's dashboard");
  }

  const orgWide = { locationId: null, assetGroupId: null };

  // admin: true for every organization and scope, including organization-wide.
  const admin = jwtFor(SEEDED.globalAdmin, "admin");
  if (!(await svc.canManageDashboard(admin, orgAId, orgWide))) {
    throw new Error("admin must manage an organization-wide dashboard");
  }
  if (!(await svc.canManageDashboard(admin, orgBId, { locationId: locId, assetGroupId: null }))) {
    throw new Error("admin must manage a location-scoped dashboard in any organization");
  }

  // organization_admin: true for its own organization, false — refused, not
  // merely absent — for another's.
  const orgAdmin = jwtFor(SEEDED.organizationAdmin, "organization_admin");
  if (!(await svc.canManageDashboard(orgAdmin, orgAId, orgWide))) {
    throw new Error("organization_admin must manage an organization-wide dashboard in its own org");
  }
  if (await svc.canManageDashboard(orgAdmin, orgBId, orgWide)) {
    throw new Error("organization_admin must be refused another organization's dashboard");
  }

  // location_admin: true for a dashboard scoped to a location it holds.
  const locationAdmin = jwtFor(SEEDED.locationAdmin, "location_admin");
  if (!(await svc.canManageDashboard(locationAdmin, locOrgId, { locationId: locId, assetGroupId: null }))) {
    throw new Error("location_admin must manage a dashboard scoped to its own location");
  }
  // FALSE for an organization-wide dashboard in its OWN organization — the
  // carrier of ADR 0047 Amendment 2 ruling 2, and the assertion a refactor is
  // most likely to lose (every other location_admin assertion here is about a
  // foreign organization, not its own).
  if (await svc.canManageDashboard(locationAdmin, locOrgId, orgWide)) {
    throw new Error(
      "location_admin must be refused an organization-wide dashboard even in its own organization " +
        "— such a row has no scope column and therefore no owner",
    );
  }
  // Finding 4 (review): the location it holds authorizing a FOREIGN organization's dashboard.
  // canManageLocation alone answers "may this user manage this location", never "does this
  // location belong to organizationId" — without that second check an ORG_A location_admin's
  // own locationId passed authorization for an ORG_B dashboard, contained only later by the
  // database rather than by this gate.
  if (
    await svc.canManageDashboard(locationAdmin, locForeignOrgId, { locationId: locId, assetGroupId: null })
  ) {
    throw new Error(
      "location_admin's own location must NOT authorize a dashboard stamped with ANOTHER " +
        "organization's id — the location belongs to its own org, not locForeignOrgId",
    );
  }

  // asset_group_admin: true for a group whose location it holds, false otherwise.
  const groupAdmin = jwtFor(SEEDED.assetGroupAdmin, "asset_group_admin");
  if (!(await svc.canManageDashboard(groupAdmin, groupOrgId, { locationId: null, assetGroupId: groupId }))) {
    throw new Error("asset_group_admin must manage a dashboard scoped to its own group");
  }
  if (
    await svc.canManageDashboard(groupAdmin, groupOrgId, { locationId: null, assetGroupId: foreignGroupId })
  ) {
    throw new Error("asset_group_admin must be refused a dashboard scoped to a foreign group");
  }
  if (await svc.canManageDashboard(groupAdmin, groupOrgId, orgWide)) {
    throw new Error("asset_group_admin must be refused an organization-wide dashboard");
  }
  // Finding 4 (review): the group it holds authorizing a FOREIGN organization's dashboard —
  // the asset-group analogue of the location_admin case above.
  if (
    await svc.canManageDashboard(groupAdmin, groupForeignOrgId, { locationId: null, assetGroupId: groupId })
  ) {
    throw new Error(
      "asset_group_admin's own group must NOT authorize a dashboard stamped with ANOTHER " +
        "organization's id — the group belongs to its own org, not groupForeignOrgId",
    );
  }

  // viewer / operator: false, always — not thrown. An unprovisioned email so
  // resolveDbUser falls back to the claim (ADR 0017/0044) rather than
  // resolving a seeded admin/org-admin row that would make this vacuous.
  for (const role of ["viewer", "operator"] as const) {
    const jwt = jwtFor(`f3.1b-no-grants-${role}@integration.invalid`, role);
    if (await svc.canManageDashboard(jwt, orgAId, { locationId: locId, assetGroupId: null })) {
      throw new Error(`${role} must be refused canManageDashboard on any scope`);
    }
    if (await svc.canManageDashboard(jwt, orgAId, orgWide)) {
      throw new Error(`${role} must be refused an organization-wide dashboard`);
    }
  }

  // Only the group this function created, and only on the way out — a seeded row is never
  // deleted here. Deliberately after the assertions rather than in a `finally`: a failing
  // assertion should leave the fixture in place to be inspected, and the next run's
  // `code` carries a fresh timestamp, so a leftover cannot collide.
  if (createdForeignGroupId) {
    await pool.query(`DELETE FROM bms.asset_groups WHERE id = $1`, [createdForeignGroupId]);
  }
}
