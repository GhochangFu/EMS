import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";

import type { BmsDb } from "@bms/db";
import type { CalcCrossRef, CalcDialect } from "@bms/shared";

import { FLEET_DRIZZLE } from "../database/database.tokens";
import { inputKey } from "./calc-batch";
import { CalcDefinitionsService } from "./calc-definitions.service";
import { buildCalcGraph, topologicalOrder } from "./calc-graph";
import type { AssetId, GraphDefinition, NodeId } from "./calc-graph";
import { CalcScopeService } from "./calc-scope.service";

/**
 * A formula an author is trying to save, in the shape the graph needs. Not a
 * `CalcDefinition`: nothing has been stored yet, and the row it would become
 * may not exist.
 *
 * `dialect` is carried and **not branched on**. The graph is dialect-agnostic
 * by construction — it joins nodes through `refs` and `crossRefs`, and a `v1`
 * parse simply yields no `crossRefs` (plan design decision 3). Deciding *when*
 * to ask belongs to the caller, which knows the merged dialect of the pair it
 * is about to write; a second dialect gate in here would be a guard that gates
 * nothing and would split one decision across two files.
 */
export type CalcCandidate = {
  readonly assetId: string;
  readonly pointKey: string;
  readonly templatePointId: string;
  readonly dialect: CalcDialect;
  /** The formula's cross-asset nodes — `ParseResult.crossRefs`. */
  readonly crossRefs: readonly CalcCrossRef[];
  /** The formula's local `{ref}`s — `ParseResult.refs`. */
  readonly localRefs: readonly string[];
};

/**
 * One point on the cycle the candidate would close.
 *
 * The asset's **code**, never its id, and **never the formula**: a stored
 * formula is pre-authorship tenant content, and this value is surfaced verbatim
 * to the caller in an error message (ADR 0037's logging discipline, the same
 * rule `CalcParseError` carries).
 */
export type CalcCycleMember = { readonly assetCode: string; readonly pointKey: string };

/**
 * The **save-time** half of ADR 0055 decision 8: before a `bms-calc-v2` formula
 * is stored, would it close a dependency cycle?
 *
 * Decision 7 repealed "a derived formula may only reference measured points"
 * for `v2`, so the reference is no longer what a save can refuse — a site total
 * reads derived points by construction. The cycle is. And a cycle is not a
 * property of the formula in front of the author: it can be closed by an
 * asset's membership of a site or a group, which no pure check on one request
 * can see. So this service builds the **real** graph, with the same builder and
 * the same sort the sweep uses (decision 8's "one builder", machine-held by
 * `tests/adr-0055-calc-v2-invariants.test.ts` part (a)).
 *
 * **What it is not.** It is not the authority. Decision 8 puts that on the
 * tick: membership changes with no save at all — an asset joins a group, a new
 * asset is instantiated at the site — so a graph that is acyclic when this runs
 * can be cyclic an hour later. `CalcSchedulerService` refuses those as
 * `dependency_cycle` at evaluation time. This exists to stop the author who can
 * see the loop from storing it anyway.
 *
 * **Only members are reported** (plan design decision 7, the owner's Q6
 * ruling): a formula *downstream* of a cycle is not on it and must save.
 */
@Injectable()
export class CalcDependencyService {
  constructor(
    // The two reads are cross-organization by nature — a cycle can run through
    // any asset at the owner's location, and `CalcDefinitionsService` is
    // already a fleet-wide cache (Amendment 2/3). Both callers stand behind
    // their own access gate on the asset being written.
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    private readonly definitions: CalcDefinitionsService,
    private readonly scope: CalcScopeService,
  ) {}

  /**
   * The cycle `candidate` would lie on, or an empty list.
   *
   * Four steps, in this order for reasons that are not interchangeable:
   *
   * 1. `getAllDefinitionsFresh()` — **past** the 60s cache. A definition
   *    written in the last minute would otherwise be invisible, and the
   *    detector would admit the very edge that closes the loop. That read is
   *    also the one that must not move `bms_api_calc_skipped_total`
   *    (finding 30) — the exemption lives in `CalcDefinitionsService`.
   * 2. the candidate **replaces** the stored definition for its own
   *    `(assetId, pointKey)`, or is appended when none exists.
   *    `buildCalcGraph` keeps the first node it sees for an id and drops the
   *    rest, so appending beside the stored row would silently check the
   *    stored formula instead of the one being saved.
   * 3. membership, then the graph, then the sort.
   * 4. the members of the cycle **the candidate is on** — nodes it can reach
   *    that can reach it back. A node the candidate merely reads, or one that
   *    merely reads the candidate, is on no cycle with it and is not reported.
   *
   * @param candidate the formula about to be written, already parsed
   * @returns each point on the candidate's cycle, the candidate included;
   *   empty when the merged graph is acyclic through it
   */
  async checkCandidate(candidate: CalcCandidate): Promise<CalcCycleMember[]> {
    const stored = await this.definitions.getAllDefinitionsFresh();

    const candidateDefinition: GraphDefinition = {
      assetId: candidate.assetId,
      pointKey: candidate.pointKey,
      templatePointId: candidate.templatePointId,
      refs: [...candidate.localRefs],
      crossRefs: [...candidate.crossRefs],
    };
    const candidateId = inputKey(candidate.assetId, candidate.pointKey);

    let replaced = false;
    const defs: GraphDefinition[] = stored.map((def) => {
      if (inputKey(def.assetId, def.pointKey) !== candidateId) {
        return def;
      }
      replaced = true;
      return candidateDefinition;
    });
    if (!replaced) {
      defs.push(candidateDefinition);
    }

    const membership = await this.scope.resolveMembership(defs);
    const graph = buildCalcGraph(defs, membership);
    const { cyclic } = topologicalOrder(graph);
    if (!cyclic.has(candidateId)) {
      return [];
    }

    const reachedByCandidate = reachableFrom(candidateId, graph.dependsOn);
    const members = graph.nodes.filter(
      (node) =>
        cyclic.has(node.id) &&
        reachedByCandidate.has(node.id) &&
        reachableFrom(node.id, graph.dependsOn).has(candidateId),
    );

    const codeByAsset = await this.readAssetCodes([...new Set(members.map((node) => node.assetId))]);
    return members.map((node) => ({
      // The id is the fallback only for an asset deleted between the
      // definition read and this one — it names nothing an operator can act
      // on, but it is not a formula and it is not silence.
      assetCode: codeByAsset.get(node.assetId) ?? node.assetId,
      pointKey: node.pointKey,
    }));
  }

  /** `bms.assets.code` for the reported members only — one batched read, and
   * only on the path that has already found a cycle. */
  private async readAssetCodes(assetIds: readonly AssetId[]): Promise<Map<AssetId, string>> {
    if (assetIds.length === 0) {
      return new Map();
    }
    const result = await this.fleetDb.execute<{ id: string; code: string }>(
      sql`SELECT id, code
            FROM bms.assets
           WHERE id = ANY(${sql.param(assetIds)}::uuid[])`,
    );
    return new Map(result.rows.map((row) => [row.id, row.code]));
  }
}

/**
 * Every node reachable from `start` along one or more `dependsOn` edges.
 *
 * Private, and deliberately a copy of the walk `calc-graph.ts` uses for
 * `templateCycles`: it is four lines of traversal over a plain map, not a
 * second implementation of the builder or the sort that decision 8 requires be
 * singular. Widening `calc-graph.ts`'s exports to share it would put a helper
 * on the module's public surface for one caller.
 *
 * **Seeded with `start`'s own dependencies, never with `start` itself** — that
 * is what makes a self-loop detectable, and it is what puts the candidate in
 * its own member list rather than leaving it out.
 */
function reachableFrom(start: NodeId, dependsOn: ReadonlyMap<NodeId, ReadonlySet<NodeId>>): Set<NodeId> {
  const seen = new Set<NodeId>();
  const stack: NodeId[] = [...(dependsOn.get(start) ?? [])];
  while (stack.length > 0) {
    const id = stack.pop() as NodeId;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const dep of dependsOn.get(id) ?? []) {
      if (!seen.has(dep)) stack.push(dep);
    }
  }
  return seen;
}
