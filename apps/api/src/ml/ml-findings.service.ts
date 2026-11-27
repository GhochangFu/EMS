import { Inject, Injectable } from "@nestjs/common";

import type { BmsDb } from "@bms/db";
import type { MlFindingsSummaryResponse } from "@bms/shared";

import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../database/database.tokens";
import { withReadScope } from "../database/tenant-read-scope";
import { anomalyListSinceOf } from "./ml-anomalies.pure";
import { readAnomalyFindings, readAnomalyOrganizations } from "./ml-anomalies.reads";
import { buildAnomalyCards, type AnomalyFindingsInput } from "./ml-findings.anomaly-facts";
import { buildForecastCards, type ForecastFindingsInput } from "./ml-findings.forecast-facts";
import { toSummaryCard, type FindingsCardFacts } from "./ml-findings.lines";
import {
  readActualMeans,
  readForecastFindings,
  readForecastOrganizations,
  readThresholdRules,
} from "./ml-findings.reads";
import { currentHourOf } from "./ml-forecasts.pure";

/** The internal form of a summary: what `E1.9c`'s paragraph service pseudonymises. */
export type FindingsFacts = { readonly asOf: string; readonly cards: readonly FindingsCardFacts[] };

/**
 * `E1.9a` / ADR 0135 Amendment 8 decisions 2, 3, 8 and 10 (plan T1.6) — the
 * forecast and anomaly findings of every organization among the caller's
 * (narrowed) assets. Facts only; no LLM.
 *
 * **Each summary is one `withReadScope`, and nothing here touches a pool
 * otherwise** (`tests/e1.9-ml-findings-containment.test.ts`). A
 * single-organization caller reads inside `withTenant` on `bms_tenant`, so the
 * row policies scope every row; a global admin, or a caller whose assets span
 * organizations, reads on the fleet branch, where the reads' `asset_id =
 * ANY(ids)` and the rule read's hand-carried organization are the controls.
 * Inside, the reads run in order on the one connection (no `Promise.all`).
 *
 * `forecastFacts` / `anomalyFacts` return the cards' internal form (rule names
 * and times as their own parts) for the paragraph service (`E1.9c`), which calls
 * them and never the HTTP route; the wire response is derived from it.
 */
@Injectable()
export class MlFindingsService {
  constructor(
    @Inject(TENANT_DRIZZLE) private readonly tenantDb: BmsDb,
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
  ) {}

  /** The forecast facts among `assetIds` (`narrow`'s value; `null` is the global admin with no filter). */
  async forecastFacts(assetIds: string[] | null, narrowed: boolean, now: Date): Promise<FindingsFacts> {
    const currentHourMs = currentHourOf(now);
    const sinceMs = anomalyListSinceOf(undefined, now).sinceMs;
    const empty: ForecastFindingsInput = { rows: [], means: [], rules: [], organizations: [], narrowed };
    const input = await withReadScope(this.tenantDb, this.fleetDb, assetIds, () => empty, async (tx) => {
      const rows = await readForecastFindings(tx, assetIds, currentHourMs);
      const pairs = [...new Map(rows.map((r) => [`${r.asset_id}\u0000${r.point_key}`, { assetId: r.asset_id, pointKey: r.point_key }])).values()];
      const means = rows.length === 0 ? [] : await readActualMeans(tx, pairs, currentHourMs);
      const rules = rows.length === 0 ? [] : await readThresholdRules(tx, pairs);
      const organizations = await readAnomalyOrganizations(tx, assetIds, sinceMs);
      return { rows, means, rules, organizations, narrowed };
    });
    return { asOf: now.toISOString(), cards: buildForecastCards(input, now) };
  }

  /** The anomaly facts among `assetIds`, over the last 7 days floored to the hour. */
  async anomalyFacts(assetIds: string[] | null, now: Date): Promise<FindingsFacts> {
    const currentHourMs = currentHourOf(now);
    const sinceMs = anomalyListSinceOf(undefined, now).sinceMs;
    const empty: AnomalyFindingsInput = { rows: [], organizations: [] };
    const input = await withReadScope(this.tenantDb, this.fleetDb, assetIds, () => empty, async (tx) => {
      const rows = await readAnomalyFindings(tx, assetIds, sinceMs);
      const organizations = await readForecastOrganizations(tx, assetIds, currentHourMs);
      return { rows, organizations };
    });
    return { asOf: now.toISOString(), cards: buildAnomalyCards(input, now) };
  }

  /** `GET /ml/forecasts/summary`: the forecast facts as the wire's cards. */
  async forecastSummary(assetIds: string[] | null, narrowed: boolean, now: Date): Promise<MlFindingsSummaryResponse> {
    const facts = await this.forecastFacts(assetIds, narrowed, now);
    return { asOf: facts.asOf, cards: facts.cards.map(toSummaryCard) };
  }

  /** `GET /ml/anomalies/summary`: the anomaly facts as the wire's cards. `narrowed` changes no anomaly sentence. */
  async anomalySummary(assetIds: string[] | null, _narrowed: boolean, now: Date): Promise<MlFindingsSummaryResponse> {
    const facts = await this.anomalyFacts(assetIds, now);
    return { asOf: facts.asOf, cards: facts.cards.map(toSummaryCard) };
  }
}
