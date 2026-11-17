import { PgDialect } from "drizzle-orm/pg-core";
import { ANOMALY_MODEL_NAME, ANOMALY_UNUSUAL_SCORE } from "@bms/shared";
import { expect } from "vitest";

import type { BmsTx } from "../database/tenant-context";
import {
  anomalyFindingsStatement,
  anomalyListStatement,
  anomalyOrganizationsStatement,
  readAnomalyFindings,
  readAnomalyOrganizations,
} from "./ml-anomalies.reads";
import {
  actualMeansStatement,
  forecastFindingsStatement,
  forecastOrganizationsStatement,
  readActualMeans,
  readForecastFindings,
  readForecastOrganizations,
  readThresholdRules,
  textArray,
  thresholdRulesStatement,
} from "./ml-findings.reads";
import { HOUR_MS, lookBackStartOf } from "./ml-forecasts.pure";
import { forecastListStatement } from "./ml-forecasts.reads";

/**
 * `E1.9a` / ADR 0135 Amendment 8 (plan T1.5) — the findings statements' text,
 * the part a unit test can hold without a database: the asset filter on both
 * branches, the fences, the window parameters, the hand-carried organization of
 * the rule read, and — because the anomaly findings aggregate in SQL — the
 * line `ANOMALY_UNUSUAL_SCORE` (bound, `>=`) and an hour counted once. The rows
 * are held against Postgres in `ml-findings.integration.spec.ts`. Entry point:
 * `ml-findings.reads.test.ts` (ADR 0014).
 */
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const H = Date.parse("2026-11-17T08:00:00.000Z");

const dialect = new PgDialect();
const flat = (text: string): string => text.replace(/\s+/g, " ").trim();
const queryOf = (statement: Parameters<PgDialect["sqlToQuery"]>[0]) => dialect.sqlToQuery(statement);

/** S1: each statement that filters assets has its ANY line for every non-null `ids` (`[]` included), none for null. */
export function everyAssetFilterIsPresentWheneverIdsAreGiven(): void {
  const statements = [
    ["forecast findings", (ids: string[] | null) => forecastFindingsStatement(ids, H), /AND f0\.asset_id = ANY\(\$\d+::uuid\[\]\)/],
    ["forecast organizations", (ids: string[] | null) => forecastOrganizationsStatement(ids, H), /AND f0\.asset_id = ANY\(\$\d+::uuid\[\]\)/],
    ["anomaly findings", (ids: string[] | null) => anomalyFindingsStatement(ids, H), /AND s0\.asset_id = ANY\(\$\d+::uuid\[\]\)/],
    ["anomaly organizations", (ids: string[] | null) => anomalyOrganizationsStatement(ids, H), /AND s0\.asset_id = ANY\(\$\d+::uuid\[\]\)/],
  ] as const;
  for (const [label, build, line] of statements) {
    for (const ids of [[A], [A, B], []]) {
      const query = queryOf(build(ids));
      expect(flat(query.sql), `${label} ${JSON.stringify(ids)}`).toMatch(line);
      expect(query.params).toContain(`{${ids.join(",")}}`);
    }
    expect(flat(queryOf(build(null)).sql), label).not.toMatch(/ANY\(/);
  }
}

/** The findings reads reuse the list's chains verbatim (T1.5: the list SQL is unchanged). */
export function theFindingsReadsUseTheListsChains(): void {
  const chainOf = (text: string, until: string): string => text.slice(0, text.indexOf(until));
  const list = flat(queryOf(forecastListStatement([A], H)).sql);
  const findings = flat(queryOf(forecastFindingsStatement([A], H)).sql);
  expect(chainOf(findings, ") SELECT ")).toBe(chainOf(list, ") SELECT "));
  const anomalyList = flat(queryOf(anomalyListStatement([A], H)).sql);
  const anomalyFindings = flat(queryOf(anomalyFindingsStatement([A], H)).sql);
  expect(chainOf(anomalyFindings, ") , hours AS")).toBe(chainOf(anomalyList, ") SELECT "));
}

/** The 48-hour window from the current hour, the look-back for the first bucket, and both fences. */
export function theForecastFindingsReadBoundsTheWindowAndFencesBothLaterals(): void {
  const query = queryOf(forecastFindingsStatement(null, H));
  const text = flat(query.sql);
  expect(text).toMatch(/LIMIT 1 OFFSET 0 \) fb CROSS JOIN LATERAL/);
  expect(text).toMatch(/AND f1\.horizon_bucket >= to_timestamp\(\$\d+::float8 \/ 1000\) AND f1\.horizon_bucket < to_timestamp\(\$\d+::float8 \/ 1000\) OFFSET 0 \) f JOIN/);
  expect(query.params).toEqual([lookBackStartOf(H), H, lookBackStartOf(H), H, H + 48 * HOUR_MS]);
  expect(text).not.toMatch(/\bseverity\b/);
}

/** The means read: the 24 hours before the current hour, the pairs as two bound arrays, the hours with a sample. */
export function theMeansReadCoversTheLast24Hours(): void {
  const query = queryOf(actualMeansStatement([{ assetId: A, pointKey: "kw" }, { assetId: B, pointKey: 'a,"b}' }], H));
  const text = flat(query.sql);
  expect(text).toContain("FROM unnest($1::uuid[], $2::text[]) AS p(asset_id, point_key)");
  expect(text).toContain("(count(*) FILTER (WHERE v.sample_count > 0))::int AS hours");
  expect(query.params).toEqual([`{${A},${B}}`, '{"kw","a,\\"b}"}', H - 24 * HOUR_MS, H]);
}

/** One text[] element per key, whatever the key holds. */
export function aTextArrayQuotesEveryElement(): void {
  expect(textArray([])).toBe("{}");
  expect(textArray(["kw", "pf"])).toBe('{"kw","pf"}');
  expect(textArray(['a,b', 'c"d', "e\\f", "{g}"])).toBe('{"a,b","c\\"d","e\\\\f","{g}"}');
}

/** The rule read: the covered shapes only, the organization carried by hand, never the severity. */
export function theRuleReadCarriesTheOrganizationAndTheCoveredShapes(): void {
  const query = queryOf(thresholdRulesStatement([{ assetId: A, pointKey: "cold_room_temp_c" }]));
  const text = flat(query.sql);
  expect(text).toContain("JOIN bms.assets a ON a.id = r.asset_id AND a.organization_id = r.organization_id");
  expect(text).toContain(
    "WHERE r.rule_type = 'threshold' AND r.enabled AND r.lifecycle_status = 'published' AND r.operator IN ('gt', 'gte', 'lt', 'lte') AND r.threshold_value IS NOT NULL AND r.condition ->> 'window' = 'latest'",
  );
  expect(text).not.toMatch(/\bseverity\b/);
  expect(query.params).toEqual([`{${A}}`, '{"cold_room_temp_c"}']);
}

/**
 * The anomaly aggregate: the line is `ANOMALY_UNUSUAL_SCORE`, bound and compared with `>=`, after
 * the newest run; an hour is one `(asset, bucket)` group, so two detectors marking it count once.
 */
export function theAnomalyFindingsAggregateCountsAnHourOnceAtTheLine(): void {
  const query = queryOf(anomalyFindingsStatement(null, H));
  const text = flat(query.sql);
  const lines = text.match(/score >= \$(\d+)::float8/g) ?? [];
  expect(lines, "three uses of the line, each `>=`").toHaveLength(3);
  for (const use of lines) {
    const index = Number(/\$(\d+)/.exec(use)?.[1]) - 1;
    expect(query.params[index]).toBe(ANOMALY_UNUSUAL_SCORE);
  }
  expect(text).not.toMatch(/score > \$/);
  expect(text).toMatch(/FROM current_scores GROUP BY asset_id, bucket \)/);
  expect(text).toContain("count(*) FILTER (WHERE marks >= 1) AS unusual_hours");
  expect(text).toContain("count(*) FILTER (WHERE marks >= 2) AS both_hours");
  expect(text).toContain("count(*) FILTER (WHERE marks = 1 AND baseline_marked) AS baseline_only_hours");
  expect(text).toContain("max(bucket) FILTER (WHERE marks >= 1) AS last_unusual");
  expect(text).toMatch(/AND detector = \$\d+\) AS baseline_marked/);
  expect(query.params).toContain("baseline_mad");
  expect(query.params).toContain(ANOMALY_MODEL_NAME);
  expect(text).toContain("JOIN per_asset p ON p.asset_id = c.asset_id AND p.last_unusual = c.bucket");
}

/** The two organization reads: one fenced row per run, the distinct organizations. */
export function theOrganizationReadsTakeOneRowPerRun(): void {
  for (const statement of [forecastOrganizationsStatement([A], H), anomalyOrganizationsStatement([A], H)]) {
    const text = flat(queryOf(statement).sql);
    expect(text).toMatch(/LIMIT 1 OFFSET 0 \) [fs] LEFT JOIN bms\.organizations o/);
    expect(text).toMatch(/SELECT DISTINCT [fs]\.organization_id AS organization_id, o\.code AS organization_code, o\.name AS organization_name/);
  }
}

/** The runners execute their statement on the given `tx` and return its rows; no pair reads nothing. */
export async function theRunnersUseTheTransactionTheyAreGiven(): Promise<void> {
  const executed: string[] = [];
  const tx = {
    execute: async (statement: Parameters<PgDialect["sqlToQuery"]>[0]) => {
      executed.push(flat(queryOf(statement).sql).slice(0, 40));
      return { rows: [{ marker: executed.length }] };
    },
  } as unknown as BmsTx;
  const pair = [{ assetId: A, pointKey: "kw" }];
  expect(await readForecastFindings(tx, [A], H)).toEqual([{ marker: 1 }]);
  expect(await readActualMeans(tx, pair, H)).toEqual([{ marker: 2 }]);
  expect(await readThresholdRules(tx, pair)).toEqual([{ marker: 3 }]);
  expect(await readForecastOrganizations(tx, [A], H)).toEqual([{ marker: 4 }]);
  expect(await readAnomalyFindings(tx, [A], H)).toEqual([{ marker: 5 }]);
  expect(await readAnomalyOrganizations(tx, [A], H)).toEqual([{ marker: 6 }]);
  expect(await readActualMeans(tx, [], H)).toEqual([]);
  expect(await readThresholdRules(tx, [])).toEqual([]);
  expect(executed).toHaveLength(6);
}
