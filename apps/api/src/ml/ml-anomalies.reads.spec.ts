import { PgDialect } from "drizzle-orm/pg-core";
import { ANOMALY_LIST_MAX_ROWS, ANOMALY_MODEL_NAME, ANOMALY_UNUSUAL_SCORE } from "@bms/shared";
import { expect } from "vitest";

import { anomalyListStatement, assetAnomaliesStatement } from "./ml-anomalies.reads";
import { HOUR_MS } from "./ml-forecasts.pure";

/**
 * `E1.2b` / ADR 0135 Amendment 5 A-e (Amendment 3 S1; plan R12, R13) — the
 * anomaly statements' text, the part a unit test can hold without a database.
 * The rows they select are held against Postgres in
 * `ml-anomalies.integration.spec.ts`. Entry point: `ml-anomalies.reads.test.ts`
 * (ADR 0014).
 */
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const H = Date.parse("2026-11-16T10:00:00.000Z");

const dialect = new PgDialect();
/** Whitespace folded, so a re-indent is not a failure but a dropped clause is. */
const flat = (text: string): string => text.replace(/\s+/g, " ").trim();

const ANY_LINE = /AND s0\.asset_id = ANY\(\$\d+::uuid\[\]\)/;
const SUCCEEDED_JOIN =
  "JOIN ml.model_runs r ON r.id = s.model_run_id AND r.organization_id = s.organization_id AND r.status = 'succeeded'";

/** The one-asset read: the succeeded join, the asset and window bound, newest run first per hour and detector. */
export function theAssetStatementHoldsTheJoinTheWindowAndTheNewestRun(): void {
  const query = dialect.sqlToQuery(assetAnomaliesStatement(A, H - 24 * HOUR_MS, H));
  const text = flat(query.sql);
  expect(text).toMatch(/^SELECT DISTINCT ON \(s\.bucket, s\.detector\)/);
  expect(text).toContain(SUCCEEDED_JOIN);
  expect(text).toMatch(
    /WHERE s\.asset_id = \$\d+::uuid AND s\.bucket >= to_timestamp\(\$\d+::float8 \/ 1000\) AND s\.bucket < to_timestamp\(\$\d+::float8 \/ 1000\)/,
  );
  expect(text).toMatch(/ORDER BY s\.bucket, s\.detector, r\.started_at DESC, r\.id DESC$/);
  for (const alias of ["AS bucket_ms", "AS detector", "AS score", "AS contributing_points"]) {
    expect(text).toContain(alias);
  }
  expect(query.params).toEqual([A, H - 24 * HOUR_MS, H]);
  expect(query.sql).not.toContain(A);
}

/** S1: the ANY line is present whenever ids is not null — an empty list included — and absent only for null. */
export function theListFiltersByAssetWheneverIdsAreGiven(): void {
  for (const ids of [[A], [A, B], []]) {
    const query = dialect.sqlToQuery(anomalyListStatement(ids, H));
    expect(flat(query.sql), JSON.stringify(ids)).toMatch(ANY_LINE);
    expect(query.params).toContain(`{${ids.join(",")}}`);
  }
  const unrestricted = dialect.sqlToQuery(anomalyListStatement(null, H));
  expect(flat(unrestricted.sql)).not.toMatch(/ANY\(/);
}

/**
 * R12 then R13: the succeeded anomaly runs since the bound, the newest run per hour and detector,
 * and only then the threshold; newest first; one row over the cap.
 */
export function theListPicksTheNewestRunBeforeTheThreshold(): void {
  const query = dialect.sqlToQuery(anomalyListStatement([A], H - 7 * 24 * HOUR_MS));
  const text = flat(query.sql);
  expect(text).toMatch(
    /FROM ml\.model_runs r WHERE r\.status = 'succeeded' AND r\.model_name = \$\d+ AND r\.started_at >= to_timestamp\(\$\d+::float8 \/ 1000\)/,
  );
  expect(text).toMatch(/AND s0\.bucket >= to_timestamp\(\$\d+::float8 \/ 1000\)/);
  expect(text).toContain(
    "SELECT DISTINCT ON (asset_id, bucket, detector) asset_id, bucket, detector, score, contributing_points FROM scored ORDER BY asset_id, bucket, detector, started_at DESC, run_id DESC",
  );
  // The threshold sits after current_scores, never inside the lateral (R12).
  const lateral = text.slice(text.indexOf("CROSS JOIN LATERAL"), text.indexOf("current_scores AS"));
  expect(lateral, "the lateral").not.toMatch(/score >=/);
  expect(text).toMatch(/FROM current_scores c .* WHERE c\.score >= \$\d+::float8 ORDER BY c\.bucket DESC, l\.name, a\.code, c\.detector LIMIT \$\d+$/);
  expect(text).toMatch(/OFFSET 0 \) s \)/);
  expect(query.params).toEqual([
    ANOMALY_MODEL_NAME,
    H - 7 * 24 * HOUR_MS,
    H - 7 * 24 * HOUR_MS,
    `{${A}}`,
    ANOMALY_UNUSUAL_SCORE,
    ANOMALY_LIST_MAX_ROWS + 1,
  ]);
}

/** Every output column is aliased: a raw read keys the row by column name, and two `timezone`s would collide. */
export function everyListColumnIsAliased(): void {
  const text = flat(dialect.sqlToQuery(anomalyListStatement(null, H)).sql);
  const select = text.slice(text.lastIndexOf("SELECT c.asset_id"), text.indexOf("FROM current_scores c"));
  const columns = select.replace(/^SELECT /, "").split(/,(?![^()]*\))/).map((column) => column.trim());
  expect(columns).toHaveLength(12);
  for (const column of columns) {
    expect(column, column).toMatch(/ AS [a-z_]+$/);
  }
}
