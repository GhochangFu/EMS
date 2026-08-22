import { Inject, Injectable } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";

import { assetPoints, assets, templatePoints } from "@bms/db";
import type { BmsDb } from "@bms/db";

import { DRIZZLE } from "../database/database.tokens";
import { MetricsService } from "../observability/metrics.service";
import { inputKey } from "./calc-batch";
import { toActiveDefinition, type CalcDefinition } from "./calc-definition";

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
  private scheduled: CalcDefinition[] = [];
  private cacheLoadedAt = 0;

  constructor(
    @Inject(DRIZZLE) private readonly db: BmsDb,
    private readonly metrics: MetricsService,
  ) {}

  private async ensureFresh(): Promise<void> {
    if (Date.now() - this.cacheLoadedAt < CACHE_TTL_MS) {
      return;
    }
    await this.reload();
  }

  private async reload(): Promise<void> {
    const rows = await this.db
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
      // `active` is not filtered: D-2 — deactivating a
      // telemetry *mapping* must not silently stop a formula, and an override
      // row created by the override endpoint is calc configuration rather
      // than wiring.
      .leftJoin(
        assetPoints,
        and(eq(assetPoints.assetId, assets.id), eq(assetPoints.pointKey, templatePoints.pointKey)),
      )
      .where(eq(templatePoints.kind, "derived"));

    const defs: CalcDefinition[] = [];
    const byInput = new Map<string, CalcDefinition[]>();
    for (const row of rows) {
      const result = toActiveDefinition(row);
      if (!result.ok) {
        this.metrics.countCalcSkipped(result.reason);
        continue;
      }
      defs.push(result.def);
      for (const ref of result.def.refs) {
        const key = inputKey(result.def.assetId, ref);
        const list = byInput.get(key);
        if (list) {
          list.push(result.def);
        } else {
          byInput.set(key, [result.def]);
        }
      }
    }

    this.definitionsByInput = byInput;
    this.scheduled = defs.filter((def) => def.trigger === "scheduled");
    this.cacheLoadedAt = Date.now();
    this.metrics.setCalcActiveFormulas(defs.length);
  }

  /** Every `(assetId, pointKey)` that is an input to some active formula —
   * the streaming host's re-entrancy filter (ADR 0037 decision 11). */
  async getInputKeys(): Promise<ReadonlySet<string>> {
    await this.ensureFresh();
    return new Set(this.definitionsByInput.keys());
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
}
