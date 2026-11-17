import { PgDialect } from "drizzle-orm/pg-core";
import { ANOMALY_DETECTORS, ANOMALY_MODEL_NAME, ANOMALY_UNUSUAL_SCORE, TERMINAL_WORK_ORDER_STATUSES } from "@bms/shared";
import { expect } from "vitest";

import { anomalyHealthHoursStatement, assetLabelsStatement, openCorrectiveStatement } from "./health-inputs.reads";

/**
 * `E1.8a` / ADR 0050 Amendment 5 (plan T1.5) — the health inputs statements'
 * text, the part a unit test can hold without a database (the
 * `ml-anomalies.reads.spec.ts` shape). The rows they select are held against
 * Postgres in `health-inputs.integration.spec.ts`. Entry point:
 * `health-inputs.reads.test.ts` (ADR 0014).
 */
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const SINCE = Date.parse("2026-11-10T10:00:00.000Z");
const NOW = Date.parse("2026-11-17T10:30:00.000Z");

const dialect = new PgDialect();
/** Whitespace folded, so a re-indent is not a failure but a dropped clause is. */
const flat = (text: string): string => text.replace(/\s+/g, " ").trim();

const ANY_LINE = /AND s0\.asset_id = ANY\(\$\d+::uuid\[\]\)/;

/** S1: the asset line is present whenever ids is not null — an empty list included — and absent only for null. */
export function theHoursReadFiltersByAssetWheneverIdsAreGiven(): void {
  for (const ids of [[A], [A, B], []]) {
    const query = dialect.sqlToQuery(anomalyHealthHoursStatement(ids, SINCE));
    expect(flat(query.sql), JSON.stringify(ids)).toMatch(ANY_LINE);
    expect(query.params).toContain(`{${ids.join(",")}}`);
  }
  expect(flat(dialect.sqlToQuery(anomalyHealthHoursStatement(null, SINCE)).sql)).not.toMatch(/ANY\(/);
}

/** The imported chain: the per-run lateral keeps its `OFFSET 0` fence, and newest run wins before any threshold. */
export function theHoursReadKeepsTheFencedChain(): void {
  const text = flat(dialect.sqlToQuery(anomalyHealthHoursStatement([A], SINCE)).sql);
  expect(text).toMatch(/OFFSET 0 \) s \)/);
  expect(text).toContain(
    "SELECT DISTINCT ON (asset_id, bucket, detector) asset_id, bucket, detector, score, contributing_points FROM scored ORDER BY asset_id, bucket, detector, started_at DESC, run_id DESC",
  );
  const lateral = text.slice(text.indexOf("CROSS JOIN LATERAL"), text.indexOf("current_scores AS"));
  expect(lateral, "the lateral").not.toMatch(/score >=/);
}

/** §4.1: the line and both detector names are parameters, never text; a strong hour needs both detectors. */
export function theLineAndTheDetectorsAreParameters(): void {
  const query = dialect.sqlToQuery(anomalyHealthHoursStatement([A], SINCE));
  const text = flat(query.sql);
  expect(text).not.toContain(String(ANOMALY_UNUSUAL_SCORE));
  for (const detector of ANOMALY_DETECTORS) expect(text).not.toContain(detector);
  expect(query.params).toEqual([
    ANOMALY_MODEL_NAME,
    SINCE,
    SINCE,
    `{${A}}`,
    ANOMALY_UNUSUAL_SCORE,
    ANOMALY_UNUSUAL_SCORE,
    ANOMALY_DETECTORS[0],
    ANOMALY_UNUSUAL_SCORE,
    ANOMALY_DETECTORS[1],
    ANOMALY_UNUSUAL_SCORE,
  ]);
  expect(text).toMatch(/bool_or\(score >= \$\d+::float8\) AS marked/);
  expect(text).toMatch(/bool_or\(score >= \$\d+::float8 AND detector = \$\d+\) AS baseline_marked/);
  expect(text).toMatch(/bool_or\(score >= \$\d+::float8 AND detector = \$\d+\) AS forest_marked/);
  expect(text).toContain("count(*) FILTER (WHERE baseline_marked AND forest_marked) AS strong_hours");
  expect(text).toContain("count(*) FILTER (WHERE baseline_marked AND NOT forest_marked) AS baseline_only_hours");
  expect(text).toContain("count(*) FILTER (WHERE marked) AS unusual_hours");
  expect(text).toContain("count(*) AS scored_hours");
  expect(text).toMatch(/WHERE c\.score >= \$\d+::float8 GROUP BY c\.asset_id/);
  for (const alias of [
    "AS asset_id",
    "AS scored_hours",
    "AS unusual_hours",
    "AS strong_hours",
    "AS baseline_only_hours",
    "AS last_unusual_ms",
    "AS last_points",
    "AS asset_code",
    "AS asset_name",
    "AS asset_rtu_name",
    "AS location_id",
    "AS location_name",
  ]) {
    expect(text).toContain(alias);
  }
}

/** Q1(a): open (not resolved, closed or cancelled), not linked by a maintenance record; past SLA by the request's clock. */
export function theTicketReadBindsTheAssetAndTheStatusList(): void {
  const query = dialect.sqlToQuery(openCorrectiveStatement(A, NOW));
  const text = flat(query.sql);
  expect(query.params).toEqual([NOW, A, `{${["resolved", ...TERMINAL_WORK_ORDER_STATUSES].join(",")}}`]);
  expect(query.sql).not.toContain(A);
  expect(text).not.toMatch(/'resolved'|'closed'|'cancelled'/);
  expect(text).toMatch(/WHERE w\.asset_id = \$\d+::uuid AND w\.status <> ALL\(\$\d+::text\[\]\)/);
  expect(text).toContain(
    "AND NOT EXISTS (SELECT 1 FROM bms.maintenance_history h WHERE h.asset_id = w.asset_id AND h.work_order_id = w.id)",
  );
  expect(text).toMatch(
    /count\(\*\) FILTER \(WHERE w\.sla_minutes IS NOT NULL AND w\.sla_due_at IS NOT NULL AND w\.sla_due_at < to_timestamp\(\$\d+::float8 \/ 1000\)\)\)::int AS past_sla/,
  );
  expect(text).toMatch(/^SELECT count\(\*\)::int AS open_corrective,/);
}

/** The labels: by id through `uuidArray`, every column aliased. */
export function theLabelReadBindsTheIds(): void {
  const query = dialect.sqlToQuery(assetLabelsStatement([A, B]));
  const text = flat(query.sql);
  expect(query.params).toEqual([`{${A},${B}}`]);
  expect(text).toMatch(/WHERE a\.id = ANY\(\$1::uuid\[\]\)/);
  for (const alias of ["AS asset_id", "AS asset_code", "AS asset_name", "AS asset_rtu_name", "AS location_id", "AS location_name"]) {
    expect(text).toContain(alias);
  }
  expect(() => assetLabelsStatement(["not-a-uuid"])).toThrow();
}
