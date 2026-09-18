import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";

import type { BmsDb } from "@bms/db";

import { FLEET_DRIZZLE } from "../database/database.tokens";
import { inputKey } from "./calc-batch";

/** One `(asset, $key)` question the sweep asks per parameter reference. */
export type ParameterPair = { readonly assetId: string; readonly key: string };

/** One row of the vocabulary, as the admin picker reads it (`E4.1a` U8). */
export type CalcParameterKeyRow = {
  readonly code: string;
  readonly label: string;
  readonly unit: string | null;
  readonly description: string | null;
  readonly sortOrder: number;
};

/**
 * Resolves what a `bms-calc-v3` formula's `$key` references are worth **at an
 * instant** (ADR 0070 decision 2; `E4.1a` U5) — the fourth map `evaluate()`
 * takes, keyed like the inputs map by `inputKey(assetId, key)`.
 *
 * **Why this is a fleet read.** The same reason `CalcScopeService` records:
 * the scheduled sweep evaluates every derived point from every tenant, with
 * no JWT and no org context — a cross-organization system read with no
 * tenant actor (ADR 0043 Amendments 2 and 3). On the tenant pool the `0074`
 * policy would return nothing and every parameter would be `parameter_unset`.
 *
 * **`cp.organization_id = a.organization_id` is the containment, not an
 * optimisation.** The statement joins the owning asset and reads only that
 * asset's organization's rows, so an organization-scope tariff in org A can
 * never serve an asset in org B — the property `tests/adr-0070-calc-v3-invariants.test.ts`
 * part (d) scans this file for. Do not "simplify" it away.
 *
 * **Nearest scope wins, and validity is half-open** (plan design decision
 * 10): among the rows whose `[effective_from, effective_to)` contains `at`,
 * the asset-scope row beats the location-scope row beats the
 * organization-scope row. That is one `ORDER BY` on nullness with `LIMIT 1`
 * per pair, not three queries.
 *
 * **No default value anywhere.** A pair with no row in scope is *absent from
 * the map* — never `0`, never `null`, never an env var. The host turns an
 * absent key into a `parameter_unset` refusal that writes nothing (ADR 0037
 * decision 9; ADR 0055 decision 11's fail-closed rule applied to a fourth
 * input). No `COALESCE` on `value` and no nullish-coalesced fallback here —
 * `tests/adr-0070-calc-v3-invariants.test.ts` part (d) scans for both, and it
 * reads this docblock too, which is why neither token is spelled here.
 *
 * **Batched once per sweep**, like membership: every `(assetId, key)` pair of
 * every scheduled `v3` definition in one statement (`unnest` + `CROSS JOIN
 * LATERAL … LIMIT 1`, the shape `getLatestSamplesForPairs` measured against
 * the `IN (unnest…)` form). Empty pairs → no query.
 */
@Injectable()
export class CalcParametersService {
  constructor(@Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb) {}

  /**
   * The value of each pair's key for its asset at `at`, keyed by
   * `inputKey(assetId, key)`. A pair is absent when no row is in scope at
   * `at`, when the asset does not exist, or when the asset's organization
   * holds no row for the key — the three cases are indistinguishable here on
   * purpose: each is "no value", and the host reports them as one refusal.
   */
  async resolveForAssets(pairs: readonly ParameterPair[], at: Date): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    const distinct = new Map<string, ParameterPair>();
    for (const pair of pairs) {
      distinct.set(inputKey(pair.assetId, pair.key), pair);
    }
    if (distinct.size === 0) {
      return out;
    }
    const wanted = [...distinct.values()];
    const result = await this.fleetDb.execute<{ asset_id: string; key: string; value: number | string }>(
      sql`SELECT p.asset_id, p.key, s.value
            FROM unnest(
                   ${sql.param(wanted.map((p) => p.assetId))}::uuid[],
                   ${sql.param(wanted.map((p) => p.key))}::varchar[]
                 ) AS p(asset_id, key)
            JOIN bms.assets a ON a.id = p.asset_id
            CROSS JOIN LATERAL (
              SELECT cp.value
                FROM bms.calc_parameters cp
               WHERE cp.organization_id = a.organization_id
                 AND cp.key = p.key
                 AND cp.effective_from <= ${sql.param(at)}
                 AND (cp.effective_to IS NULL OR cp.effective_to > ${sql.param(at)})
                 AND (cp.asset_id = a.id
                      OR (cp.asset_id IS NULL AND cp.location_id = a.location_id)
                      OR (cp.asset_id IS NULL AND cp.location_id IS NULL))
               ORDER BY (cp.asset_id IS NOT NULL) DESC, (cp.location_id IS NOT NULL) DESC
               LIMIT 1
            ) s`,
    );
    for (const row of result.rows) {
      // `double precision` arrives as a JS number through `pg`; the string arm
      // is defensive against a driver type-parser change, never a default.
      out.set(inputKey(row.asset_id, row.key), typeof row.value === "number" ? row.value : Number(row.value));
    }
    return out;
  }

  /**
   * The codes in `codes` that are **not** present and active in
   * `bms.calc_parameter_keys` — the save-time vocabulary check (ADR 0070
   * decision 4; U7). Deduped, input order. A key that exists but has no value
   * in scope is *not* unknown: that is the runtime refusal, not a save error.
   */
  async unknownKeys(codes: readonly string[]): Promise<string[]> {
    const distinct = [...new Set(codes)];
    if (distinct.length === 0) {
      return [];
    }
    const result = await this.fleetDb.execute<{ code: string }>(
      sql`SELECT code FROM bms.calc_parameter_keys
           WHERE active AND code = ANY(${sql.param(distinct)}::varchar[])`,
    );
    const known = new Set(result.rows.map((row) => row.code));
    return distinct.filter((code) => !known.has(code));
  }

  /** The active vocabulary in `sort_order, code` order — the picker's read. */
  async listKeys(): Promise<CalcParameterKeyRow[]> {
    const result = await this.fleetDb.execute<{
      code: string;
      label: string;
      unit: string | null;
      description: string | null;
      sort_order: number;
    }>(
      sql`SELECT code, label, unit, description, sort_order
            FROM bms.calc_parameter_keys
           WHERE active
           ORDER BY sort_order, code`,
    );
    return result.rows.map((row) => ({
      code: row.code,
      label: row.label,
      unit: row.unit,
      description: row.description,
      sortOrder: row.sort_order,
    }));
  }
}
