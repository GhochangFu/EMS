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
 * - **the organization predicate on the anchor AND on the recursive term**
 *   (Security 2; owner ruling P3, 2026-10-09). The anchor keeps only the
 *   starting nodes inside the organizations the caller's own authority names
 *   (`TreeAnchors.organizationIds`), so a node id from another tenant starts
 *   nothing. The recursive term's `c.organization_id = t.organization_id`
 *   keeps every later step in the anchor's organization even if the
 *   composite foreign key were missing. Either alone is not enough: a
 *   predicate on the anchor alone filters the start and then walks any edge
 *   the data holds (the tripwire's assertion 6 plants exactly that edge with
 *   the foreign key switched off), and the recursive term alone starts
 *   wherever the id points;
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
 * Where a walk may start: the node ids, and the organizations they must lie in.
 *
 * **`organizationIds` is always server-authorized**: the tenant transaction's
 * organization (even when the request named it — the locations create path
 * passes `body.organizationId` only after `canManageOrganization` accepted it,
 * and its transaction is opened for that organization), the organizations of
 * the caller's own grant rows, or the organizations the caller reads. An
 * organization id the server did not authorize would let the client name the
 * bound it is bounded by. Empty means "no organization", and the walk answers
 * nothing without a query.
 */
export type TreeAnchors = { readonly organizationIds: readonly string[]; readonly ids: readonly string[] };

/** One starting node and its organization bound — `TreeAnchors` for the single-node walks. */
export type TreeAnchor = { readonly organizationIds: readonly string[]; readonly id: string };

/**
 * The ids of `anchors.ids` and every descendant — the subtree closure a grant
 * means since ADR 0018 — any `active`, roots included, in no particular
 * order and without duplicates. `[]` for no ids or no organizations; an id
 * that names no row, or a row outside `anchors.organizationIds`, contributes
 * nothing.
 */
export async function expandLocationSubtrees(db: TreeExecutor, anchors: TreeAnchors): Promise<string[]> {
  if (anchors.ids.length === 0 || anchors.organizationIds.length === 0) {
    return [];
  }
  const result = await db.execute<{ id: string }>(sql`
    WITH RECURSIVE subtree (id, organization_id, depth) AS (
      SELECT l.id, l.organization_id, 1
        FROM bms.locations l
       WHERE l.id = ANY(${sql.param([...anchors.ids])}::uuid[])
         AND l.organization_id = ANY(${sql.param([...anchors.organizationIds])}::uuid[])
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
 * its organization. `[]` when `anchor.id` names no row in
 * `anchor.organizationIds`. On a cycle the walk stops at the depth bound
 * rather than looping.
 */
export async function locationAncestors(
  db: TreeExecutor,
  anchor: TreeAnchor,
): Promise<Array<{ id: string; organizationId: string; depth: number }>> {
  if (anchor.organizationIds.length === 0) {
    return [];
  }
  const result = await db.execute<{ id: string; organization_id: string; depth: number }>(sql`
    WITH RECURSIVE up (id, organization_id, parent_id, depth) AS (
      SELECT l.id, l.organization_id, l.parent_id, 0
        FROM bms.locations l
       WHERE l.id = ${anchor.id}
         AND l.organization_id = ANY(${sql.param([...anchor.organizationIds])}::uuid[])
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
 * `anchor.id` names no row in `anchor.organizationIds`. Two statements, one
 * recursive CTE each: the ancestor walk gives the depth, the descendant walk
 * the height. The locations admin service's placement check adds the two
 * across the proposed edge and compares with `LOCATION_TREE_MAX_DEPTH`.
 */
export async function locationDepthAndHeight(
  db: TreeExecutor,
  anchor: TreeAnchor,
): Promise<{ depth: number; height: number } | null> {
  if (anchor.organizationIds.length === 0) {
    return null;
  }
  const organizationIds = sql.param([...anchor.organizationIds]);
  const depth = await db.execute<{ depth: number | string | null }>(sql`
    WITH RECURSIVE up (id, organization_id, parent_id, depth) AS (
      SELECT l.id, l.organization_id, l.parent_id, 1
        FROM bms.locations l
       WHERE l.id = ${anchor.id}
         AND l.organization_id = ANY(${organizationIds}::uuid[])
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
       WHERE l.id = ${anchor.id}
         AND l.organization_id = ANY(${organizationIds}::uuid[])
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
 * steps)` prefix: for every `(node id, organization id)` pair `anchors.pairs`
 * yields that names a row, the node itself at `steps` 0, then each ancestor
 * nearest-first. The same anchor and per-step organization predicates,
 * `UNION` and depth bound as every walk here, so a node paired with an
 * organization that does not hold it starts no chain, a planted
 * cross-organization edge stops the chain and a cycle stops at the bound.
 *
 * `anchors.pairs` is SQL that yields two uuid columns, node then organization.
 * The calc walk passes each asset's own `(location_id, organization_id)`, so an
 * asset's node is bounded by that asset's organization — not by the set of
 * every organization in the batch (security review Low 2). `locationAncestorChains`
 * passes the cross product of its ids and its organizations. The caller
 * appends its own `SELECT` that reads `anc` in the same statement — ADR 0098
 * decision 10's calc walk is one statement, and the sustainability grouping
 * reads hundreds of chains in one.
 *
 * The chains are keyed by `node_id` alone: two assets on one node share its
 * chain, whatever their organizations. The calc statement's
 * `cp.organization_id = a.organization_id` is what keeps a parameter row in
 * its asset's organization.
 */
export function ancestorChainsCte(anchors: { readonly pairs: SQL }): SQL {
  return sql`
    WITH RECURSIVE anc (node_id, ancestor_id, parent_id, organization_id, steps) AS (
      SELECT l.id, l.id, l.parent_id, l.organization_id, 0
        FROM bms.locations l
       WHERE (l.id, l.organization_id) IN (${anchors.pairs})
      UNION
      SELECT anc.node_id, p.id, p.parent_id, p.organization_id, anc.steps + 1
        FROM bms.locations p
        JOIN anc ON p.id = anc.parent_id AND p.organization_id = anc.organization_id
       WHERE anc.steps < ${LOCATION_TREE_MAX_DEPTH}
    )`;
}

/**
 * Each of `anchors.ids` at `steps` 0, then its ancestors nearest-first,
 * ordered by node then steps — one statement for any number of nodes. `[]`
 * for no ids or no organizations without a query; an id that names no row in
 * `anchors.organizationIds` contributes nothing.
 */
export async function locationAncestorChains(
  db: TreeExecutor,
  anchors: TreeAnchors,
): Promise<Array<{ nodeId: string; ancestorId: string; organizationId: string; steps: number }>> {
  if (anchors.ids.length === 0 || anchors.organizationIds.length === 0) {
    return [];
  }
  const result = await db.execute<{ node_id: string; ancestor_id: string; organization_id: string; steps: number | string }>(sql`
    ${ancestorChainsCte({
      pairs: sql`SELECT n.id, o.id
                   FROM unnest(${sql.param([...anchors.ids])}::uuid[]) AS n(id)
                  CROSS JOIN unnest(${sql.param([...anchors.organizationIds])}::uuid[]) AS o(id)`,
    })}
    SELECT node_id, ancestor_id, organization_id, steps FROM anc ORDER BY node_id, steps`);
  return result.rows.map((row) => ({
    nodeId: row.node_id,
    ancestorId: row.ancestor_id,
    organizationId: row.organization_id,
    steps: Number(row.steps),
  }));
}
