import { sql } from "drizzle-orm";
import type pg from "pg";

import type { BmsDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import type { AccessControlService } from "./access-control.service";
import {
  expandLocationSubtrees,
  LOCATION_TREE_MAX_DEPTH,
  locationAncestors,
  locationDepthAndHeight,
} from "./location-tree";
import { jwtFor, rememberSubject } from "../testing/seeded-subjects";
import { withRollback } from "../testing/with-rollback";

/**
 * `F2.10` / ADR 0098 decision 4 and *Security* 1–3 — the exact-closure
 * tripwire that replaces `assertLocationManagementIsFlat`.
 *
 * ADR 0018 recorded that a grant on a parent location implies its
 * descendants, and warned that the change "silently widens access, which is
 * the failure mode that will not announce itself." The flat tripwire was the
 * announcement; this file is the proof it demanded: the widening is exactly
 * the granted subtree and nothing more, on every surface that answers from
 * `writableLocationIds`, `scopeFromSource` and `reportFileReadScope`.
 *
 * **Fixtures.** One superuser pool with `max: 1`, so every query — the
 * fixture writes, the service's own reads, the raw checks — runs on one
 * connection inside one transaction that `afterAll` rolls back. Two **new**
 * organizations (`F210-A`, `F210-B`) are created in that transaction: the
 * tree-guard trigger takes a transaction advisory lock on
 * `locations_tree:<organization_id>`, and holding a seeded organization's
 * key for the whole suite would block every sibling suite that writes a
 * child there. The trees:
 *
 *     F210-A:  R ── A ── A1 ── A1a        F210-B:  X ── X1
 *               └── B ── B1
 *
 * One asset per node. `grantee` (location_admin) holds A; `grantee2` holds
 * B; `groupAdmin` (asset_group_admin) holds a group on A1; `foreignOrgAdmin`
 * (organization_admin) holds a direct row for F210-B only.
 *
 * Assertions 4 and 5 run on separate `bms_tenant` / `bms_fleet` pools inside
 * `withRollback`: the composite foreign key and the trigger are proved with
 * no service and no privileged role in front of them. Assertion 6 plants an
 * edge the foreign key forbids by switching `session_replication_role` to
 * `replica` on the superuser connection, which is why that pool is the
 * superuser's.
 *
 * Every expectation is computed from the ids the fixture inserted, never read
 * back from the service.
 */

type Node = "R" | "A" | "A1" | "A1a" | "B" | "B1" | "X" | "X1";

export type TreeFixture = {
  readonly orgA: string;
  readonly orgB: string;
  readonly nodes: Readonly<Record<Node, string>>;
  readonly assets: Readonly<Record<Node, string>>;
  readonly grantee: JwtPayload;
  readonly grantee2: JwtPayload;
  readonly groupAdmin: JwtPayload;
  readonly foreignOrgAdmin: JwtPayload;
};

/** A raw `pg` handle — the pool, or a checked-out client — with the one method the fixture uses. */
type Pg = {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values?: unknown[]): Promise<pg.QueryResult<R>>;
};
/** The tree helpers take a drizzle `execute`; the wrapper builds one over the same single-connection pool. */
type Executor = Pick<BmsDb, "execute">;

const setOf = (ids: Iterable<string>): Set<string> => new Set(ids);
const sameSet = (a: Set<string>, b: Set<string>): boolean =>
  a.size === b.size && [...a].every((id) => b.has(id));
const show = (ids: Iterable<string>): string => JSON.stringify([...ids].sort());

function fail(message: string): never {
  throw new Error(message);
}

type PgFailure = { code: string | undefined; constraint: string | undefined; message: string };

/** The SQLSTATE, constraint and message of a thrown `pg` error, read through a wrapper's `cause` too. */
export function pgFailure(err: unknown): PgFailure {
  const direct = err as { code?: unknown; constraint?: unknown; cause?: unknown } | null;
  const source =
    typeof direct?.code === "string"
      ? direct
      : (direct?.cause as { code?: unknown; constraint?: unknown } | undefined) ?? direct;
  return {
    code: typeof source?.code === "string" ? source.code : undefined,
    constraint: typeof source?.constraint === "string" ? source.constraint : undefined,
    message: err instanceof Error ? err.message : String(err),
  };
}

async function caught(run: () => Promise<unknown>): Promise<PgFailure | undefined> {
  try {
    await run();
    return undefined;
  } catch (err) {
    return pgFailure(err);
  }
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

async function insertOrganization(db: Pg, code: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO bms.organizations (code, name, currency) VALUES ($1, $2, 'INR') RETURNING id`,
    [code, `F2.10 ${code}`],
  );
  return rows[0]?.id ?? fail(`organization ${code} was not inserted`);
}

/** A location insert. Exported so the `bms_fleet` chain (assertion 5) uses the one shape. */
export async function insertLocation(
  db: Pg | Executor,
  input: { organizationId: string; code: string; parentId: string | null; active?: boolean },
): Promise<string> {
  const active = input.active ?? true;
  if (!("execute" in db)) {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO bms.locations
         (organization_id, code, slug, name, type, latitude, longitude, parent_id, active)
       VALUES ($1, $2, $3, $4, 'smoc_campus', 0, 0, $5, $6)
       RETURNING id`,
      [input.organizationId, input.code, input.code.toLowerCase(), `F2.10 ${input.code}`, input.parentId, active],
    );
    return rows[0]?.id ?? fail(`location ${input.code} was not inserted`);
  }
  const result = await db.execute<{ id: string }>(sql`
    INSERT INTO bms.locations
      (organization_id, code, slug, name, type, latitude, longitude, parent_id, active)
    VALUES (${input.organizationId}, ${input.code}, ${input.code.toLowerCase()}, ${`F2.10 ${input.code}`},
            'smoc_campus', 0, 0, ${input.parentId}, ${active})
    RETURNING id`);
  return result.rows[0]?.id ?? fail(`location ${input.code} was not inserted`);
}

async function insertUser(db: Pg, organizationId: string, email: string, role: JwtPayload["role"]): Promise<JwtPayload> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO bms.users (organization_id, email, password_hash, display_name, role)
     VALUES ($1, $2, 'not-a-usable-hash', $3, $4) RETURNING id`,
    [organizationId, email, `F2.10 ${role}`, role],
  );
  const id = rows[0]?.id ?? fail(`user ${email} was not inserted`);
  rememberSubject(email, id);
  return jwtFor(email, role);
}

/**
 * Builds the two organizations, the trees, the assets, the users and their
 * grants inside the caller's open transaction on `db`.
 */
export async function buildTreeFixture(db: Pg, run: string): Promise<TreeFixture> {
  const orgA = await insertOrganization(db, `F210-A-${run}`);
  const orgB = await insertOrganization(db, `F210-B-${run}`);

  const node = (org: string, code: Node, parentId: string | null) =>
    insertLocation(db, { organizationId: org, code: `F210-${run}-${code}`, parentId });
  const R = await node(orgA, "R", null);
  const A = await node(orgA, "A", R);
  const A1 = await node(orgA, "A1", A);
  const A1a = await node(orgA, "A1a", A1);
  const B = await node(orgA, "B", R);
  const B1 = await node(orgA, "B1", B);
  const X = await node(orgB, "X", null);
  const X1 = await node(orgB, "X1", X);
  const nodes: Record<Node, string> = { R, A, A1, A1a, B, B1, X, X1 };

  const domainRows = await db.query<{ code: string }>(
    "SELECT code FROM bms.asset_domains ORDER BY code LIMIT 1",
  );
  const domain = domainRows.rows[0]?.code ?? fail("bms.asset_domains is empty — run pnpm db:seed");
  const assets = {} as Record<Node, string>;
  for (const name of Object.keys(nodes) as Node[]) {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO bms.assets (organization_id, location_id, code, name, site_name, domain)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [name.startsWith("X") ? orgB : orgA, nodes[name], `F210-${run}-${name}-ASSET`, `F2.10 asset ${name}`, `F2.10 ${name}`, domain],
    );
    assets[name] = rows[0]?.id ?? fail(`asset for ${name} was not inserted`);
  }

  const grantee = await insertUser(db, orgA, `f210-grantee-${run}@integration.invalid`, "location_admin");
  const grantee2 = await insertUser(db, orgA, `f210-grantee2-${run}@integration.invalid`, "location_admin");
  const groupAdmin = await insertUser(db, orgA, `f210-group-${run}@integration.invalid`, "asset_group_admin");
  const foreignOrgAdmin = await insertUser(
    db,
    orgB,
    `f210-foreign-org-${run}@integration.invalid`,
    "organization_admin",
  );

  await db.query(`INSERT INTO bms.user_location_access (user_id, location_id) VALUES ($1, $2), ($3, $4)`, [
    grantee.sub,
    A,
    grantee2.sub,
    B,
  ]);
  const group = await db.query<{ id: string }>(
    `INSERT INTO bms.asset_groups (organization_id, location_id, code, name) VALUES ($1, $2, $3, $4) RETURNING id`,
    [orgA, A1, `F210-${run}-G`, "F2.10 group on A1"],
  );
  const groupId = group.rows[0]?.id ?? fail("asset group was not inserted");
  await db.query(`INSERT INTO bms.asset_group_members (asset_group_id, asset_id) VALUES ($1, $2)`, [groupId, assets.A1]);
  await db.query(`INSERT INTO bms.user_asset_group_access (user_id, asset_group_id) VALUES ($1, $2)`, [
    groupAdmin.sub,
    groupId,
  ]);
  await db.query(`INSERT INTO bms.user_organization_access (user_id, organization_id) VALUES ($1, $2)`, [
    foreignOrgAdmin.sub,
    orgB,
  ]);

  return { orgA, orgB, nodes, assets, grantee, grantee2, groupAdmin, foreignOrgAdmin };
}

// ---------------------------------------------------------------------------
// 1–3b. The closure on every surface
// ---------------------------------------------------------------------------

const GRANTED_SUBTREE: readonly Node[] = ["A", "A1", "A1a"];
const OUTSIDE_SUBTREE: readonly Node[] = ["R", "B", "B1", "X", "X1"];

async function writableSet(svc: AccessControlService, jwt: JwtPayload): Promise<Set<string>> {
  const writable = await svc.writableLocationIds(jwt);
  if (writable === null) fail("a location admin's writableLocationIds must be a list, not unrestricted");
  if (writable.length === 0) fail("the grantee resolved no location — the closure is empty and nothing below can be proved");
  return setOf(writable);
}

/** 1. `writableLocationIds` is exactly {A, A1, A1a}; `canManageLocation` agrees node by node. */
export async function assertExactClosureForAGrantedNode(svc: AccessControlService, fx: TreeFixture): Promise<void> {
  const expected = setOf(GRANTED_SUBTREE.map((n) => fx.nodes[n]));
  const actual = await writableSet(svc, fx.grantee);
  if (!sameSet(actual, expected)) {
    fail(`writableLocationIds(grantee) = ${show(actual)}, expected exactly the subtree of A ${show(expected)}`);
  }
  for (const name of GRANTED_SUBTREE) {
    if (!(await svc.canManageLocation(fx.grantee, fx.nodes[name]))) fail(`canManageLocation refused ${name}, inside the granted subtree`);
  }
  for (const name of OUTSIDE_SUBTREE) {
    if (await svc.canManageLocation(fx.grantee, fx.nodes[name])) {
      fail(`canManageLocation allowed ${name}, outside the granted subtree — the closure widened past A`);
    }
  }
}

/** 2. The sibling subtree (B, B1) and the parent (R) are refused — the ADR 0098 *Security* 1 claim by name. */
export async function assertSiblingSubtreeAndParentAreRefused(svc: AccessControlService, fx: TreeFixture): Promise<void> {
  const writable = await writableSet(svc, fx.grantee);
  for (const name of ["B", "B1", "R"] as const) {
    const id = fx.nodes[name];
    if (writable.has(id)) fail(`${name} is in writableLocationIds(grantee) — a ${name === "R" ? "parent" : "sibling-subtree"} leak`);
    if (await svc.canManageLocation(fx.grantee, id)) fail(`canManageLocation(grantee, ${name}) is true — a ${name === "R" ? "parent" : "sibling-subtree"} leak`);
  }
}

/** 3. `/auth/me`'s scope and `readableAssetIds` agree with the manage side; R is hidden from A's `parentId`. */
export async function assertReadSideMatchesManageSide(svc: AccessControlService, fx: TreeFixture): Promise<void> {
  const { scope } = await svc.currentUser(fx.grantee);
  const expectedNodes = setOf(GRANTED_SUBTREE.map((n) => fx.nodes[n]));
  const actualNodes = setOf(scope.locations.map((l) => l.id));
  if (!sameSet(actualNodes, expectedNodes)) {
    fail(`currentUser(grantee).scope.locations = ${show(actualNodes)}, expected ${show(expectedNodes)}`);
  }
  const readable = await svc.readableAssetIds(fx.grantee);
  if (readable === null) fail("a location admin's readableAssetIds must be a list");
  const expectedAssets = setOf(GRANTED_SUBTREE.map((n) => fx.assets[n]));
  if (!sameSet(setOf(readable), expectedAssets)) {
    fail(`readableAssetIds(grantee) = ${show(readable)}, expected the three subtree assets ${show(expectedAssets)}`);
  }
  const byId = new Map(scope.locations.map((l) => [l.id, l]));
  const a = byId.get(fx.nodes.A);
  const a1 = byId.get(fx.nodes.A1);
  if (a?.parentId !== null) fail(`A.parentId = ${String(a?.parentId)}; R is unreadable and must be hidden as null (Drafter choice 8)`);
  if (a1?.parentId !== fx.nodes.A) fail(`A1.parentId = ${String(a1?.parentId)}; expected A, which the grantee reads`);
}

/** 3b. An `asset_group_admin` on A1 sees [A1] with `parentId` null — A is outside its readable set. */
export async function assertAssetGroupScopeHidesAnUnreadableParent(svc: AccessControlService, fx: TreeFixture): Promise<void> {
  const { scope } = await svc.currentUser(fx.groupAdmin);
  if (scope.kind !== "asset_group") fail(`groupAdmin resolved scope kind ${scope.kind}, expected asset_group`);
  const ids = scope.locations.map((l) => l.id);
  if (ids.length !== 1 || ids[0] !== fx.nodes.A1) fail(`groupAdmin.scope.locations = ${show(ids)}, expected exactly [A1]`);
  const parentId = scope.locations[0]?.parentId;
  if (parentId !== null) fail(`groupAdmin sees A1.parentId = ${String(parentId)}; A is unreadable in the asset_group branch and must be null`);
}

// ---------------------------------------------------------------------------
// 4. The cross-organization edge, with no service and no privileged role
// ---------------------------------------------------------------------------

type SeededPair = { orgA: string; orgARoot: string; orgBRoot: string };

/** The two oldest seeded organizations and each one's oldest location (F4.53: oldest wins). */
export async function seededPair(db: Pg): Promise<SeededPair> {
  const orgs = await db.query<{ id: string }>(`SELECT id FROM bms.organizations ORDER BY created_at, code LIMIT 2`);
  const orgA = orgs.rows[0]?.id ?? fail("no seeded organization — run pnpm db:seed");
  const orgB = orgs.rows[1]?.id ?? fail("a second seeded organization is needed — run pnpm db:seed");
  const oldest = async (org: string): Promise<string> => {
    const r = await db.query<{ id: string }>(
      `SELECT id FROM bms.locations WHERE organization_id = $1 ORDER BY created_at, code LIMIT 1`,
      [org],
    );
    return r.rows[0]?.id ?? fail(`organization ${org} has no location — run pnpm db:seed`);
  };
  return { orgA, orgARoot: await oldest(orgA), orgBRoot: await oldest(orgB) };
}

function expectCompositeFk(failure: PgFailure | undefined, what: string): void {
  if (failure === undefined) fail(`${what} succeeded — the composite same-organization foreign key is not enforced`);
  if (failure.code !== "23503") fail(`${what}: SQLSTATE ${failure.code}, expected 23503 (${failure.message})`);
  if (failure.constraint !== "locations_parent_id_organization_id_fkey") {
    fail(`${what}: constraint ${failure.constraint}, expected locations_parent_id_organization_id_fkey`);
  }
  if (failure.message.includes("locations_tree_guard")) {
    fail(`${what}: the trigger answered instead of the foreign key (A1: an invisible parent returns NEW) — ${failure.message}`);
  }
}

/**
 * On a `bms_tenant` connection under seeded organization A's GUC, and on a
 * `bms_fleet` connection with no GUC: an INSERT and an UPDATE that put an
 * organization-A node under organization B's oldest location both fail on
 * `locations_parent_id_organization_id_fkey`, never on the trigger.
 */
export async function assertCrossOrgEdgeFailsOnTheCompositeFk(
  pools: { tenantDb: BmsDb; fleetDb: BmsDb },
  seeded: SeededPair,
  run: string,
): Promise<void> {
  const cases: Array<{ label: string; db: BmsDb; tenant: boolean }> = [
    { label: "bms_tenant with the GUC", db: pools.tenantDb, tenant: true },
    { label: "bms_fleet with no GUC", db: pools.fleetDb, tenant: false },
  ];
  for (const c of cases) {
    await withRollback(c.db, async (tx) => {
      if (c.tenant) {
        await tx.execute(sql`select set_config('app.current_organization', ${seeded.orgA}, true)`);
      }
      await tx.execute(sql`SAVEPOINT cross_insert`);
      const insert = await caught(() =>
        insertLocation(tx, { organizationId: seeded.orgA, code: `F210-${run}-XORG-${c.tenant ? "T" : "F"}`, parentId: seeded.orgBRoot }),
      );
      await tx.execute(sql`ROLLBACK TO SAVEPOINT cross_insert`);
      expectCompositeFk(insert, `${c.label}: INSERT of an organization-A child under organization B's root`);

      await tx.execute(sql`SAVEPOINT cross_update`);
      const update = await caught(() =>
        tx.execute(sql`UPDATE bms.locations SET parent_id = ${seeded.orgBRoot} WHERE id = ${seeded.orgARoot}`),
      );
      await tx.execute(sql`ROLLBACK TO SAVEPOINT cross_update`);
      expectCompositeFk(update, `${c.label}: UPDATE of organization A's root under organization B's root`);
      tx.rollback();
    });
  }
}

// ---------------------------------------------------------------------------
// 5. The trigger's refusals with no service in front of it
// ---------------------------------------------------------------------------

function expectTreeGuard(failure: PgFailure | undefined, reason: string, what: string): void {
  if (failure === undefined) fail(`${what} succeeded — the trigger did not refuse it`);
  if (failure.code !== "23514") fail(`${what}: SQLSTATE ${failure.code}, expected 23514 (${failure.message})`);
  if (failure.constraint !== "locations_tree_guard") fail(`${what}: constraint ${failure.constraint}, expected locations_tree_guard`);
  if (failure.message !== reason) fail(`${what}: message ${JSON.stringify(failure.message)}, expected ${reason}`);
}

/**
 * On the `bms_fleet` pool with **no** tenant GUC (the API-bypass proof the ADR's
 * *Verification owed* asks for, as the privileged role): a chain inside a new
 * organization built in the transaction; a cycle, depth 9 and decision 5's
 * four refusals each raise `locations_tree_guard` with the reason as the
 * message. Then, on a dedicated client, `REPEATABLE READ`: a root INSERT
 * passes (A2) and a child INSERT raises naming `read committed`.
 */
export async function assertTriggerRefusalsWithoutTheService(fleetDb: BmsDb, fleetPool: pg.Pool, run: string): Promise<void> {
  await withRollback(fleetDb, async (tx) => {
    const org = await tx.execute<{ id: string }>(sql`
      INSERT INTO bms.organizations (code, name, currency) VALUES (${`F210-T-${run}`}, 'F2.10 trigger org', 'INR') RETURNING id`);
    const orgId = org.rows[0]?.id ?? fail("trigger organization was not inserted");
    let seq = 0;
    const node = (parentId: string | null, active = true) =>
      insertLocation(tx, { organizationId: orgId, code: `F210-T-${run}-${++seq}`, parentId, active });
    const probe = async (what: string, reason: string, body: () => Promise<unknown>): Promise<void> => {
      await tx.execute(sql`SAVEPOINT probe`);
      const failure = await caught(body);
      await tx.execute(sql`ROLLBACK TO SAVEPOINT probe`);
      expectTreeGuard(failure, reason, what);
    };

    const r = await node(null);
    const a = await node(r);
    const a1 = await node(a);

    await probe("UPDATE R SET parent_id = A1 (a cycle)", "location_parent_cycle", () =>
      tx.execute(sql`UPDATE bms.locations SET parent_id = ${a1} WHERE id = ${r}`),
    );
    // Depth: R(1) A(2) A1(3) … the eighth is the last the bound admits.
    let deepest = a1;
    for (let depth = 4; depth <= LOCATION_TREE_MAX_DEPTH; depth += 1) deepest = await node(deepest);
    await probe(`a child at depth ${LOCATION_TREE_MAX_DEPTH + 1}`, "location_depth_exceeded", () => node(deepest));
    // Decision 5 (d): deactivate R while A is active.
    await probe("deactivate R while A is active", "location_has_active_children", () =>
      tx.execute(sql`UPDATE bms.locations SET active = false WHERE id = ${r}`),
    );
    // Decision 5 (a): an active child under an inactive node.
    const inactive = await node(a, false);
    await probe("INSERT an active child under an inactive node", "location_parent_inactive", () => node(inactive));
    // Decision 5 (b): reactivate a node whose parent is inactive.
    const child = await node(inactive, false);
    await probe("reactivate a node under an inactive parent", "location_parent_inactive", () =>
      tx.execute(sql`UPDATE bms.locations SET active = true WHERE id = ${child}`),
    );
    // Decision 5 (c): move an active node under an inactive one. A fresh leaf,
    // not A1: A1 now carries the depth-8 chain, and the trigger checks depth
    // before the parent's active flag.
    const leaf = await node(a);
    await probe("move an active leaf under the inactive node", "location_parent_inactive", () =>
      tx.execute(sql`UPDATE bms.locations SET parent_id = ${inactive} WHERE id = ${leaf}`),
    );
    tx.rollback();
  });

  const client = await fleetPool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    const org = await client.query<{ id: string }>(
      `INSERT INTO bms.organizations (code, name, currency) VALUES ($1, 'F2.10 repeatable read org', 'INR') RETURNING id`,
      [`F210-RR-${run}`],
    );
    const orgId = org.rows[0]?.id ?? fail("repeatable-read organization was not inserted");
    const root = await insertLocation(client, { organizationId: orgId, code: `F210-RR-${run}-root`, parentId: null });
    const failure = await caught(() => insertLocation(client, { organizationId: orgId, code: `F210-RR-${run}-child`, parentId: root }));
    if (failure === undefined) fail("a child INSERT under REPEATABLE READ succeeded — the trigger's isolation check is gone");
    if (!failure.message.includes("read committed")) fail(`the isolation refusal does not name read committed: ${failure.message}`);
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
  }
}

// ---------------------------------------------------------------------------
// 6. The per-step organization predicate, with the foreign key out of the way
// ---------------------------------------------------------------------------

/**
 * The walk the closure would be without its per-step organization predicate —
 * the positive control: with the planted edge X1 → A1 in place it must reach
 * X1, or the planted edge proves nothing about the real walk.
 */
const UNGUARDED_SUBTREE = `
  WITH RECURSIVE t (id, depth) AS (
    SELECT l.id, 1 FROM bms.locations l WHERE l.id = $1
    UNION
    SELECT c.id, t.depth + 1 FROM bms.locations c JOIN t ON c.parent_id = t.id WHERE t.depth < ${LOCATION_TREE_MAX_DEPTH}
  )
  SELECT id FROM t`;

/**
 * Inside the superuser transaction: plant `X1.parent_id = A1` with the foreign
 * key and the trigger switched off (`session_replication_role = replica`).
 * The unguarded walk reaches X1 (positive control); every real surface does
 * not; `locationAncestors(X1)` stops at X1; `locationDepthAndHeight(A1).height`
 * is unchanged. Then, from a clean savepoint where X1's parent is X again,
 * plant the cycle X ↔ X1 inside organization B under a 2 s
 * `statement_timeout`: a walk that lost its depth bound fails with a named
 * 57014 instead of hanging, and each bounded walk stops at exactly
 * `LOCATION_TREE_MAX_DEPTH` steps. The planted rows are rolled back to a
 * savepoint before this returns.
 */
export async function assertPerStepPredicateHoldsWithoutTheFk(
  svc: AccessControlService,
  db: Pg,
  exec: Executor,
  fx: TreeFixture,
): Promise<void> {
  const before = await locationDepthAndHeight(exec, fx.nodes.A1);
  if (before === null || before.height !== 2) fail(`A1's height before the plant is ${String(before?.height)}, expected 2 (A1 → A1a)`);
  // The depth anchor: a root is 1, so A1 under R → A sits at 3. An anchor of 0 or 2 reddens here.
  if (before.depth !== 3) fail(`A1's depth before the plant is ${before.depth}, expected 3 (R → A → A1)`);

  await db.query("SAVEPOINT plant");
  try {
    await db.query("SET LOCAL session_replication_role = replica");
    await db.query("UPDATE bms.locations SET parent_id = $1 WHERE id = $2", [fx.nodes.A1, fx.nodes.X1]);
    await db.query("SET LOCAL session_replication_role = origin");

    const unguarded = await db.query<{ id: string }>(UNGUARDED_SUBTREE, [fx.nodes.A]);
    if (!unguarded.rows.some((r) => r.id === fx.nodes.X1)) {
      fail("positive control: the unguarded walk from A did not reach the planted X1 — the plant did not land");
    }

    const writable = await writableSet(svc, fx.grantee);
    if (writable.has(fx.nodes.X1)) fail("writableLocationIds(grantee) contains X1 through the planted cross-organization edge");
    const { scope } = await svc.currentUser(fx.grantee);
    if (scope.locations.some((l) => l.id === fx.nodes.X1)) fail("currentUser(grantee).scope.locations contains X1 through the planted edge");
    const readable = (await svc.readableAssetIds(fx.grantee)) ?? fail("readableAssetIds must be a list");
    if (readable.includes(fx.assets.X1)) fail("readableAssetIds(grantee) contains X1's asset through the planted edge");
    const report = await svc.reportFileReadScope(fx.grantee);
    if (report.kind !== "location") fail(`reportFileReadScope(grantee).kind = ${report.kind}`);
    if (report.locationIds.includes(fx.nodes.X1)) fail("reportFileReadScope(grantee).locationIds contains X1 through the planted edge");

    const ancestors = await locationAncestors(exec, fx.nodes.X1);
    if (ancestors.length !== 1 || ancestors[0]?.id !== fx.nodes.X1) {
      fail(`locationAncestors(X1) = ${show(ancestors.map((a) => a.id))}; the walk must stop at X1 and never reach A1`);
    }
    const after = await locationDepthAndHeight(exec, fx.nodes.A1);
    if (after?.height !== before.height) fail(`A1's height became ${String(after?.height)} through the planted edge; expected ${before.height}`);
  } finally {
    await db.query("ROLLBACK TO SAVEPOINT plant");
  }

  // A real cycle inside organization B. The rollback above restored X1 → X, so
  // X → X1 closes the loop X ↔ X1 with no organization line to stop a walk.
  await db.query("SAVEPOINT cycle");
  // pg-pool destroys the client a failed pool.query ran on, so after a 57014 the
  // transaction is gone and the rollback below would mask the named failure.
  let walked = false;
  try {
    await db.query("SET LOCAL statement_timeout = '2s'");
    await db.query("SET LOCAL session_replication_role = replica");
    await db.query("UPDATE bms.locations SET parent_id = $1 WHERE id = $2", [fx.nodes.X1, fx.nodes.X]);
    await db.query("SET LOCAL session_replication_role = origin");

    const unbounded = (what: string) => (error: unknown): never => {
      const code = (error as { code?: string; cause?: { code?: string } }).code ?? (error as { cause?: { code?: string } }).cause?.code;
      if (code === "57014") fail(`${what} on the cycle X ↔ X1 hit the 2 s statement_timeout (57014) — the walk lost its depth bound`);
      throw error;
    };

    const cycleAncestors = await locationAncestors(exec, fx.nodes.X1).catch(unbounded("locationAncestors(X1)"));
    if (cycleAncestors.length !== LOCATION_TREE_MAX_DEPTH + 1) {
      fail(`locationAncestors(X1) on the cycle returned ${cycleAncestors.length} rows; expected ${LOCATION_TREE_MAX_DEPTH + 1} (depth 0 … ${LOCATION_TREE_MAX_DEPTH})`);
    }
    const cycleDepth = await locationDepthAndHeight(exec, fx.nodes.X).catch(unbounded("locationDepthAndHeight(X)"));
    if (cycleDepth?.depth !== LOCATION_TREE_MAX_DEPTH || cycleDepth.height !== LOCATION_TREE_MAX_DEPTH) {
      fail(`locationDepthAndHeight(X) on the cycle = ${JSON.stringify(cycleDepth)}; expected depth and height ${LOCATION_TREE_MAX_DEPTH}`);
    }
    // DISTINCT id hides the row count, so the timeout is this walk's gate; the set is the positive control.
    const subtree = await expandLocationSubtrees(exec, [fx.nodes.X]).catch(unbounded("expandLocationSubtrees([X])"));
    if (!sameSet(setOf(subtree), setOf([fx.nodes.X, fx.nodes.X1]))) {
      fail(`expandLocationSubtrees([X]) on the cycle = ${show(subtree)}; expected [X, X1]`);
    }
    walked = true;
  } finally {
    await db.query("ROLLBACK TO SAVEPOINT cycle").catch((error: unknown) => {
      if (walked) throw error;
    });
  }
}

// ---------------------------------------------------------------------------
// 7–8. A move re-checks; a foreign organization_admin is not organization-level
// ---------------------------------------------------------------------------

/** 7. After `UPDATE A1 SET parent_id = B`, A1 and A1a leave the grantee's closure and enter grantee2's; the read side agrees. */
export async function assertAMoveReChecks(svc: AccessControlService, db: Pg, fx: TreeFixture): Promise<void> {
  await db.query("SAVEPOINT move");
  try {
    await db.query("UPDATE bms.locations SET parent_id = $1 WHERE id = $2", [fx.nodes.B, fx.nodes.A1]);
    for (const name of ["A1", "A1a"] as const) {
      if (await svc.canManageLocation(fx.grantee, fx.nodes[name])) fail(`after the move, canManageLocation(grantee, ${name}) is still true`);
      if (!(await svc.canManageLocation(fx.grantee2, fx.nodes[name]))) fail(`after the move, canManageLocation(grantee2, ${name}) is false`);
    }
    const granteeScope = setOf((await svc.currentUser(fx.grantee)).scope.locations.map((l) => l.id));
    if (!sameSet(granteeScope, setOf([fx.nodes.A]))) fail(`after the move, grantee reads ${show(granteeScope)}, expected [A]`);
    const grantee2Scope = setOf((await svc.currentUser(fx.grantee2)).scope.locations.map((l) => l.id));
    const expected2 = setOf([fx.nodes.B, fx.nodes.B1, fx.nodes.A1, fx.nodes.A1a]);
    if (!sameSet(grantee2Scope, expected2)) fail(`after the move, grantee2 reads ${show(grantee2Scope)}, expected ${show(expected2)}`);
  } finally {
    await db.query("ROLLBACK TO SAVEPOINT move");
  }
}

/** 8. decision 12's live case: a direct row on F210-B makes the admin organization-level for B and not for A. */
export async function assertForeignOrganizationAdminIsNotOrganizationLevel(svc: AccessControlService, fx: TreeFixture): Promise<void> {
  if (await svc.isOrganizationLevelAdmin(fx.foreignOrgAdmin, fx.orgA)) {
    fail("isOrganizationLevelAdmin(foreignOrgAdmin, F210-A) is true with no direct row for A — a role-only answer");
  }
  if (!(await svc.isOrganizationLevelAdmin(fx.foreignOrgAdmin, fx.orgB))) {
    fail("isOrganizationLevelAdmin(foreignOrgAdmin, F210-B) is false although the direct row exists");
  }
}
