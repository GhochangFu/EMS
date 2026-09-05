import { Inject, Injectable } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";

import { assetPoints, assets, templatePoints } from "@bms/db";
import type { BmsDb } from "@bms/db";

import { FLEET_DRIZZLE } from "../database/database.tokens";
import { MetricsService } from "../observability/metrics.service";
import { inputKey } from "./calc-batch";
import { referencesADerivedSiblingUnderV1, toActiveDefinition, type CalcDefinition } from "./calc-definition";

/** Matches `AlarmEngineService.CACHE_TTL_MS` — the same staleness budget for
 * the same reason (ADR 0037 decision 6). */
const CACHE_TTL_MS = 60_000;

/**
 * Loads and caches active calc definitions: `asset → assets.templateId →
 * template_points ⟕ asset_points` for every `kind = 'derived'` row, resolved
 * through `toActiveDefinition` so an unusable stored row is a counted skip
 * rather than a throw (ADR 0037 decision 9). Template lifecycle status is
 * never consulted (decision 12) — instantiation already refuses a
 * non-published template, so `assets.templateId` always points at a frozen
 * row, and archiving a template must not stop formulas already computing for
 * assets built from it.
 *
 * **The left join is the F2.6 merge (ADR 0039 decision 6), and it is the
 * highest-risk line in this file.** Each of the five calc columns resolves as
 * `coalesce(asset_points.<col>, template_points.<col>)`, so a per-asset
 * override wins per column and a NULL inherits. It must stay a LEFT join and
 * the coalesce order must stay asset-first: an inner join would silently drop
 * every derived point that has no `asset_points` row — which is the *normal*
 * state, since instantiation emits no row for a derived point — and a
 * reversed coalesce would make every override inert. Neither fails; both
 * compute the wrong number quietly. `tests/adr-0039-resolution-merge.test.ts`
 * scans this file for exactly that reason: every calc unit test constructs
 * its dependencies directly, so reverting this query to a template-only
 * select leaves the whole suite green.
 *
 * `kind` is deliberately **not** coalesced. An asset cannot turn a measured
 * template point into a derived one, so the `not_derived` skip still fires
 * on the template's own value.
 */
@Injectable()
export class CalcDefinitionsService {
  private definitionsByInput = new Map<string, CalcDefinition[]>();
  private streamingInputKeys: ReadonlySet<string> = new Set();
  private all: CalcDefinition[] = [];
  private scheduled: CalcDefinition[] = [];
  private cacheLoadedAt = 0;

  constructor(
    // E7.1b: like `AlarmEngineService`, this is a cross-organization system cache
    // — every derived point from every tenant, with no JWT and no org context.
    // That is a fleetDb read (Amendment 2/3); on the tenant pool the 0047 policy
    // on `assets`/`template_points`/`asset_points` would return nothing and the
    // calc engine would produce no computed telemetry at all.
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    private readonly metrics: MetricsService,
  ) {}

  private async ensureFresh(): Promise<void> {
    if (Date.now() - this.cacheLoadedAt < CACHE_TTL_MS) {
      return;
    }
    await this.reload();
  }

  /**
   * Reloads the cache.
   *
   * `countSkips` is `false` for exactly one caller —
   * `getAllDefinitionsFresh()`, the save-time cycle detector's read (`F2.9`,
   * finding 30). `bms_api_calc_skipped_total` means "the engine refused to
   * compute N times"; if an author's keystroke moved it too, the number would
   * mean two things at once and be readable as neither. ADR 0037 decision 9
   * requires that no **evaluation** skip is silent, and a validation read is
   * not an evaluation. **Both** count sites below are gated, not just the
   * first: half a counter is a counter that lies more quietly.
   *
   * No shipped refusal changes. The rows filtered out are the same rows either
   * way, so the detector still never sees an unusable definition.
   *
   * **`stampCache` travels with it, and it is a second flag rather than a
   * consequence of the first for a reason.** `cacheLoadedAt` is what
   * {@link CalcDefinitionsService.ensureFresh} tests, so an *uncounted* reload
   * that stamped the timestamp would spend the next 60 seconds of refresh
   * window on behalf of a counted one that never runs: every `v2` override save
   * would silence the following sweep's reload, and with it every skip reason
   * that is only reachable from a `reload()` — `self_reference`,
   * `v1_references_derived`, `streaming_on_v2` and
   * `coverage_ratio_out_of_range`, PR 1's runaway backstops. The refusals still
   * fire at evaluation time; what was lost was **detection**, which is the
   * whole of ADR 0037 decision 9. Proved by execution at the `F2.9` PR 2 review
   * gate: four counted `self_reference` skips across four sweeps became one as
   * soon as a save ran between them.
   *
   * So the two flags are one decision — "this read is a validation" — written
   * as two, because a flag named `countSkips` that also governed the cache
   * timestamp would be a name that hides half of what it does.
   */
  private async reload({
    countSkips = true,
    stampCache = true,
  }: { countSkips?: boolean; stampCache?: boolean } = {}): Promise<void> {
    const rows = await this.fleetDb
      .select({
        templatePointId: templatePoints.id,
        assetId: assets.id,
        pointKey: templatePoints.pointKey,
        kind: templatePoints.kind,
        formula: sql<string | null>`coalesce(${assetPoints.formula}, ${templatePoints.formula})`,
        formulaDialect: sql<string | null>`coalesce(${assetPoints.formulaDialect}, ${templatePoints.formulaDialect})`,
        calcTrigger: sql<string | null>`coalesce(${assetPoints.calcTrigger}, ${templatePoints.calcTrigger})`,
        calcIntervalSeconds: sql<number | null>`coalesce(${assetPoints.calcIntervalSeconds}, ${templatePoints.calcIntervalSeconds})`,
        maxInputAgeSeconds: sql<number | null>`coalesce(${assetPoints.maxInputAgeSeconds}, ${templatePoints.maxInputAgeSeconds})`,
        // `F2.9` — the sixth calc column, and deliberately **not** a coalesce.
        // ADR 0055 puts `min_coverage_ratio` on `template_points` only:
        // `asset_points` has no such column, so there is nothing to coalesce
        // with and it is not overridable per asset. Wrapping it in a coalesce
        // anyway would claim a merge that does not exist.
        // `tests/adr-0039-resolution-merge.test.ts` pins each of the five
        // merged columns above by its exact text — leave them byte-identical.
        minCoverageRatio: templatePoints.minCoverageRatio,
      })
      .from(assets)
      // assets.templateId is nullable (every seeded asset is hand-created,
      // per its own column comment) — `eq` against a NULL column fails the
      // join condition, so a hand-created asset contributes no rows here
      // without any extra filter.
      .innerJoin(templatePoints, eq(templatePoints.templateId, assets.templateId))
      // ADR 0039 decision 6. LEFT, on `(asset_id, point_key)` — the pair
      // `asset_points_asset_id_point_key_unique` covers, so this matches at
      // most one row per derived point and cannot fan the result out.
      //
      // `source_kind` **is** filtered, and `active` is **not**, for two
      // different reasons that are easy to confuse:
      //
      // - `active` is not filtered: D-2 — deactivating a telemetry *mapping*
      //   must not silently stop a formula, and an override row created by the
      //   override endpoint is calc configuration rather than wiring.
      // - `source_kind` is filtered because the calc columns belong only to a
      //   `computed` row. `AssetPointsAdminService.create` resolves a point key
      //   against the `point_keys` catalog alone and has no template awareness,
      //   so an operator can map a `measured`/`unmapped` row onto a key the
      //   pinned template declares `derived`. Such a row carries NULL across
      //   all five columns today, so omitting the filter happens to give the
      //   same answer — but only by accident, and the accident is one write
      //   away from resolving a formula out of a telemetry mapping. The filter
      //   makes the join say what it means instead of relying on an invariant
      //   no constraint enforces.
      .leftJoin(
        assetPoints,
        and(
          eq(assetPoints.assetId, assets.id),
          eq(assetPoints.pointKey, templatePoints.pointKey),
          eq(assetPoints.sourceKind, "computed"),
        ),
      )
      .where(eq(templatePoints.kind, "derived"));

    const candidates: CalcDefinition[] = [];
    // Every row this query returns is `kind = 'derived'` (the WHERE above), so
    // the asset's derived point keys are already in hand and the post-pass
    // below needs no second query. Built from the **rows**, not from the
    // resolved definitions: a derived point that is itself unusable — no
    // trigger, unparseable — is still a derived point, and referencing it is
    // what ADR 0036 decision 7 bans. That is also the write-side guard's own
    // reading: `asset-templates.schema.ts` tests `kind`, never usability.
    const derivedPointKeysByAsset = new Map<string, Set<string>>();
    for (const row of rows) {
      const forAsset = derivedPointKeysByAsset.get(row.assetId);
      if (forAsset) {
        forAsset.add(row.pointKey);
      } else {
        derivedPointKeysByAsset.set(row.assetId, new Set([row.pointKey]));
      }
      const result = toActiveDefinition(row);
      if (!result.ok) {
        if (countSkips) this.metrics.countCalcSkipped(result.reason);
        continue;
      }
      candidates.push(result.def);
    }

    // `F2.9` — the `v1`-references-a-derived-point refusal, and the **only**
    // check here that needs a definition's siblings rather than its own row.
    // {@link referencesADerivedSiblingUnderV1} carries the reasoning; two
    // placement facts belong here, where they can be got wrong:
    //
    //  - it runs **before** the indexes below, so a refused definition is
    //    unreachable through `getDefinitionsForInput` and never wakes the
    //    streaming host. Filtering after them would leave the runaway
    //    compounding through a path `getScheduledDefinitions()` does not show;
    //  - `setCalcActiveFormulas` therefore counts what survives, which is what
    //    ADR 0037 decision 7's gauge means by "active".
    const defs = candidates.filter((def) => {
      if (!referencesADerivedSiblingUnderV1(def, derivedPointKeysByAsset)) {
        return true;
      }
      if (countSkips) this.metrics.countCalcSkipped("v1_references_derived");
      return false;
    });

    const byInput = new Map<string, CalcDefinition[]>();
    const streamingInputKeys = new Set<string>();
    for (const def of defs) {
      for (const ref of def.refs) {
        const key = inputKey(def.assetId, ref);
        const list = byInput.get(key);
        if (list) {
          list.push(def);
        } else {
          byInput.set(key, [def]);
        }
        if (def.trigger === "streaming") {
          streamingInputKeys.add(key);
        }
      }
    }

    this.definitionsByInput = byInput;
    this.streamingInputKeys = streamingInputKeys;
    this.all = defs;
    this.scheduled = defs.filter((def) => def.trigger === "scheduled");
    // Contents always; the timestamp only for an evaluation refresh. See the
    // docblock: leaving `cacheLoadedAt` alone is what keeps the next
    // `ensureFresh()` a real, counted reload rather than a no-op inside a TTL
    // a validation read paid for.
    if (stampCache) {
      this.cacheLoadedAt = Date.now();
    }
    this.metrics.setCalcActiveFormulas(defs.length);
  }

  /**
   * Every `(assetId, pointKey)` that is an input to some active **streaming**
   * formula — the streaming host's re-entrancy filter (ADR 0037 decision 11).
   *
   * **Deliberately not `definitionsByInput.keys()`**, and re-collapsing the two
   * would widen the filter silently. This set decides which of the engine's own
   * writes are allowed to wake the streaming host at all
   * (`filterToInputs`), so its correctness argument has to hold for every
   * indexed definition — see `calc-batch.ts`, where that argument is written
   * out. A scheduled formula's inputs belong to the sweep, which reads them on
   * its own clock and never through this set; indexing them buys nothing (the
   * streaming host skips a scheduled definition at `calc-streaming.service.ts`
   * anyway) and costs the one guarantee the set exists for.
   */
  async getInputKeys(): Promise<ReadonlySet<string>> {
    await this.ensureFresh();
    return this.streamingInputKeys;
  }

  /** Active formulas that use `(assetId, pointKey)` as an input, resolved on
   * the pair — not on `pointKey` alone, since point keys are org-scoped
   * catalog codes shared across templates. */
  async getDefinitionsForInput(assetId: string, pointKey: string): Promise<CalcDefinition[]> {
    await this.ensureFresh();
    return this.definitionsByInput.get(inputKey(assetId, pointKey)) ?? [];
  }

  /** Every active `scheduled` formula, for the scheduled host's sweep. */
  async getScheduledDefinitions(): Promise<CalcDefinition[]> {
    await this.ensureFresh();
    return this.scheduled;
  }

  /**
   * Every active definition, read **past** the 60s cache (`F2.9`, ADR 0055
   * decision 8) — the save-time dependency detector's read.
   *
   * The TTL is right for the two evaluation hosts: a formula that starts
   * computing up to a minute late costs one sample. It is wrong for a
   * *decision* about whether a candidate formula closes a dependency cycle: a
   * definition written in the last 60s would be invisible, and the detector
   * would admit the edge that completes the loop. The cost is one query per
   * template/override save, which is a human-rate write path.
   *
   * **`countSkips: false`** — see `reload`. This read is a validation, not an
   * evaluation, and counting it would make `bms_api_calc_skipped_total` move on
   * an author's keystroke (finding 30).
   *
   * **`stampCache: false`** for the other half of the same reason. The cache
   * *contents* this leaves behind are the same either way, so the two
   * evaluation hosts read the same definitions — but the *timestamp* is not a
   * free write. Stamping it would let this uncounted reload consume the refresh
   * window the next sweep would have spent on a counted one, so an author's
   * save would silence the skips the following sweep should have counted
   * (`F2.9` PR 2 review fix 3). Contents shared, window not.
   */
  async getAllDefinitionsFresh(): Promise<CalcDefinition[]> {
    await this.reload({ countSkips: false, stampCache: false });
    return this.all;
  }
}
