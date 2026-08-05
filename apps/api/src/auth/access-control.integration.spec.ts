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
 * Read-only by construction: no fixture is inserted, updated or deleted, so the
 * suite is safe against the shared local database and needs no teardown. The
 * fixtures are the ones `pnpm db:seed` creates.
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
export function jwtFor(email: string, role: UserRole): JwtPayload {
  return {
    sub: "00000000-0000-4000-8000-000000000000",
    email,
    name: `integration:${email}`,
    role,
  };
}

const ids = (rows: { id: string }[]): Set<string> => new Set(rows.map((r) => r.id));

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

  const { rows: counts } = await pool.query<{ assets: string; groups: string }>(
    `SELECT (SELECT COUNT(*)::text FROM bms.assets) AS assets,
            (SELECT COUNT(*)::text FROM bms.asset_group_members) AS groups`,
  );
  if (Number(counts[0]?.assets ?? 0) === 0 || Number(counts[0]?.groups ?? 0) === 0) {
    throw new Error(
      "F4.10 fixtures missing — bms.assets or bms.asset_group_members is empty, " +
        "so scope containment cannot be distinguished from scope emptiness.",
    );
  }
}

/** `global`: every active location and every asset, with `kind: "global"`. */
export async function assertGlobalAdminScope(
  svc: AccessControlService,
  pool: pg.Pool,
): Promise<void> {
  const { scope } = await svc.currentUser(jwtFor(SEEDED.globalAdmin, "admin"));

  if (scope.kind !== "global") {
    throw new Error(`global admin scope kind: expected "global", got "${scope.kind}"`);
  }

  const expectedLocations = await pool.query<{ id: string }>(
    `SELECT id FROM bms.locations WHERE active = true`,
  );
  const expectedAssets = await pool.query<{ id: string }>(`SELECT id FROM bms.assets`);

  if (scope.locations.length !== expectedLocations.rowCount) {
    throw new Error(
      `global admin locations: expected ${expectedLocations.rowCount}, got ${scope.locations.length}`,
    );
  }
  if (scope.assetIds.length !== expectedAssets.rowCount) {
    throw new Error(
      `global admin assets: expected ${expectedAssets.rowCount}, got ${scope.assetIds.length}`,
    );
  }

  // ADR 0018 made assets.rtu_id nullable. A gateway-less asset must still be
  // visible — the silent-invisibility shape that ADR closed in the admin list
  // would reappear here if any scope query joined through rtus.
  const gatewayless = await pool.query<{ id: string }>(
    `SELECT id FROM bms.assets WHERE rtu_id IS NULL LIMIT 5`,
  );
  const visible = new Set(scope.assetIds);
  for (const row of gatewayless.rows) {
    if (!visible.has(row.id)) {
      throw new Error(
        `asset ${row.id} has no gateway and is invisible to a global admin — ` +
          "a scope query is joining through bms.rtus (ADR 0018)",
      );
    }
  }

  // `null` is the unrestricted sentinel; a materialised list would silently
  // become a ceiling the moment a new location is created.
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
 * The keystone of ADR 0017: authority is `bms.users.role`, never the claim.
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
    let denied = false;
    try {
      await svc.assertOperationsWriteRole(viewer, writeClass);
    } catch {
      denied = true;
    }
    if (!denied) throw new Error(`viewer was allowed an ${writeClass} write (ADR 0017)`);
  }

  const operator = jwtFor("no-grants-operator@integration.invalid", "operator");
  let configDenied = false;
  try {
    await svc.assertOperationsWriteRole(operator, "configuration");
  } catch {
    configDenied = true;
  }
  if (!configDenied) throw new Error("operator was allowed a configuration write (ADR 0017)");
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
