import { inArray } from "drizzle-orm";

import { locations } from "@bms/db";

import { locationAncestorChains, type TreeAnchors } from "../auth/location-tree";
import type { BmsTx } from "../database/tenant-context";

/**
 * `F2.10` — `sustainability.by_location`'s `groupDepth` (ADR 0098 decision 7, Amendment 1 A6,
 * B2, C; amends ADR 0072 decision 2). Kept out of `metric-catalog.service.ts` so that file
 * stays under the cap; the one recursive walk is `locationAncestorChains`, declared in
 * `auth/location-tree.ts` like every walk of the tree.
 */

/** One node's chain, nearest-first: steps 0 is the node itself. */
type ChainRow = { readonly ancestorId: string; readonly steps: number };

/**
 * Pure. `chain` is one node's rows nearest-first (steps 0 = the node). The target is the
 * ancestor at absolute depth `groupDepth` (root = 1, so steps = chain.length − groupDepth); a
 * node at or above that depth groups by itself (B2). If the target is unreadable, the highest
 * readable ancestor between it and the node wins (A6); the node itself is always the last
 * fallback, so a label is never an ancestor the reader cannot read. `readable === null` reads
 * everything.
 *
 * `capId` is the dashboard's own node (owner ruling P1, 2026-10-09): the target never goes above
 * it, so on a site dashboard depth 1 labels the site, not the campus over it — a row never names
 * a node wider than the value it carries. A6 then searches from the capped target down. `null`
 * (a group-tab or asset dashboard, or a non-location scope) caps nothing. A cap that is not on
 * the chain means the node is outside the dashboard's subtree, and it groups by itself.
 *
 * An empty chain names no node and is refused: the caller maps such a node to itself.
 */
export function groupNodeFor(
  chain: readonly ChainRow[],
  groupDepth: number,
  readable: ReadonlySet<string> | null,
  capId: string | null,
): string {
  const ordered = [...chain].sort((a, b) => a.steps - b.steps);
  const node = ordered[0];
  if (node === undefined) {
    throw new Error("groupNodeFor: an empty chain names no node");
  }
  const capSteps = capId === null ? ordered.length : ordered.findIndex((row) => row.ancestorId === capId);
  // A cap off the chain is `findIndex`'s −1, so the min is ≤ 0 and the node groups by itself.
  const targetSteps = Math.min(ordered.length - groupDepth, capSteps);
  if (targetSteps <= 0) {
    return node.ancestorId;
  }
  for (let steps = targetSteps; steps >= 1; steps -= 1) {
    const candidate = ordered[steps];
    if (candidate !== undefined && (readable === null || readable.has(candidate.ancestorId))) {
      return candidate.ancestorId;
    }
  }
  return node.ancestorId;
}

/** A group node's label — the columns a `by_location` row carries. */
export type GroupNode = { readonly id: string; readonly code: string; readonly name: string };

/**
 * Maps every one of `locations.ids` to its group node, never above `capId` (the dashboard's own
 * node, `groupNodeFor`): `locationAncestorChains(tx, locations)` once — anchored in
 * `locations.organizationIds`, the dashboard's organization (owner ruling P3) —
 * `groupNodeFor` per node, then one `bms.locations` read on `tx` for the labels. The labels are
 * of nodes the reader can read or owns in scope, never an unreadable ancestor's (Drafter
 * choice 8's rule applied here). On `tx`, so under RLS: a node or ancestor of another
 * organization is invisible and the per-step organization predicate stops the walk at it.
 *
 * A node with no chain row, or whose group's label did not come back, maps to itself; a node
 * whose own label did not come back is left out (the caller's location read found it, so this
 * is a concurrent delete, and the row would have no label to show).
 */
export async function groupLocationsAtDepth(
  tx: BmsTx,
  anchors: TreeAnchors,
  groupDepth: number,
  readable: ReadonlySet<string> | null,
  capId: string | null,
): Promise<Map<string, GroupNode>> {
  const locationIds = anchors.ids;
  if (locationIds.length === 0) {
    return new Map();
  }
  const chains = new Map<string, ChainRow[]>();
  for (const row of await locationAncestorChains(tx, anchors)) {
    const chain = chains.get(row.nodeId) ?? [];
    chain.push({ ancestorId: row.ancestorId, steps: row.steps });
    chains.set(row.nodeId, chain);
  }
  const groupOf = new Map<string, string>();
  for (const id of locationIds) {
    const chain = chains.get(id);
    groupOf.set(id, chain === undefined || chain.length === 0 ? id : groupNodeFor(chain, groupDepth, readable, capId));
  }

  const wanted = [...new Set([...locationIds, ...groupOf.values()])];
  const labels = await tx
    .select({ id: locations.id, code: locations.code, name: locations.name })
    .from(locations)
    .where(inArray(locations.id, wanted));
  const labelOf = new Map(labels.map((label) => [label.id, label]));

  const grouped = new Map<string, GroupNode>();
  for (const id of locationIds) {
    const group = labelOf.get(groupOf.get(id) ?? id) ?? labelOf.get(id);
    if (group !== undefined) grouped.set(id, group);
  }
  return grouped;
}
