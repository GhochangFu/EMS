import { HttpException } from "@nestjs/common";
import type pg from "pg";
import { expect } from "vitest";

import { locationWriteRefusalReasonSchema, locationWriteRefusalSchema } from "@bms/shared";
import type { AdminLocationDto, JwtPayload, LocationWriteRefusalReason } from "@bms/shared";

import { jwtFor, rememberSubject } from "../../testing/seeded-subjects";
import type { LocationsAdminService } from "./locations.service";

/**
 * `F2.10` Unit D — the locations admin write path over a tree (ADR 0098
 * decisions 5 and 12, Drafter choices 2 and 8, Amendment 1 A3 and A5).
 * Assertions live here (§4.6); `locations.tree.integration.test.ts` owns the
 * pools and the per-run organizations.
 *
 * Every fixture is committed inside two organizations this run creates
 * (`F210D-<run>`, `F210D-O-<run>`) and deletes in `afterAll`, never inside a
 * seeded organization: the tree-guard trigger takes an advisory lock per
 * organization, and a fixture in a seeded one would serialize sibling suites.
 */

export const MOVE_SENTENCE = "Only an organization-level administrator may move a location";
const DEACTIVATE_SENTENCE = "Cannot deactivate location with active RTUs or assets";
const CREATE_SENTENCE = "Location admins cannot create new locations";
const SCOPE_SENTENCE = "Location is outside your access scope";

function fail(message: string): never {
  throw new Error(message);
}

export type TreeFixture = {
  readonly run: string;
  readonly organizationId: string;
  readonly otherOrganizationId: string;
  readonly orgAdmin: JwtPayload;
  readonly globalAdmin: JwtPayload;
  readonly foreignOrgAdmin: JwtPayload;
  /** Inserts a location on the superuser pool and returns its id. */
  node(tag: string, parentId: string | null, options?: { active?: boolean; organizationId?: string }): Promise<string>;
  /** A `location_admin` in the run's organization holding exactly `grants`. */
  locationAdmin(tag: string, grants: readonly string[]): Promise<JwtPayload>;
  /** An active asset on `locationId`. */
  asset(tag: string, locationId: string): Promise<string>;
};

export type TreeCtx = {
  readonly svc: LocationsAdminService;
  readonly superPool: pg.Pool;
  readonly fleetPool: pg.Pool;
  readonly fx: TreeFixture;
};

async function insertUser(
  db: pg.Pool,
  organizationId: string | null,
  email: string,
  role: JwtPayload["role"],
): Promise<JwtPayload> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO bms.users (organization_id, email, password_hash, display_name, role)
     VALUES ($1, $2, 'not-a-usable-hash', $3, $4) RETURNING id`,
    [organizationId, email, `F2.10 D ${role}`, role],
  );
  const id = rows[0]?.id ?? fail(`user ${email} was not inserted`);
  rememberSubject(email, id);
  return jwtFor(email, role);
}

/** Builds the two organizations and the three standing users on the superuser pool. */
export async function buildFixture(superPool: pg.Pool, run: string): Promise<TreeFixture> {
  const org = async (code: string): Promise<string> => {
    const { rows } = await superPool.query<{ id: string }>(
      `INSERT INTO bms.organizations (code, name, currency) VALUES ($1, $2, 'INR') RETURNING id`,
      [code, `F2.10 D ${code}`],
    );
    return rows[0]?.id ?? fail(`organization ${code} was not inserted`);
  };
  const organizationId = await org(`F210D-${run}`);
  const otherOrganizationId = await org(`F210D-O-${run}`);

  const orgAdmin = await insertUser(superPool, organizationId, `f210d-org-${run}@integration.invalid`, "organization_admin");
  await superPool.query(`INSERT INTO bms.user_organization_access (user_id, organization_id) VALUES ($1, $2)`, [
    orgAdmin.sub,
    organizationId,
  ]);
  const globalAdmin = await insertUser(superPool, null, `f210d-admin-${run}@integration.invalid`, "admin");
  const foreignOrgAdmin = await insertUser(
    superPool,
    otherOrganizationId,
    `f210d-foreign-${run}@integration.invalid`,
    "organization_admin",
  );
  await superPool.query(`INSERT INTO bms.user_organization_access (user_id, organization_id) VALUES ($1, $2)`, [
    foreignOrgAdmin.sub,
    otherOrganizationId,
  ]);

  const domainRows = await superPool.query<{ code: string }>(
    "SELECT code FROM bms.asset_domains WHERE active = true ORDER BY code LIMIT 1",
  );
  const domain = domainRows.rows[0]?.code ?? fail("bms.asset_domains has no active row — run pnpm db:seed");

  let seq = 0;
  return {
    run,
    organizationId,
    otherOrganizationId,
    orgAdmin,
    globalAdmin,
    foreignOrgAdmin,
    async node(tag, parentId, options = {}) {
      seq += 1;
      const code = `F210D-${run}-${tag}-${seq}`;
      const { rows } = await superPool.query<{ id: string }>(
        `INSERT INTO bms.locations
           (organization_id, code, slug, name, type, latitude, longitude, parent_id, active)
         VALUES ($1, $2, $3, $4, 'campus', 0, 0, $5, $6)
         RETURNING id`,
        [options.organizationId ?? organizationId, code, code.toLowerCase(), `F2.10 D ${tag}`, parentId, options.active ?? true],
      );
      return rows[0]?.id ?? fail(`location ${code} was not inserted`);
    },
    async locationAdmin(tag, grants) {
      seq += 1;
      const jwt = await insertUser(superPool, organizationId, `f210d-${tag}-${seq}-${run}@integration.invalid`, "location_admin");
      for (const locationId of grants) {
        await superPool.query(`INSERT INTO bms.user_location_access (user_id, location_id) VALUES ($1, $2)`, [
          jwt.sub,
          locationId,
        ]);
      }
      return jwt;
    },
    async asset(tag, locationId) {
      seq += 1;
      const code = `F210D-${run}-${tag}-${seq}-ASSET`;
      const { rows } = await superPool.query<{ id: string }>(
        `INSERT INTO bms.assets (organization_id, location_id, code, name, site_name, domain, active)
         SELECT organization_id, id, $2, $3, 'F2.10 D site', $4, true FROM bms.locations WHERE id = $1
         RETURNING id`,
        [locationId, code, `F2.10 D asset ${tag}`, domain],
      );
      return rows[0]?.id ?? fail(`asset ${code} was not inserted`);
    },
  };
}

/**
 * Deletes everything run `run` committed, children of every foreign key
 * first. Keyed by the run's organization codes and user emails, not by the
 * fixture object, so a `beforeAll` that failed half-way is cleaned too.
 */
export async function dropFixture(superPool: pg.Pool, run: string): Promise<void> {
  const { rows } = await superPool.query<{ id: string }>(
    "SELECT id FROM bms.organizations WHERE code = ANY($1::text[])",
    [[`F210D-${run}`, `F210D-O-${run}`]],
  );
  const orgs = rows.map((r) => r.id);
  // The global admin has no organization (users_role_organization_check); every email carries the run.
  const users = "(SELECT id FROM bms.users WHERE organization_id = ANY($1::uuid[]) OR email LIKE $2)";
  const userArgs = [orgs, `f210d-%-${run}@integration.invalid`];
  await superPool.query(`DELETE FROM bms.audit_log WHERE organization_id = ANY($1::uuid[])`, [orgs]);
  await superPool.query(`DELETE FROM bms.user_location_access WHERE user_id IN ${users}`, userArgs);
  await superPool.query(`DELETE FROM bms.user_organization_access WHERE user_id IN ${users}`, userArgs);
  await superPool.query(`DELETE FROM bms.users WHERE id IN ${users}`, userArgs);
  await superPool.query(`DELETE FROM bms.assets WHERE organization_id = ANY($1::uuid[])`, [orgs]);
  // One statement: the composite parent FK is NO ACTION, checked at the statement's end.
  await superPool.query(`DELETE FROM bms.locations WHERE organization_id = ANY($1::uuid[])`, [orgs]);
  await superPool.query(`DELETE FROM bms.organizations WHERE id = ANY($1::uuid[])`, [orgs]);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createBody(fx: TreeFixture, tag: string, parentId?: string | null, organizationId?: string) {
  const code = `F210D-${fx.run}-${tag}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    organizationId: organizationId ?? fx.organizationId,
    code,
    slug: code.toLowerCase(),
    name: `F2.10 D ${tag}`,
    type: "campus",
    latitude: 0,
    longitude: 0,
    ...(parentId !== undefined ? { parentId } : {}),
  };
}

async function thrown(run: () => Promise<unknown>): Promise<HttpException> {
  try {
    await run();
  } catch (err) {
    if (err instanceof HttpException) return err;
    throw err;
  }
  return fail("expected the call to be refused, and it succeeded");
}

/** The call is refused with `status` and the strict `{ message, reason }` body naming `reason`. */
export async function expectRefusal(
  run: () => Promise<unknown>,
  status: number,
  reason: LocationWriteRefusalReason,
): Promise<void> {
  const err = await thrown(run);
  const body = err.getResponse();
  expect(err.getStatus(), `status for ${reason}: ${JSON.stringify(body)}`).toBe(status);
  expect(locationWriteRefusalSchema.strict().safeParse(body).success, JSON.stringify(body)).toBe(true);
  expect((body as { reason: string }).reason).toBe(reason);
}

async function expectForbidden(run: () => Promise<unknown>, sentence: string): Promise<void> {
  const err = await thrown(run);
  expect(err.getStatus()).toBe(403);
  expect(err.message).toBe(sentence);
}

async function row(db: pg.Pool, id: string): Promise<{ parent_id: string | null; active: boolean; name: string }> {
  const { rows } = await db.query<{ parent_id: string | null; active: boolean; name: string }>(
    "SELECT parent_id, active, name FROM bms.locations WHERE id = $1",
    [id],
  );
  return rows[0] ?? fail(`location ${id} is gone`);
}

async function auditRows(fleetPool: pg.Pool, entityId: string): Promise<Array<{ action: string; payload: Record<string, unknown> | null }>> {
  const { rows } = await fleetPool.query<{ action: string; payload: Record<string, unknown> | null }>(
    "SELECT action, payload FROM bms.audit_log WHERE entity_type = 'location' AND entity_id = $1 ORDER BY created_at, action",
    [entityId],
  );
  return rows;
}

// ---------------------------------------------------------------------------
// T1–T9
// ---------------------------------------------------------------------------

/** T1 — an organization admin creates a child under its root; the create audit row carries `parentId`. */
export async function assertOrgAdminCreatesAChild({ svc, fleetPool, fx }: TreeCtx): Promise<void> {
  const root = await fx.node("T1-R", null);
  const created = await svc.create(fx.orgAdmin, createBody(fx, "T1-C", root));
  expect(created.parentId).toBe(root);
  const audit = await auditRows(fleetPool, created.id);
  expect(audit.map((r) => r.action)).toEqual(["master.location.create"]);
  expect(audit[0]?.payload?.parentId).toBe(root);
}

/** T2 — a location admin creates neither a root nor a child. */
export async function assertLocationAdminCreatesNothing({ svc, fx }: TreeCtx): Promise<void> {
  const root = await fx.node("T2-R", null);
  const locAdmin = await fx.locationAdmin("t2", [root]);
  await expectForbidden(() => svc.create(locAdmin, createBody(fx, "T2-root")), CREATE_SENTENCE);
  await expectForbidden(() => svc.create(locAdmin, createBody(fx, "T2-child", root)), CREATE_SENTENCE);
}

/**
 * T3 — a location admin holding both parents is refused the move with the move
 * sentence; one holding only the target parent cannot manage the node, so it
 * hears the scope sentence, which runs first.
 */
export async function assertLocationAdminCannotMove({ svc, superPool, fx }: TreeCtx): Promise<void> {
  const R = await fx.node("T3-R", null);
  const A = await fx.node("T3-A", R);
  const B = await fx.node("T3-B", R);
  const A1 = await fx.node("T3-A1", A);
  const both = await fx.locationAdmin("t3-both", [A, B]);
  await expectForbidden(() => svc.update(both, A1, { parentId: B }), MOVE_SENTENCE);
  const holdsB = await fx.locationAdmin("t3-b", [B]);
  const X = await fx.node("T3-X", null);
  const holdsX = await fx.locationAdmin("t3-x", [X]);
  await expectForbidden(() => svc.update(holdsX, R, { parentId: X }), SCOPE_SENTENCE);
  await expectForbidden(() => svc.update(holdsB, R, { parentId: B }), SCOPE_SENTENCE);
  expect((await row(superPool, A1)).parent_id).toBe(A);
  expect((await row(superPool, R)).parent_id).toBeNull();
}

/**
 * T3b — an organization admin of another organization hears the scope
 * sentence for a node that exists and for an id that does not: the same 403,
 * so the move path is no existence oracle (security review M1).
 */
export async function assertForeignOrganizationAdminCannotMove({ svc, superPool, fx }: TreeCtx): Promise<void> {
  const R = await fx.node("T3b-R", null);
  const A = await fx.node("T3b-A", R);
  const B = await fx.node("T3b-B", R);
  await expectForbidden(() => svc.update(fx.foreignOrgAdmin, A, { parentId: B }), SCOPE_SENTENCE);
  await expectForbidden(() => svc.update(fx.foreignOrgAdmin, "00000000-0000-4000-8000-0000000f2101", { parentId: B }), SCOPE_SENTENCE);
  expect((await row(superPool, A)).parent_id).toBe(R);
}

/** T4 — an organization admin moves A1 from A to B; the audit names both parents; a rename alongside adds the update row. */
export async function assertOrgAdminMovesAndAudits({ svc, fleetPool, fx }: TreeCtx): Promise<void> {
  const R = await fx.node("T4-R", null);
  const A = await fx.node("T4-A", R);
  const B = await fx.node("T4-B", R);
  const A1 = await fx.node("T4-A1", A);
  await fx.node("T4-A1a", A1);

  const moved = await svc.update(fx.orgAdmin, A1, { parentId: B });
  expect(moved.parentId).toBe(B);
  const onlyMove = await auditRows(fleetPool, A1);
  expect(onlyMove.map((r) => r.action)).toEqual(["master.location.move"]);
  expect(onlyMove[0]?.payload).toEqual({ fromParentId: A, toParentId: B });

  const both = await svc.update(fx.orgAdmin, A1, { parentId: A, name: "F2.10 D T4 renamed" });
  expect(both.parentId).toBe(A);
  expect(both.name).toBe("F2.10 D T4 renamed");
  const after = (await auditRows(fleetPool, A1)).map((r) => r.action).sort();
  expect(after).toEqual(["master.location.move", "master.location.move", "master.location.update"]);
}

/**
 * T5 — a move to root; an unknown and a foreign parent are not found (A3); a
 * descendant is a cycle. Depth through the service, both directions: a create
 * at depth 8 is admitted and at 9 refused; a subtree of height 2 moves under
 * a depth-6 parent and is refused under a depth-7 one.
 */
export async function assertPlacementRefusals({ svc, superPool, fx }: TreeCtx): Promise<void> {
  const R = await fx.node("T5-R", null);
  const A = await fx.node("T5-A", R);
  const A1 = await fx.node("T5-A1", A);

  const rooted = await svc.update(fx.orgAdmin, A1, { parentId: null });
  expect(rooted.parentId).toBeNull();
  await svc.update(fx.orgAdmin, A1, { parentId: A });

  await expectRefusal(
    () => svc.create(fx.orgAdmin, createBody(fx, "T5-unknown", "00000000-0000-4000-8000-0000000f2100")),
    400,
    "location_parent_not_found",
  );
  const foreign = await fx.node("T5-foreign", null, { organizationId: fx.otherOrganizationId });
  await expectRefusal(() => svc.create(fx.globalAdmin, createBody(fx, "T5-foreign", foreign)), 400, "location_parent_not_found");
  await expectRefusal(() => svc.update(fx.globalAdmin, A, { parentId: foreign }), 400, "location_parent_not_found");

  await expectRefusal(() => svc.update(fx.orgAdmin, R, { parentId: A1 }), 400, "location_parent_cycle");
  expect((await row(superPool, R)).parent_id).toBeNull();

  const chain: string[] = [];
  for (let depth = 1; depth <= 7; depth += 1) {
    chain.push(await fx.node(`T5-d${depth}`, chain.at(-1) ?? null));
  }
  const d6 = chain[5] ?? fail("the depth-6 node");
  const d7 = chain[6] ?? fail("the depth-7 node");
  const d8 = await svc.create(fx.orgAdmin, createBody(fx, "T5-d8", d7));
  expect(d8.parentId, "a create at depth 8 is admitted").toBe(d7);
  await expectRefusal(() => svc.create(fx.orgAdmin, createBody(fx, "T5-d9", d8.id)), 400, "location_depth_exceeded");

  const M = await fx.node("T5-M", null);
  await fx.node("T5-M1", M);
  await expectRefusal(() => svc.update(fx.orgAdmin, M, { parentId: d7 }), 400, "location_depth_exceeded");
  expect((await row(superPool, M)).parent_id).toBeNull();
  const movedM = await svc.update(fx.orgAdmin, M, { parentId: d6 });
  expect(movedM.parentId, "a height-2 subtree under a depth-6 parent ends at depth 8").toBe(d6);
}

/** T6 — decision 5 (a)–(d) through the service, today's asset sentence, and the leaf-first / root-first order. */
export async function assertDecisionFive({ svc, superPool, fx }: TreeCtx): Promise<void> {
  const inactiveParent = await fx.node("T6-P0", null, { active: false });
  await expectRefusal(() => svc.create(fx.orgAdmin, createBody(fx, "T6-a", inactiveParent)), 409, "location_parent_inactive");

  const P = await fx.node("T6-P", null);
  const C = await fx.node("T6-C", P);
  await superPool.query("UPDATE bms.locations SET active = false WHERE id = $1", [C]);
  await superPool.query("UPDATE bms.locations SET active = false WHERE id = $1", [P]);
  await expectRefusal(() => svc.reactivate(fx.orgAdmin, C), 409, "location_parent_inactive");
  expect((await row(superPool, C)).active).toBe(false);

  const N = await fx.node("T6-N", null);
  await expectRefusal(() => svc.update(fx.orgAdmin, N, { parentId: P }), 409, "location_parent_inactive");
  expect((await row(superPool, N)).parent_id).toBeNull();

  const Q = await fx.node("T6-Q", null);
  const Q1 = await fx.node("T6-Q1", Q);
  await expectRefusal(() => svc.deactivate(fx.orgAdmin, Q), 409, "location_has_active_children");
  expect((await row(superPool, Q)).active).toBe(true);

  await fx.asset("T6-Q1", Q1);
  const err = await thrown(() => svc.deactivate(fx.orgAdmin, Q1));
  expect(err.getStatus()).toBe(409);
  expect(err.message).toBe(DEACTIVATE_SENTENCE);

  const S = await fx.node("T6-S", null);
  const S1 = await fx.node("T6-S1", S);
  expect((await svc.deactivate(fx.orgAdmin, S1)).active).toBe(false);
  expect((await svc.deactivate(fx.orgAdmin, S)).active).toBe(false);
  expect((await svc.reactivate(fx.orgAdmin, S)).active).toBe(true);
  expect((await svc.reactivate(fx.orgAdmin, S1)).active).toBe(true);
}

type Settled<T> = { ok: T } | { err: unknown };

/**
 * T6b — A5: `deactivate` locks its row before it counts. A superuser holds the
 * row `FOR SHARE`; the deactivate waits on it; the superuser adds an active
 * asset and commits; the deactivate must then count that asset and refuse.
 * With the lock after the count, the count sees nothing and the UPDATE waits
 * and then succeeds — 200, red here.
 */
export async function assertDeactivateLocksBeforeItCounts({ svc, superPool, fx }: TreeCtx): Promise<void> {
  const L = await fx.node("T6b-L", null);
  const client = await superPool.connect();
  let settled: Promise<Settled<AdminLocationDto>> | undefined;
  try {
    await client.query("BEGIN");
    const { rows: holderRows } = await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
    const holder = holderRows[0]?.pid ?? fail("the holder's backend pid");
    await client.query("SELECT 1 FROM bms.locations WHERE id = $1 FOR SHARE", [L]);
    settled = svc.deactivate(fx.orgAdmin, L).then(
      (ok) => ({ ok }),
      (err: unknown) => ({ err }),
    );

    const deadline = Date.now() + 5_000;
    let waiting = false;
    while (!waiting && Date.now() < deadline) {
      const { rows } = await superPool.query<{ n: number }>(
        // Tied to this holder, as E-T4 does: a waiter from another suite on a
        // shared database must not satisfy the poll.
        `SELECT count(*)::int AS n FROM pg_stat_activity WHERE pg_blocking_pids(pid) @> ARRAY[$1]::int[]`,
        [holder],
      );
      waiting = (rows[0]?.n ?? 0) > 0;
      if (!waiting) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(waiting, "the deactivate never waited on the row lock").toBe(true);

    const { rows: domain } = await client.query<{ code: string }>(
      "SELECT code FROM bms.asset_domains WHERE active = true ORDER BY code LIMIT 1",
    );
    await client.query(
      `INSERT INTO bms.assets (organization_id, location_id, code, name, site_name, domain, active)
       VALUES ($1, $2, $3, 'F2.10 D race asset', 'F2.10 D site', $4, true)`,
      [fx.organizationId, L, `F210D-${fx.run}-T6b-ASSET`, domain[0]?.code],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }

  const outcome = await (settled ?? fail("the deactivate was never started"));
  if ("ok" in outcome) {
    fail(`the deactivate succeeded (active=${String(outcome.ok.active)}) — it counted before it locked`);
  }
  expect(outcome.err).toBeInstanceOf(HttpException);
  const err = outcome.err as HttpException;
  expect(err.getStatus()).toBe(409);
  expect(err.message).toBe(DEACTIVATE_SENTENCE);
  expect((await row(superPool, L)).active).toBe(true);
}

/** T7 — inside its closure a location admin retires, restores and renames; the granted node's parent is hidden; a move is 403. */
export async function assertLocationAdminWorksInsideItsClosure({ svc, superPool, fx }: TreeCtx): Promise<void> {
  const R = await fx.node("T7-R", null);
  const A = await fx.node("T7-A", R);
  const A1 = await fx.node("T7-A1", A);
  const B = await fx.node("T7-B", R);
  const holdsA = await fx.locationAdmin("t7", [A]);

  expect((await svc.deactivate(holdsA, A1)).active).toBe(false);
  const restored = await svc.reactivate(holdsA, A1);
  expect(restored.active).toBe(true);
  expect(restored.parentId).toBe(A);

  const renamedChild = await svc.update(holdsA, A1, { name: "F2.10 D T7 child" });
  expect(renamedChild.parentId).toBe(A);
  const renamedGranted = await svc.update(holdsA, A, { name: "F2.10 D T7 granted" });
  expect(renamedGranted.name).toBe("F2.10 D T7 granted");
  expect(renamedGranted.parentId, "R is outside the grant and must be hidden").toBeNull();
  expect((await row(superPool, A)).parent_id, "the row still has its parent").toBe(R);

  // A move whose source and target both sit inside the closure is still not the location admin's.
  const hold = await fx.node("T7-A2", A);
  await expectForbidden(() => svc.update(holdsA, hold, { parentId: A1 }), MOVE_SENTENCE);
  await expectForbidden(() => svc.update(holdsA, A1, { parentId: B }), MOVE_SENTENCE);
  expect((await row(superPool, hold)).parent_id).toBe(A);

  // The granted node's hidden parent R: sending R, or null, is the same move
  // 403 — neither confirms R's id nor that A has a parent (security review M1).
  await expectForbidden(() => svc.update(holdsA, A, { parentId: R }), MOVE_SENTENCE);
  await expectForbidden(() => svc.update(holdsA, A, { parentId: null }), MOVE_SENTENCE);
  await expectForbidden(() => svc.update(holdsA, A, { parentId: B, name: "F2.10 D T7 guess" }), MOVE_SENTENCE);
  expect(await row(superPool, A)).toEqual({ parent_id: R, active: true, name: "F2.10 D T7 granted" });
}

/** T8 — the list for a location admin is the closure, with the granted node's parent hidden; `GET :id` reaches a grandchild. */
export async function assertListHidesTheUnreadableParent({ svc, fx }: TreeCtx): Promise<void> {
  const R = await fx.node("T8-R", null);
  const A = await fx.node("T8-A", R);
  const A1 = await fx.node("T8-A1", A);
  const A1a = await fx.node("T8-A1a", A1);
  const B = await fx.node("T8-B", R);
  const holdsA = await fx.locationAdmin("t8", [A]);

  const { items } = await svc.list(holdsA, fx.organizationId);
  const byId = new Map(items.map((item) => [item.id, item]));
  expect(new Set(byId.keys())).toEqual(new Set([A, A1, A1a]));
  expect(byId.has(B)).toBe(false);
  expect(byId.get(A)?.parentId).toBeNull();
  expect(byId.get(A1)?.parentId).toBe(A);
  expect(byId.get(A1a)?.parentId).toBe(A1);

  const asOrgAdmin = await svc.list(fx.orgAdmin, fx.organizationId);
  expect(asOrgAdmin.items.find((item) => item.id === A)?.parentId, "positive control: an org admin reads R").toBe(R);

  expect((await svc.getById(holdsA, A1a)).id).toBe(A1a);
}

/** T9 — every refusal the service answers is `{ message, reason }` with the reason in the shared enum. */
export async function assertEveryRefusalBodyIsInTheEnum({ svc, fx }: TreeCtx): Promise<void> {
  const R = await fx.node("T9-R", null);
  const A = await fx.node("T9-A", R);
  const dead = await fx.node("T9-dead", null, { active: false });
  const seen = new Set<string>();
  const attempts: Array<() => Promise<unknown>> = [
    () => svc.update(fx.orgAdmin, R, { parentId: A }),
    () => svc.create(fx.orgAdmin, createBody(fx, "T9-unknown", "00000000-0000-4000-8000-0000000f2109")),
    () => svc.create(fx.orgAdmin, createBody(fx, "T9-dead", dead)),
    () => svc.deactivate(fx.orgAdmin, R),
  ];
  for (const attempt of attempts) {
    const body = (await thrown(attempt)).getResponse();
    const parsed = locationWriteRefusalSchema.strict().safeParse(body);
    expect(parsed.success, JSON.stringify(body)).toBe(true);
    if (parsed.success) seen.add(parsed.data.reason);
  }
  expect([...seen].sort()).toEqual(
    ["location_has_active_children", "location_parent_cycle", "location_parent_inactive", "location_parent_not_found"],
  );
  for (const reason of seen) {
    expect(locationWriteRefusalReasonSchema.options).toContain(reason);
  }
}
