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
 *
 * **The two detectors share a builder and a sort, and are fed different node
 * sets. Written down because part (a) cannot see it** (PR 2 review fix 8).
 * Decision 8's "one builder" is machine-held by
 * `tests/adr-0055-calc-v2-invariants.test.ts` part (a) — but that scan reads
 * *source structure*, so it is blind to what each caller passes in. The sweep
 * builds from `getScheduledDefinitions()`; this service builds from
 * `getAllDefinitionsFresh()`, which is every active definition. The difference
 * is therefore exactly the **streaming** definitions.
 *
 * It cannot matter today, and the reason is a conjunction rather than a
 * coincidence: a streaming definition is `bms-calc-v1` by construction —
 * `toActiveDefinition` refuses `streaming_on_v2` — so it carries no
 * `crossRefs`, and its local `refs` cannot name a derived sibling either,
 * because `referencesADerivedSiblingUnderV1` filters those out of the cache
 * before either caller sees them. Every extra node this service holds is
 * therefore isolated: it draws no edge in and no edge out, and cannot join,
 * break or extend a cycle.
 *
 * **What would break it.** Repealing `streaming_on_v2`, or letting a `v1`
 * formula reference a derived point, would make those nodes edge-bearing at
 * once — and then this detector would answer a question about a graph the
 * sweep never evaluates, in the direction that is hardest to see: it would
 * refuse a save for a cycle that runs through a streaming node the tick would
 * never place on one. The fix at that point is to feed both from one selector,
 * not to widen this note. Decision 8 exists to stop precisely this drift, which
 * is why the difference is recorded here rather than left to be rediscovered.
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
   * The cycle each candidate would lie on — **one fleet-wide read for the whole
   * batch**, whatever its size.
   *
   * Four steps, in this order for reasons that are not interchangeable:
   *
   * 1. `getAllDefinitionsFresh()` — **past** the 60s cache. A definition
   *    written in the last minute would otherwise be invisible, and the
   *    detector would admit the very edge that closes the loop. That read is
   *    also the one that must not move `bms_api_calc_skipped_total`
   *    (finding 30) — the exemption lives in `CalcDefinitionsService`.
   * 2. each candidate **replaces** the stored definition for its own
   *    `(assetId, pointKey)`, or is appended when none exists.
   *    `buildCalcGraph` keeps the first node it sees for an id and drops the
   *    rest, so appending beside the stored row would silently check the
   *    stored formula instead of the one being saved.
   * 3. membership, then the graph, then the sort.
   * 4. the members of the cycle **the candidate is on** — nodes it can reach
   *    that can reach it back. A node the candidate merely reads, or one that
   *    merely reads the candidate, is on no cycle with it and is not reported.
   *
   * **Why the batch form exists.** Steps 1 and 3 are both `O(estate)`: a
   * fleet-wide definition reload with a parse per definition, then three
   * fleet-wide membership queries over the whole definition set. Template
   * migration checks one candidate per migrating asset that carries a
   * `computed` override, so running the two per candidate makes a batch of `N`
   * assets cost `N` fleet-wide reads — quadratic in a growing estate, not
   * merely slow at today's size.
   *
   * **What is shared, and why sharing it is safe.** The definition read and the
   * membership resolution, and nothing else.
   *
   * Membership is resolved over the **union** of the stored definitions and
   * every candidate, so no candidate's own cross references are missing from
   * the map. That union is a *superset* of what any one candidate's own
   * resolution would produce, and a superset is consulted identically:
   * `resolveMembership` keys its answers by owner asset and by the reference
   * itself, and each answer is a pure function of the owner's location and that
   * reference alone — never of which other definitions were in the input. Two
   * definitions on one asset holding the same reference already collapse to one
   * request there. `buildCalcGraph` then looks up only the references the node
   * in front of it actually holds, so an entry a sibling candidate contributed
   * is never read, and an entry this candidate needs is the same entry it would
   * have computed alone.
   *
   * **What is deliberately not shared: the graph.** Each candidate is built
   * against the stored estate plus *itself*, never plus its siblings — one
   * graph and one sort per candidate, over the shared membership. This is not
   * an optimization left on the table; sharing it would change the answer. Two
   * candidates in one batch that read each other close a cycle **together**
   * that neither closes alone, and a shared graph would refuse both — a
   * migration refused for a loop that exists in no single write, which is the
   * opposite of the parity `asset-templates-migrate-calc.ts` claims. The
   * per-candidate build and sort are pure and in memory; the reads were the
   * cost.
   *
   * @param candidates the formulas about to be written, already parsed
   * @returns one entry per candidate, **in the caller's order** — each point on
   *   that candidate's cycle, the candidate included; empty when the merged
   *   graph is acyclic through it
   */
  async checkCandidates(candidates: readonly CalcCandidate[]): Promise<CalcCycleMember[][]> {
    if (candidates.length === 0) {
      // Before the read, not after. Most migrations carry no `v2` override at
      // all, and this service does not reload the estate to answer nothing.
      return [];
    }
    const stored = await this.definitions.getAllDefinitionsFresh();

    const candidateDefinitions: GraphDefinition[] = candidates.map((candidate) => ({
      assetId: candidate.assetId,
      pointKey: candidate.pointKey,
      templatePointId: candidate.templatePointId,
      refs: [...candidate.localRefs],
      crossRefs: [...candidate.crossRefs],
    }));
    const membership = await this.scope.resolveMembership([...stored, ...candidateDefinitions]);

    const membersByCandidate = candidates.map((candidate, index) => {
      const candidateDefinition = candidateDefinitions[index];
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

      const graph = buildCalcGraph(defs, membership);
      const { cyclic } = topologicalOrder(graph);
      if (!cyclic.has(candidateId)) {
        return [];
      }

      const reachedByCandidate = reachableFrom(candidateId, graph.dependsOn);
      return graph.nodes.filter(
        (node) =>
          cyclic.has(node.id) &&
          reachedByCandidate.has(node.id) &&
          reachableFrom(node.id, graph.dependsOn).has(candidateId),
      );
    });

    // One code lookup for the batch, and still only over the assets some
    // candidate actually reports: a batch that finds no cycle reads nothing.
    const codeByAsset = await this.readAssetCodes([
      ...new Set(membersByCandidate.flat().map((node) => node.assetId)),
    ]);
    return membersByCandidate.map((members) =>
      members.map((node) => ({
        // The id is the fallback only for an asset deleted between the
        // definition read and this one — it names nothing an operator can act
        // on, but it is not a formula and it is not silence.
        assetCode: codeByAsset.get(node.assetId) ?? node.assetId,
        pointKey: node.pointKey,
      })),
    );
  }

  /**
   * The cycle `candidate` would lie on, or an empty list — the one-candidate
   * form, for the write path that has exactly one.
   *
   * **Expressed in terms of `checkCandidates`, not written beside it.** ADR
   * 0055 decision 8's "one builder, not two implementations" is a rule about
   * this pair as much as about the graph: a save-time detector that drifted
   * from the migration-time one would admit a pair migration refuses, or refuse
   * one it admits, and neither end could see it. `PUT
   * /admin/assets/:id/calc-points/:key` has one candidate per request, so the
   * batch of one is the correct shape there and costs exactly what it did.
   *
   * @param candidate the formula about to be written, already parsed
   * @returns each point on the candidate's cycle, the candidate included;
   *   empty when the merged graph is acyclic through it
   */
  async checkCandidate(candidate: CalcCandidate): Promise<CalcCycleMember[]> {
    const [members] = await this.checkCandidates([candidate]);
    return members;
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
