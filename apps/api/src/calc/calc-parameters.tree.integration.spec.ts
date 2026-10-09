import type pg from "pg";

import { inputKey } from "./calc-batch";
import type { CalcParametersService } from "./calc-parameters.service";
import { LOCATION_TREE_MAX_DEPTH } from "../auth/location-tree";
import type { TreeFixture } from "../auth/location-tree.integration.spec";

/**
 * `F2.10` / ADR 0098 decision 10 (amends ADR 0070 decision 2) — a calc
 * parameter resolves nearest-first along the asset's ancestors: asset → own
 * node → each ancestor → organization. Still one statement, still contained
 * by `cp.organization_id = a.organization_id`, and the ancestor walk carries
 * the per-step organization predicate, so a planted cross-organization edge
 * is never walked.
 *
 * **Fixtures.** The wrapper's single superuser connection (`max: 1`), one
 * transaction rolled back in `afterAll`, `buildTreeFixture`'s trees in two
 * organizations the suite creates:
 *
 *     F210-A:  R ── A ── A1 ── A1a        F210-B:  X ── X1
 *               └── B ── B1
 *
 * One asset per node. Each case inserts its own `bms.calc_parameter_keys` code
 * and its rows inside a savepoint it rolls back, so no case sees another's
 * rows. The service runs on the same connection, so it reads the
 * uncommitted rows. The superuser is what lets the planted cases switch
 * `session_replication_role` to `replica`.
 */

type Pg = {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values?: unknown[]): Promise<pg.QueryResult<R>>;
};

const EFFECTIVE_FROM = "2020-01-01T00:00:00Z";

function fail(message: string): never {
  throw new Error(message);
}

async function inSavepoint(db: Pg, name: string, run: () => Promise<void>): Promise<void> {
  await db.query(`SAVEPOINT ${name}`);
  try {
    await run();
  } finally {
    await db.query(`ROLLBACK TO SAVEPOINT ${name}`);
  }
}

async function insertKey(db: Pg, code: string): Promise<void> {
  await db.query(
    `INSERT INTO bms.calc_parameter_keys (code, label, unit, description, sort_order)
     VALUES ($1, $2, NULL, NULL, 9999)`,
    [code, `F2.10 ${code}`],
  );
}

async function insertRow(
  db: Pg,
  input: { organizationId: string; key: string; locationId: string | null; value: number },
): Promise<void> {
  await db.query(
    `INSERT INTO bms.calc_parameters (organization_id, key, location_id, value, effective_from)
     VALUES ($1, $2, $3, $4, $5)`,
    [input.organizationId, input.key, input.locationId, input.value, EFFECTIVE_FROM],
  );
}

async function resolve(svc: CalcParametersService, assetIds: readonly string[], key: string): Promise<Map<string, number>> {
  return svc.resolveForAssets(
    assetIds.map((assetId) => ({ assetId, key })),
    new Date(),
  );
}

function expectValue(values: Map<string, number>, assetId: string, key: string, expected: number | undefined, what: string): void {
  const got = values.get(inputKey(assetId, key));
  if (got !== expected) fail(`${what}: resolved ${String(got)}, expected ${String(expected)}`);
}

/** A row on campus-level A (2) serves A1a, two levels below, which has no row of its own. */
export async function aCampusRowServesADeeperAssetWithNoRowOfItsOwn(
  svc: CalcParametersService,
  db: Pg,
  fx: TreeFixture,
  run: string,
): Promise<void> {
  const key = `f210_${run}_deep`;
  await inSavepoint(db, "deep", async () => {
    await insertKey(db, key);
    await insertRow(db, { organizationId: fx.orgA, key, locationId: fx.nodes.A, value: 2 });
    expectValue(await resolve(svc, [fx.assets.A1a], key), fx.assets.A1a, key, 2, "A1a under a row on A");
  });
}

/** Rows on A (2) and A1 (3): A1a takes its nearer ancestor's 3; A takes its own 2. */
export async function theOwnNodeRowBeatsTheAncestorRow(
  svc: CalcParametersService,
  db: Pg,
  fx: TreeFixture,
  run: string,
): Promise<void> {
  const key = `f210_${run}_near`;
  await inSavepoint(db, "near", async () => {
    await insertKey(db, key);
    await insertRow(db, { organizationId: fx.orgA, key, locationId: fx.nodes.A, value: 2 });
    await insertRow(db, { organizationId: fx.orgA, key, locationId: fx.nodes.A1, value: 3 });
    const values = await resolve(svc, [fx.assets.A1a, fx.assets.A], key);
    expectValue(values, fx.assets.A1a, key, 3, "A1a with rows on A (2) and A1 (3)");
    expectValue(values, fx.assets.A, key, 2, "A with rows on A (2) and A1 (3)");
  });
}

/** An organization row (1) and a row on A (2): A1a takes the ancestor's 2; B1, outside A, takes the organization's 1. */
export async function theAncestorRowBeatsTheOrganizationRow(
  svc: CalcParametersService,
  db: Pg,
  fx: TreeFixture,
  run: string,
): Promise<void> {
  const key = `f210_${run}_org`;
  await inSavepoint(db, "org", async () => {
    await insertKey(db, key);
    await insertRow(db, { organizationId: fx.orgA, key, locationId: null, value: 1 });
    await insertRow(db, { organizationId: fx.orgA, key, locationId: fx.nodes.A, value: 2 });
    const values = await resolve(svc, [fx.assets.A1a, fx.assets.B1], key);
    expectValue(values, fx.assets.A1a, key, 2, "A1a with an organization row and a row on A");
    expectValue(values, fx.assets.B1, key, 1, "B1 with an organization row and a row on A");
  });
}

/** A row on B only: A1a, in the sibling subtree, resolves nothing; B1 under B does (the positive control). */
export async function aSiblingSubtreeRowIsNotServed(
  svc: CalcParametersService,
  db: Pg,
  fx: TreeFixture,
  run: string,
): Promise<void> {
  const key = `f210_${run}_sib`;
  await inSavepoint(db, "sib", async () => {
    await insertKey(db, key);
    await insertRow(db, { organizationId: fx.orgA, key, locationId: fx.nodes.B, value: 5 });
    const values = await resolve(svc, [fx.assets.A1a, fx.assets.B1], key);
    expectValue(values, fx.assets.B1, key, 5, "positive control: B1 under a row on B");
    expectValue(values, fx.assets.A1a, key, undefined, "A1a under a row on the sibling B");
  });
}

/**
 * The service's statement with the chain's per-step organization predicate
 * removed — the positive control for the planted edge. If it does not serve
 * the row behind the planted hop, the plant did not land.
 */
const UNGUARDED_RESOLVE = `
  WITH RECURSIVE anc (node_id, ancestor_id, parent_id, organization_id, steps) AS (
    SELECT l.id, l.id, l.parent_id, l.organization_id, 0
      FROM bms.locations l
     WHERE l.id IN (SELECT a.location_id FROM bms.assets a WHERE a.id = ANY($1::uuid[]))
    UNION
    SELECT anc.node_id, p.id, p.parent_id, p.organization_id, anc.steps + 1
      FROM bms.locations p
      JOIN anc ON p.id = anc.parent_id
     WHERE anc.steps < ${LOCATION_TREE_MAX_DEPTH}
  )
  SELECT a.id AS asset_id, s.value
    FROM bms.assets a
    CROSS JOIN LATERAL (
      SELECT cp.value
        FROM bms.calc_parameters cp
        LEFT JOIN anc ON anc.node_id = a.location_id AND anc.ancestor_id = cp.location_id
       WHERE cp.organization_id = a.organization_id
         AND cp.key = $2
         AND (cp.asset_id = a.id
              OR (cp.asset_id IS NULL AND anc.ancestor_id IS NOT NULL)
              OR (cp.asset_id IS NULL AND cp.location_id IS NULL))
       ORDER BY (cp.asset_id IS NOT NULL) DESC, (cp.location_id IS NOT NULL) DESC, anc.steps ASC
       LIMIT 1) s
   WHERE a.id = ANY($1::uuid[])`;

/**
 * Critic deadGates 1. With the foreign key and the trigger off, A (org A) is
 * hung under X (org B) and an **org-A** row is placed on X — so only the
 * per-step organization predicate stands between A1a and the value 9.
 */
export async function aPlantedCrossOrgEdgeIsNotWalked(
  svc: CalcParametersService,
  db: Pg,
  fx: TreeFixture,
  run: string,
): Promise<void> {
  const key = `f210_${run}_edge`;
  await inSavepoint(db, "edge", async () => {
    await insertKey(db, key);
    await db.query("SET LOCAL session_replication_role = replica");
    await db.query("UPDATE bms.locations SET parent_id = $1 WHERE id = $2", [fx.nodes.X, fx.nodes.A]);
    await db.query("SET LOCAL session_replication_role = origin");
    await insertRow(db, { organizationId: fx.orgA, key, locationId: fx.nodes.X, value: 9 });

    const control = await db.query<{ asset_id: string; value: number }>(UNGUARDED_RESOLVE, [[fx.assets.A1a], key]);
    if (control.rows[0]?.value !== 9) {
      fail(`positive control: the unguarded resolve for A1a returned ${JSON.stringify(control.rows)} — the plant did not land`);
    }
    expectValue(await resolve(svc, [fx.assets.A1a], key), fx.assets.A1a, key, undefined, "A1a behind the planted org-B hop");
  });
}

/** A planted cycle A → A1a inside org A: the walk stops at the bound, no 57014, and the organization row still serves. */
export async function aPlantedCycleTerminatesAndStillResolves(
  svc: CalcParametersService,
  db: Pg,
  fx: TreeFixture,
  run: string,
): Promise<void> {
  const key = `f210_${run}_cycle`;
  await db.query("SAVEPOINT cycle");
  // A 57014 kills the transaction; the rollback below would then mask it.
  let resolved = false;
  try {
    await insertKey(db, key);
    await insertRow(db, { organizationId: fx.orgA, key, locationId: null, value: 1 });
    await db.query("SET LOCAL statement_timeout = '2s'");
    await db.query("SET LOCAL session_replication_role = replica");
    await db.query("UPDATE bms.locations SET parent_id = $1 WHERE id = $2", [fx.nodes.A1a, fx.nodes.A]);
    await db.query("SET LOCAL session_replication_role = origin");
    const values = await resolve(svc, [fx.assets.A1a], key).catch((error: unknown) => {
      const code = (error as { code?: string; cause?: { code?: string } }).code ?? (error as { cause?: { code?: string } }).cause?.code;
      if (code === "57014") fail("resolveForAssets on the cycle A → A1a hit the 2 s statement_timeout (57014) — the walk lost its bound");
      throw error;
    });
    expectValue(values, fx.assets.A1a, key, 1, "A1a on the planted cycle with an organization row");
    resolved = true;
  } finally {
    await db.query("ROLLBACK TO SAVEPOINT cycle").catch((error: unknown) => {
      if (resolved) throw error;
    });
  }
}

/**
 * Security review Low 2: the anchor is the assets' (location_id, organization_id) PAIRS, not two
 * independent sets. With the foreign keys and triggers off, A1a (org A) is pointed at X (org B)
 * and an org-A row is placed on X. X1's asset (org B) is in the same batch, so org B is in the
 * batch's organizations and X is in its nodes: an anchor on two sets would start X's chain and
 * serve A1a the 7. The pair (X, A) names no row, so A1a gets no chain on X. X1's asset sits on X1,
 * not on X, so its own chain is keyed to X1 and cannot reach A1a through the join.
 */
export async function anAssetPointingAtAForeignNodeGetsNoChainThere(
  svc: CalcParametersService,
  db: Pg,
  fx: TreeFixture,
  run: string,
): Promise<void> {
  const key = `f210_${run}_pair`;
  await inSavepoint(db, "pair", async () => {
    await insertKey(db, key);
    await db.query("SET LOCAL session_replication_role = replica");
    await db.query("UPDATE bms.assets SET location_id = $1 WHERE id = $2", [fx.nodes.X, fx.assets.A1a]);
    await insertRow(db, { organizationId: fx.orgA, key, locationId: fx.nodes.X, value: 7 });
    await db.query("SET LOCAL session_replication_role = origin");

    const control = await db.query<{ asset_id: string; value: number }>(UNGUARDED_RESOLVE, [[fx.assets.A1a], key]);
    if (control.rows[0]?.value !== 7) {
      fail(`positive control: the unguarded resolve for A1a returned ${JSON.stringify(control.rows)} — the plant did not land`);
    }
    const values = await resolve(svc, [fx.assets.A1a, fx.assets.X1], key);
    expectValue(values, fx.assets.A1a, key, undefined, "A1a (org A) on X (org B), beside an org-B asset in the batch");
  });
}
