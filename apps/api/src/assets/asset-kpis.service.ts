import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { assetTemplates, assets, type BmsDb } from "@bms/db";
import type { AssetKpiState, AssetKpiValue, AssetKpisResponse, CalcCrossRef, CalcExpr } from "@bms/shared";
import { evaluate, parseFormula } from "@bms/shared";

import { templateKpiSchema } from "../admin/asset-templates/asset-templates-content.schema";
import { inputKey } from "../calc/calc-batch";
import type { Membership } from "../calc/calc-graph";
import {
  assembleInputs,
  NO_OVERLAY,
  planWindowRequests,
  type AssemblyDefinition,
  type AssemblyRefusalReason,
  type CalcInputAssemblyDeps,
} from "../calc/calc-input-assembly";
import { CalcInputsService } from "../calc/calc-inputs.service";
import { CalcParametersService } from "../calc/calc-parameters.service";
import { CalcScopeService } from "../calc/calc-scope.service";
import { windowEndMs } from "../calc/calc-window-plan";
import { CalcWindowsService, type WindowReadResult } from "../calc/calc-windows.service";
import { FLEET_DRIZZLE } from "../database/database.tokens";

/**
 * A KPI has no interval to bucket on, so its window reads end at the request
 * time floored to the minute (ADR 0097 "Ruled here"). `windowEndMs(now, 60)`
 * is exactly that floor — `bucketTimeMs(now, 60)` floored again to the minute
 * is a no-op — so no second helper is written.
 */
export const KPI_WINDOW_END_INTERVAL_SECONDS = 60;

/** The asset's pinned template, as one fleet read returns it; `null` when the asset does not exist. */
export type KpiTemplateRow = { readonly templateId: string | null; readonly content: unknown };

export type AssetKpisDeps = CalcInputAssemblyDeps & {
  loadTemplate: (assetId: string) => Promise<KpiTemplateRow | null>;
  scope: Pick<CalcScopeService, "resolveMembership">;
  parameters: Pick<CalcParametersService, "resolveForAssets">;
  windows: Pick<CalcWindowsService, "resolveReads">;
  logger: Pick<Logger, "warn">;
};

type StoredKpi = z.infer<typeof templateKpiSchema>;

/** One KPI ready to assemble: its stored identity, its parsed AST, and the assembly's view of it. */
type EvaluableKpi = { readonly kpi: StoredKpi; readonly ast: CalcExpr; readonly def: AssemblyDefinition };

const EMPTY_MEMBERSHIP: Membership = { qualified: new Map(), members: new Map() };
const EMPTY_PARAMETERS: ReadonlyMap<string, number> = new Map();
const EMPTY_WINDOWS: ReadonlyMap<string, WindowReadResult> = new Map();

/** The stored KPI's identity fields — what the card renders, and nothing else (decision 6, owner ruling 2026-10-09). */
function identityOf(kpi: StoredKpi): Pick<AssetKpiValue, "code" | "name" | "unit" | "higherIsBetter"> {
  return {
    code: kpi.code,
    name: kpi.name,
    ...(kpi.unit !== undefined ? { unit: kpi.unit } : {}),
    ...(kpi.higherIsBetter !== undefined ? { higherIsBetter: kpi.higherIsBetter } : {}),
  };
}

/**
 * The response state of an assembly refusal. **Exhaustive by type:** every
 * reason but one is returned as-is, so a reason added to
 * `AssemblyRefusalReason` that the contract's closed enum does not list fails
 * the compile here. `coverage_below_floor` is unreachable — every KPI
 * aggregate runs with a `null` ratio (ADR 0097 decision 3) — and reaching it
 * is an invariant failure, not a state.
 */
function stateOf(reason: AssemblyRefusalReason): AssetKpiState {
  if (reason === "coverage_below_floor") {
    throw new Error("asset KPIs: coverage_below_floor under a null coverage ratio — the assembly broke ADR 0055 decision 11");
  }
  return reason;
}

/**
 * The `kpis` slice of a template's content, parsed as the write path stores
 * it — `parseHealth`'s shape (`asset-health.service.ts`). No template, or no
 * `kpis` key, is no KPI. A slice that fails the schema (a hand-edited row, a
 * pre-ADR-0019 template) lists nothing and warns once naming the template: a
 * 500 on a read page would be worse, and a partial list would be a guess.
 */
function parseKpis(deps: Pick<AssetKpisDeps, "logger">, row: KpiTemplateRow): StoredKpi[] {
  const { content } = row;
  if (typeof content !== "object" || content === null || !("kpis" in content)) {
    return [];
  }
  const parsed = z.array(templateKpiSchema).safeParse((content as { kpis: unknown }).kpis);
  if (!parsed.success) {
    deps.logger.warn(`asset KPIs: template ${String(row.templateId)} has a kpis slice that fails the schema; listing none`);
    return [];
  }
  return parsed.data;
}

function toEvaluable(assetId: string, kpi: StoredKpi, windowMinutes: number): EvaluableKpi {
  // The slice's `superRefine` already ran `validateFormula` under this same
  // dialect, so a parse failure here is an invariant break, not a state.
  const parsed = parseFormula(kpi.expression, { dialect: kpi.dialect as Exclude<StoredKpi["dialect"], "unvalidated"> });
  if (!parsed.ok) {
    throw new Error(`asset KPIs: KPI ${kpi.code} passed the schema but does not parse under ${kpi.dialect}`);
  }
  return {
    kpi,
    ast: parsed.ast,
    def: {
      assetId,
      refs: parsed.refs,
      crossRefs: parsed.crossRefs,
      paramRefs: parsed.paramRefs,
      windowReads: parsed.windowReads,
      // ADR 0097 decision 2: stale means older than the caller's window.
      maxInputAgeSeconds: windowMinutes * 60,
      // Decision 3: fail closed, every declared member must be fresh.
      minCoverageRatio: null,
    },
  };
}

/**
 * `F2.33` — every KPI of the asset's pinned template, evaluated now (ADR 0097).
 * Nothing is written, cached, counted or recorded: a KPI is not a calc point,
 * and a refusal here is a response state, never a skipped tick.
 *
 * One membership read (every KPI's cross references on one definition — the
 * resolver keys by owner and `crossRefKey`), one parameter read when a KPI
 * holds a `$key`, one window read when a KPI holds a window. A resolver that
 * throws propagates: a read route has no "refuse every formula this sweep" to
 * contain it in.
 *
 * Disclosure (decision 6): an item carries counts, never a member's id, code
 * or value. `excluded` is the declared aggregate members that were stale or
 * missing, classified over every member; `memberCount` is every declared
 * member.
 */
export async function evaluateAssetKpis(
  deps: AssetKpisDeps,
  assetId: string,
  windowMinutes: number,
  now: Date,
): Promise<AssetKpisResponse> {
  const row = await deps.loadTemplate(assetId);
  if (row === null) {
    throw new NotFoundException("Asset not found");
  }
  const stored = parseKpis(deps, row);
  const nowMs = now.getTime();

  const evaluable = stored
    .filter((kpi) => kpi.dialect !== "unvalidated")
    .map((kpi) => toEvaluable(assetId, kpi, windowMinutes));

  const crossRefs: CalcCrossRef[] = evaluable.flatMap((e) => e.def.crossRefs);
  const membership = crossRefs.length > 0 ? await deps.scope.resolveMembership([{ assetId, crossRefs }]) : EMPTY_MEMBERSHIP;

  const parameterPairs = new Map<string, { assetId: string; key: string }>();
  for (const { def } of evaluable) {
    for (const key of def.paramRefs) parameterPairs.set(inputKey(assetId, key), { assetId, key });
  }
  const parameters =
    parameterPairs.size > 0 ? await deps.parameters.resolveForAssets([...parameterPairs.values()], now) : EMPTY_PARAMETERS;

  const endMs = windowEndMs(nowMs, KPI_WINDOW_END_INTERVAL_SECONDS);
  const windowRequests = evaluable.flatMap(({ def }) => planWindowRequests(def, membership, endMs));
  const windows = windowRequests.length > 0 ? await deps.windows.resolveReads(windowRequests) : EMPTY_WINDOWS;

  const byKpi = new Map<StoredKpi, EvaluableKpi>(evaluable.map((e) => [e.kpi, e]));
  const items: AssetKpiValue[] = [];
  for (const kpi of stored) {
    const entry = byKpi.get(kpi);
    if (entry === undefined) {
      items.push({ ...identityOf(kpi), value: null, state: "unvalidated", inputAsOf: null, excluded: 0, memberCount: 0 });
      continue;
    }
    const assembled = await assembleInputs(deps, entry.def, nowMs, membership, NO_OVERLAY, parameters, windows, endMs);
    const facts = {
      inputAsOf: assembled.oldestInputMs === null ? null : new Date(assembled.oldestInputMs).toISOString(),
      excluded: assembled.membersNotFresh,
      memberCount: assembled.memberCount,
    };
    if (!assembled.ok) {
      items.push({ ...identityOf(kpi), value: null, state: stateOf(assembled.reason), ...facts });
      continue;
    }
    const result = evaluate(entry.ast, assembled.inputs, assembled.crossInputs, assembled.params, assembled.windowValues);
    items.push(
      result.ok
        ? { ...identityOf(kpi), value: result.value, state: "ok", ...facts }
        : { ...identityOf(kpi), value: null, state: "non_finite", ...facts },
    );
  }
  return { assetId, windowMinutes, items };
}

/**
 * The Nest shell over {@link evaluateAssetKpis}. §4.3 fleet-read reason:
 * `bms.assets` and `bms.asset_templates` carry RLS, and the controller's
 * `canReadAsset` guard is the containment (the `AssetsService.listPoints`
 * and asset-health shape) — the id reaching here was already authorized.
 */
@Injectable()
export class AssetKpisService {
  private readonly logger = new Logger(AssetKpisService.name);

  constructor(
    @Inject(FLEET_DRIZZLE) private readonly db: BmsDb,
    private readonly inputs: CalcInputsService,
    private readonly scope: CalcScopeService,
    private readonly parameters: CalcParametersService,
    private readonly windows: CalcWindowsService,
  ) {}

  listKpis(assetId: string, windowMinutes: number, now: Date): Promise<AssetKpisResponse> {
    return evaluateAssetKpis(
      {
        loadTemplate: (id) => this.loadTemplate(id),
        inputs: this.inputs,
        scope: this.scope,
        parameters: this.parameters,
        windows: this.windows,
        logger: this.logger,
      },
      assetId,
      windowMinutes,
      now,
    );
  }

  private async loadTemplate(assetId: string): Promise<KpiTemplateRow | null> {
    const [row] = await this.db
      .select({ templateId: assets.templateId, content: assetTemplates.content })
      .from(assets)
      .leftJoin(assetTemplates, eq(assets.templateId, assetTemplates.id))
      .where(eq(assets.id, assetId))
      .limit(1);
    return row === undefined ? null : { templateId: row.templateId, content: row.content };
  }
}
