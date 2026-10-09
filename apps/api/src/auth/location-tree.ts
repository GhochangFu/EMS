import { type SQL, sql } from "drizzle-orm";

import type { BmsDb } from "@bms/db";
import { LOCATION_TREE_MAX_DEPTH } from "@bms/shared";

import type { BmsTx } from "../database/tenant-context";

export { LOCATION_TREE_MAX_DEPTH } from "@bms/shared";

/**
 * `F2.10` / ADR 0098 decision 4 and *Security* 2–3 — the only recursive CTEs
 * over `bms.locations` in `apps/api`: five statements, the fifth
 * (`ancestorChainsCte`) a fragment that callers embed in their own statement
 * so a batched ancestor walk never needs a second `WITH RECURSIVE` elsewhere.
 * `tests/f2.10-recursive-cte-invariants.test.ts` pins their count to this file
 * and checks each one's shape:
 *
 * - **one `WITH RECURSIVE` per statement, joined by `UNION`** — never
 *   `UNION ALL`, so a cycle the trigger failed to refuse cannot double every
 *   row until the bound stops it;
 * - **the organization predicate on the recursive term** — `c.organization_id
 *   = t.organization_id`, so a step never crosses an edge into another
 *   tenant even if the composite foreign key were missing. A predicate on the
 *   anchor alone would filter the start and then walk any edge the data
 *   holds (the tripwire's assertion 6 plants exactly that edge with the
 *   foreign key switched off);
 * - **the depth bound `< LOCATION_TREE_MAX_DEPTH`** on the recursive term, so
 *   every walk returns in at most that many steps whatever the data holds.
 *
 * Every function takes the caller's executor: `fleetDb` for pre-tenant scope
 * resolution (`access-control.service.ts`, `access-scope-sources.ts`), or the
 * tenant transaction the locations admin service already holds. Nothing here
 * opens a connection or sets a GUC; the caller's handle is the isolation
 * control, as everywhere else in this module (ADR 0043 Amendment 2/3).
 */

/** A drizzle handle that can run a raw statement: a pool database or a transaction. */
export type TreeExecutor = Pick<BmsDb, "execute"> | Pick<BmsTx, "execute">;

/**
 * The ids of `rootIds` and every descendant — the subtree closure a grant
 * means since ADR 0018 — any `active`, roots included, in no particular
 * order and without duplicates. `[]` for `[]`, and an id that names no row
 * contributes nothing.
 */
export async function expandLocationSubtrees(
  db: TreeExecutor,
  rootIds: readonly string[],
): Promise<string[]> {
  if (rootIds.length === 0) {
    return [];
  }
  const result = await db.execute<{ id: string }>(sql`
    WITH RECURSIVE subtree (id, organization_id, depth) AS (
      SELECT l.id, l.organization_id, 1
        FROM bms.locations l
       WHERE l.id = ANY(${sql.param([...rootIds])}::uuid[])
      UNION
      SELECT c.id, c.organization_id, subtree.depth + 1
        FROM bms.locations c
        JOIN subtree ON c.parent_id = subtree.id AND c.organization_id = subtree.organization_id
       WHERE subtree.depth < ${LOCATION_TREE_MAX_DEPTH}
    )
    SELECT DISTINCT id FROM subtree`);
  return result.rows.map((row) => row.id);
}

/**
 * The node itself at `depth` 0, then its ancestors nearest-first, each with
 * its organization. `[]` when `locationId` names no row. On a cycle the walk
 * stops at the depth bound rather than looping.
 */
export async function locationAncestors(
  db: TreeExecutor,
  locationId: string,
): Promise<Array<{ id: string; organizationId: string; depth: number }>> {
  const result = await db.execute<{ id: string; organization_id: string; depth: number }>(sql`
    WITH RECURSIVE up (id, organization_id, parent_id, depth) AS (
      SELECT l.id, l.organization_id, l.parent_id, 0
        FROM bms.locations l
       WHERE l.id = ${locationId}
      UNION
      SELECT p.id, p.organization_id, p.parent_id, up.depth + 1
        FROM bms.locations p
        JOIN up ON p.id = up.parent_id AND p.organization_id = up.organization_id
       WHERE up.depth < ${LOCATION_TREE_MAX_DEPTH}
    )
    SELECT id, organization_id, depth FROM up ORDER BY depth`);
  return result.rows.map((row) => ({
    id: row.id,
    organizationId: row.organization_id,
    depth: Number(row.depth),
  }));
}

/**
 * The node's `depth` (a root is 1) and `height` (a leaf is 1), or `null` when
 * `locationId` names no row. Two statements, one recursive CTE each: the
 * ancestor walk gives the depth, the descendant walk the height. The
 * locations admin service's placement check adds the two across the proposed
 * edge and compares with `LOCATION_TREE_MAX_DEPTH`.
 */
export async function locationDepthAndHeight(
  db: TreeExecutor,
  locationId: string,
): Promise<{ depth: number; height: number } | null> {
  const depth = await db.execute<{ depth: number | string | null }>(sql`
    WITH RECURSIVE up (id, organization_id, parent_id, depth) AS (
      SELECT l.id, l.organization_id, l.parent_id, 1
        FROM bms.locations l
       WHERE l.id = ${locationId}
      UNION
      SELECT p.id, p.organization_id, p.parent_id, up.depth + 1
        FROM bms.locations p
        JOIN up ON p.id = up.parent_id AND p.organization_id = up.organization_id
       WHERE up.depth < ${LOCATION_TREE_MAX_DEPTH}
    )
    SELECT max(depth) AS depth FROM up`);
  const depthValue = depth.rows[0]?.depth;
  if (depthValue === null || depthValue === undefined) {
    return null;
  }
  const height = await db.execute<{ height: number | string | null }>(sql`
    WITH RECURSIVE down (id, organization_id, height) AS (
      SELECT l.id, l.organization_id, 1
        FROM bms.locations l
       WHERE l.id = ${locationId}
      UNION
      SELECT c.id, c.organization_id, down.height + 1
        FROM bms.locations c
        JOIN down ON c.parent_id = down.id AND c.organization_id = down.organization_id
       WHERE down.height < ${LOCATION_TREE_MAX_DEPTH}
    )
    SELECT max(height) AS height FROM down`);
  const heightValue = height.rows[0]?.height;
  return { depth: Number(depthValue), height: Number(heightValue ?? 1) };
}

/**
 * A `WITH RECURSIVE anc (node_id, ancestor_id, parent_id, organization_id,
 * steps)` prefix: for every node `nodeIds` yields, the node itself at
 * `steps` 0, then each ancestor nearest-first. The same per-step organization
 * predicate, `UNION` and depth bound as every walk here, so a planted
 * cross-organization edge stops the chain and a cycle stops at the bound.
 *
 * `nodeIds` is any SQL that yields one uuid column (`SELECT unnest(…)`, or a
 * subquery over `bms.assets`). The caller appends its own `SELECT` that reads
 * `anc` in the same statement — ADR 0098 decision 10's calc walk is one
 * statement, and the sustainability grouping reads hundreds of chains in one.
 */
export function ancestorChainsCte(nodeIds: SQL): SQL {
  return sql`
    WITH RECURSIVE anc (node_id, ancestor_id, parent_id, organization_id, steps) AS (
      SELECT l.id, l.id, l.parent_id, l.organization_id, 0
        FROM bms.locations l
       WHERE l.id IN (${nodeIds})
      UNION
      SELECT anc.node_id, p.id, p.parent_id, p.organization_id, anc.steps + 1
        FROM bms.locations p
        JOIN anc ON p.id = anc.parent_id AND p.organization_id = anc.organization_id
       WHERE anc.steps < ${LOCATION_TREE_MAX_DEPTH}
    )`;
}

/**
 * Each of `nodeIds` at `steps` 0, then its ancestors nearest-first, ordered by
 * node then steps — one statement for any number of nodes. `[]` for `[]`
 * without a query; an id that names no row contributes nothing.
 */
export async function locationAncestorChains(
  db: TreeExecutor,
  nodeIds: readonly string[],
): Promise<Array<{ nodeId: string; ancestorId: string; organizationId: string; steps: number }>> {
  if (nodeIds.length === 0) {
    return [];
  }
  const result = await db.execute<{ node_id: string; ancestor_id: string; organization_id: string; steps: number | string }>(sql`
    ${ancestorChainsCte(sql`SELECT unnest(${sql.param([...nodeIds])}::uuid[])`)}
    SELECT node_id, ancestor_id, organization_id, steps FROM anc ORDER BY node_id, steps`);
  return result.rows.map((row) => ({
    nodeId: row.node_id,
    ancestorId: row.ancestor_id,
    organizationId: row.organization_id,
    steps: Number(row.steps),
  }));
}
