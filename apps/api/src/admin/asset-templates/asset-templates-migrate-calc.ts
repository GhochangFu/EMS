import { CALC_DIALECT_V2, parseFormula } from "@bms/shared";
import type { TemplateMigrationRefusalDto } from "@bms/shared";

import type { CalcCandidate, CalcDependencyService } from "../../calc/calc-dependency.service";
import { validateMergedCalcOverride } from "../asset-points/asset-point-calc-override.schema";
import { CALC_FIELDS, calcFieldsOf, type StoredTemplatePoint } from "./template-version-delta";

/**
 * **The surviving override, re-validated before the pin moves** (`F2.9` Task
 * 12b, widened to both gates at the PR 2 review).
 *
 * A sibling module rather than more lines in `asset-templates-migrate.service.ts`
 * — that file is at AGENTS.md §4.5's 1000-line cap, and finding 19's ruling is
 * that the answer to a full file is a sibling, never a squeeze. Nothing here is
 * a new decision; it is the block that used to sit inside `buildPlan`, moved
 * whole, and it is still called from `buildPlan` **before the transaction
 * opens** — that service's contract is that every fallible decision is made
 * first.
 *
 * ADR 0039 decision 2, "no blind apply", for the one input the delta cannot
 * see. `computeTemplateVersionDelta` is pure over two arrays of *template*
 * points: a derived point's formula or dialect change lands in `derivedChanged`,
 * never in `refusals`, and an asset's override is not one of its inputs. So the
 * pin could move under a legal override and leave a pair **no code path had ever
 * validated** — a dialect-only `bms-calc-v1` override plus a target version
 * whose same point carries a `bms-calc-v2` formula merges to a `v2` formula
 * wearing a `v1` label, which is finding 34's runaway reached from the side. The
 * read-time refusals in `toActiveDefinition` and `CalcDefinitionsService.reload()`
 * bound the damage; they do not stop the migration that causes it.
 *
 * **Two gates, because `PUT /admin/assets/:id/calc-points/:key` runs two.**
 * `validateMergedCalcOverride` is that endpoint's own function and
 * `CalcDependencyService` is its own detector — imported, not
 * restated, because two copies of one rule is how they drift. The endpoint
 * calls `checkCandidate` because it has one candidate; this calls
 * `checkCandidates` because it has a batch, and the first is written in terms
 * of the second, so "the same detector" stays literally true. Re-running one of
 * the two would have been the more dangerous half-measure: it reads like parity
 * and is not. Task 13 made `v2` evaluate, so the missing gate had a live failure
 * mode — an asset holding a legal `v2` override, repointed onto a version that
 * closes a cycle through it, stops computing permanently. Counted and fail
 * closed, but stopped.
 *
 * Both gates inherit the first function's boundary: an override that states
 * neither `formula` nor `formulaDialect` does not re-parse the stored formula,
 * because a template formula that no longer validates is `toActiveDefinition`'s
 * counted skip to report, and refusing an unrelated interval override for it
 * would strand the asset.
 *
 * **What the pair of gates claims, and what it does not.** Both resolve against
 * the estate *as it stands now*, exactly as the endpoint resolves them, so the
 * honest statement is a parity one: a merged pair migration admits is a pair the
 * override endpoint would also admit at this instant, and one it refuses the
 * endpoint would refuse. That is all it is. It is **not** a claim that the
 * post-migration graph is acyclic — `CalcDefinitionsService.reload()` resolves
 * every asset through its *current* `template_id`, so the target version's own
 * derived points enter the graph only once the pin moves, and a cycle closed
 * purely between those new points and this override is invisible here. ADR 0055
 * decision 8 is why that is tolerable rather than hidden: the tick is the
 * authority, and the sweep refuses such a formula as `dependency_cycle` —
 * counted, recorded per formula instance, and visible on the asset's own page.
 */

/** The `asset_points` columns this check reads, as `buildPlan` already selects them. */
export type MigratingOverrideRow = {
  readonly sourceKind: string;
  readonly formula: string | null;
  readonly formulaDialect: string | null;
  readonly calcTrigger: string | null;
  readonly calcIntervalSeconds: number | null;
  readonly maxInputAgeSeconds: number | null;
};

/** One migrating asset and its existing `asset_points` rows, keyed by point key. */
export type MigratingAssetOverrides = {
  readonly assetId: string;
  readonly assetCode: string;
  readonly rows: ReadonlyMap<string, MigratingOverrideRow>;
};

export type OverrideSurvivalInput = {
  readonly assets: readonly MigratingAssetOverrides[];
  /** The **target** version's points — the declaration the merged pair resolves against. */
  readonly targetPoints: readonly StoredTemplatePoint[];
  /**
   * `template_points.id` by point key, for the target version. The graph node
   * the detector builds carries it; `loadPoints` deliberately projects only the
   * shape `computeTemplateVersionDelta` reads, and the id is not part of it.
   */
  readonly targetPointIdsByKey: ReadonlyMap<string, string>;
  readonly targetVersion: number;
  /**
   * The **batch** entry point, never the single one. Every step this gate needs
   * from the detector is fleet-wide — the definition reload and the membership
   * resolution are each `O(estate)` — so one call per override row makes a
   * migration cost `O(assets × estate)`. `checkCandidates` performs both once
   * for the whole batch; see its docblock for what it shares and what it
   * refuses to share.
   */
  readonly dependencies: Pick<CalcDependencyService, "checkCandidates">;
  /** `buildPlan`'s own capped collector — the count keeps rising after the list stops. */
  readonly refuse: (refusal: TemplateMigrationRefusalDto) => void;
};

/**
 * One decision the row-order pass has already reached: a refusal ready to
 * emit, or a candidate whose refusal waits on the batched cycle check.
 *
 * **Held in one ordered list rather than emitted in two passes**, because
 * `refuse` is capped at `MAX_REPORTED_REFUSALS`: emitting every gate-one
 * refusal first and every gate-two refusal after would change *which* refusals
 * a capped batch reports, so the operator would read a different list for the
 * same migration. The order here is the order the nested loop reaches them,
 * which is the order the per-row `await` used to emit them in.
 */
type PlannedOutcome =
  | { readonly kind: "refuse"; readonly refusal: TemplateMigrationRefusalDto }
  | {
      readonly kind: "cycle-check";
      readonly assetCode: string;
      readonly pointKey: string;
      /** Index into the batch handed to `checkCandidates`, whose answers come back in order. */
      readonly candidateIndex: number;
    };

export async function refuseOverridesThatDoNotSurvive(input: OverrideSurvivalInput): Promise<void> {
  const { targetPoints, targetVersion, refuse } = input;
  const targetDerived = new Map(
    targetPoints.filter((point) => point.kind === "derived").map((point) => [point.pointKey, point]),
  );
  const declared = {
    // Measured only for `v1`, every declared key for `v2` — ADR 0055 decision
    // 7, picked between by the function itself.
    measured: targetPoints.filter((point) => point.kind === "measured").map((p) => p.pointKey),
    all: targetPoints.map((point) => point.pointKey),
  };

  // Pass one — every decision that needs no fleet read, in row order. A refusal
  // is recorded rather than emitted, and a candidate is queued rather than
  // checked; pass two below emits the whole list in exactly this order.
  const planned: PlannedOutcome[] = [];
  const candidates: CalcCandidate[] = [];

  for (const asset of input.assets) {
    for (const [pointKey, row] of asset.rows) {
      // **`source_kind`, not the all-null guard below** (PR 2 review fix 6).
      // The calc columns belong only to a `computed` row, and
      // `CalcDefinitionsService.reload()`'s own left join says in as many words
      // why it refuses to lean on the all-null accident instead: a
      // `measured`/`unmapped` row carries NULL across the five columns today,
      // so the guard happens to give the same answer — but only by accident,
      // and the accident is one write away.
      //
      // Filtered here rather than in `buildPlan`'s read, because that read is
      // shared: the collision check beside it needs every `source_kind` and
      // names `measured`/`unmapped` in its refusal message. Narrowing the query
      // would delete that refusal silently.
      if (row.sourceKind !== "computed") {
        continue;
      }
      const declaredPoint = targetDerived.get(pointKey);
      if (declaredPoint === undefined) {
        // The target version does not declare this key as derived. Nothing
        // merges, so there is nothing to validate — a measured collision is
        // `buildPlan`'s own refusal, and a key the version drops is the delta's.
        continue;
      }
      const override = calcFieldsOf(row);
      if (CALC_FIELDS.every((field) => override[field] === null)) {
        // Five NULLs is exactly what "no override" means (the row survives a
        // clear). Such an asset inherits the target version whole, which is the
        // migration working as designed, and validating the template against
        // itself here would refuse assets for a defect that belongs to the
        // version author.
        continue;
      }

      const problems = validateMergedCalcOverride(override, calcFieldsOf(declaredPoint), declared);
      if (problems.length > 0) {
        planned.push({
          kind: "refuse",
          refusal: {
            reason: "calc_override_invalid_on_target",
            pointKey,
            assetCount: 1,
            message:
              `Asset "${asset.assetCode}": its calc override on derived point "${pointKey}" does ` +
              `not survive the move to version ${targetVersion}. ${problems.join(" ")} An override ` +
              "states only the columns it sets and inherits the rest, so a new version's formula " +
              "or dialect can turn a pair that was legal when it was written into one this engine " +
              "will not run. Migration refuses it rather than repointing the asset and leaving it " +
              "to be discovered as a skipped calculation (ADR 0039 decision 2). Clear or correct " +
              "the override first, then migrate.",
          },
        });
        continue;
      }

      // **Gate two, gated exactly as the endpoint gates it** — on the MERGED
      // dialect and the MERGED formula, never on the override's own columns. An
      // override that states the formula alone inherits the target's `v2`
      // label, and one that states neither still merges to a `v2` pair; testing
      // the override's own column would skip the check on precisely the rows
      // that need it, which is the shape finding 33 exists to name.
      //
      // No condition beyond the endpoint's — in particular no "only when the
      // formula has cross references", because a `v2` formula closes a cycle
      // through its local refs alone just as well, and any narrowing here is a
      // divergence from the endpoint that no test would see.
      //
      // A merged formula that does not parse falls through to the read-time
      // counted skip: there is no graph node for a formula the engine cannot
      // read.
      const mergedDialect = override.formulaDialect ?? declaredPoint.formulaDialect;
      const mergedFormula = override.formula ?? declaredPoint.formula;
      const templatePointId = input.targetPointIdsByKey.get(pointKey);
      if (mergedDialect !== CALC_DIALECT_V2 || mergedFormula === null || templatePointId === undefined) {
        continue;
      }
      const parsed = parseFormula(mergedFormula, { dialect: CALC_DIALECT_V2 });
      if (!parsed.ok) {
        continue;
      }
      candidates.push({
        assetId: asset.assetId,
        pointKey,
        templatePointId,
        dialect: CALC_DIALECT_V2,
        localRefs: parsed.refs,
        crossRefs: parsed.crossRefs,
      });
      planned.push({
        kind: "cycle-check",
        assetCode: asset.assetCode,
        pointKey,
        candidateIndex: candidates.length - 1,
      });
    }
  }

  // **The one fleet read.** Not once per override row: the detector reloads
  // every derived definition in the estate and resolves membership over the
  // whole set, so a per-row call made a batch of `N` assets cost `N` fleet-wide
  // reads. `checkCandidates` does both once and still answers each candidate
  // against the stored estate plus *itself* alone — a batch is not a merged
  // graph, so no asset is refused for a loop that only exists because a sibling
  // is migrating in the same call. An empty batch reads nothing at all, which
  // is the common migration.
  const cycles = await input.dependencies.checkCandidates(candidates);

  // Pass two — emit in the order pass one reached them, so a capped refusal
  // list holds the same rows it held when each row was checked in place.
  for (const item of planned) {
    if (item.kind === "refuse") {
      refuse(item.refusal);
      continue;
    }
    const cycle = cycles[item.candidateIndex];
    if (cycle.length === 0) {
      continue;
    }
    refuse({
      reason: "calc_override_invalid_on_target",
      pointKey: item.pointKey,
      assetCount: 1,
      message:
        `Asset "${item.assetCode}": its calc override on derived point "${item.pointKey}" would ` +
        `form a dependency cycle once merged with version ${targetVersion}: ` +
        `${cycle.map((member) => `${member.assetCode}/${member.pointKey}`).join(" → ")}. ` +
        "Every point on a cycle waits on another, so none of them ever computes. The " +
        "override endpoint refuses this same pair, and migration refuses it rather than " +
        "repointing the asset onto a formula that would stop (ADR 0055 decision 8). Break " +
        "the loop — change the override, or the aggregate scope that draws the other points " +
        "in — then migrate.",
    });
  }
}
