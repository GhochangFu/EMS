import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";

import { assets, templatePoints } from "@bms/db";
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
 * template_points` for every `kind = 'derived'` row, resolved through
 * `toActiveDefinition` so an unusable stored row is a counted skip rather
 * than a throw (ADR 0037 decision 9). Template lifecycle status is never
 * consulted (decision 12) — instantiation already refuses a non-published
 * template, so `assets.templateId` always points at a frozen row, and
 * archiving a template must not stop formulas already computing for assets
 * built from it.
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
        formula: templatePoints.formula,
        formulaDialect: templatePoints.formulaDialect,
        calcTrigger: templatePoints.calcTrigger,
        calcIntervalSeconds: templatePoints.calcIntervalSeconds,
        maxInputAgeSeconds: templatePoints.maxInputAgeSeconds,
      })
      .from(assets)
      // assets.templateId is nullable (every seeded asset is hand-created,
      // per its own column comment) — `eq` against a NULL column fails the
      // join condition, so a hand-created asset contributes no rows here
      // without any extra filter.
      .innerJoin(templatePoints, eq(templatePoints.templateId, assets.templateId))
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
