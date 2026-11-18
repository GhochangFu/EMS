import { DEGRADATION_DRIFT_TARGETS } from "@bms/shared";
import { PgDialect } from "drizzle-orm/pg-core";
import type { Pool } from "pg";
import { expect } from "vitest";

import type { BmsTx } from "../database/tenant-context";
import {
  activeSchedulesStatement,
  degradationCandidatesStatement,
  driftPointsOf,
  readActiveSchedules,
  readCounterDays,
  readMeanDays,
  type DegradationCandidateDbRow,
} from "./degradation.reads";

/**
 * `E1.5a` / ADR 0138 (plan T1.7, T1.8, R-c, R-k) — the module's four statements
 * as text. The candidate statement holds the ML "real" line (twice: the asset's
 * `EXISTS` and each drift point), `a.active`, `ap.active`, the target classes as
 * three bound arrays and the asset filter chosen by `ids === null`. The schedule
 * statement keeps the organization on both joins and reads active schedules
 * only. The two fleet statements bind `unnest($1::uuid[], …)` and group by the
 * local day of the bound zone. Every value is a bound parameter. Assertions live
 * here; `degradation.reads.test.ts` is the vitest entry point (ADR 0014).
 */
const dialect = new PgDialect();
const normalise = (text: string): string => text.replace(/\s+/g, " ").trim();
const REAL = "a.meta->>'telemetrySource' = 'mqtt' OR (ap.source_kind = 'measured' AND r.ingest_enabled)";
const A1 = "aaaaaaaa-0000-4000-8000-000000000001";
const A2 = "aaaaaaaa-0000-4000-8000-000000000002";
const S1 = "eeeeeeee-0000-4000-8000-000000000001";
const ZONE = "Asia/Kolkata";

type Call = { text: string; values: unknown[] };
function fakePool(rows: unknown[]): { pool: Pick<Pool, "query">; calls: Call[] } {
  const calls: Call[] = [];
  const pool = {
    query: async (text: string, values: unknown[]) => {
      calls.push({ text, values });
      return { rows };
    },
  };
  return { calls, pool: pool as unknown as Pick<Pool, "query"> };
}

/** A `tx` that records the drizzle statement it is handed and answers `rows`. */
function fakeTx(rows: unknown[]): { tx: BmsTx; statements: { sql: string; params: unknown[] }[] } {
  const statements: { sql: string; params: unknown[] }[] = [];
  const tx = {
    execute: async (statement: Parameters<PgDialect["sqlToQuery"]>[0]) => {
      statements.push(dialect.sqlToQuery(statement));
      return { rows };
    },
  };
  return { tx: tx as unknown as BmsTx, statements };
}

export function theCandidateStatementHoldsTheRealLineAndTheActiveFlags(): void {
  for (const ids of [null, [A1, A2]]) {
    const text = normalise(dialect.sqlToQuery(degradationCandidatesStatement(ids)).sql);
    // The real line, word for word: once for the asset's EXISTS, once for each drift point.
    expect(text.split(REAL)).toHaveLength(3);
    expect(text).toMatch(/\ba\.active\b/);
    expect(text).toMatch(/\bap\.active\b/);
    expect(text).toContain("LEFT JOIN bms.rtus r ON r.id = ap.rtu_id");
    expect(text).toContain("l.timezone AS location_zone");
    expect(text).toContain("o.timezone AS organization_zone");
    expect(text).toContain("t.asset_type");
    expect(text).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
  }
}

export function theTargetClassesAreBoundArraysNotText(): void {
  const { sql, params } = dialect.sqlToQuery(degradationCandidatesStatement(null));
  const text = normalise(sql);
  expect(text).toContain("unnest($1::text[], $2::text[], $3::text[]) AS tg(domain, asset_type, point_key)");
  expect(text).toContain("tg.domain = a.domain");
  expect(text).toContain("tg.asset_type = t.asset_type");
  expect(text).toContain("tg.point_key = ap.point_key");
  expect(params).toHaveLength(3);
  // The three arrays are the contract's classes, element for element.
  const elements = (literal: unknown): string[] =>
    String(literal).slice(1, -1).split(",").map((v) => v.replace(/^"|"$/g, ""));
  expect(elements(params[0])).toEqual(DEGRADATION_DRIFT_TARGETS.map((t) => t.domain));
  expect(elements(params[1])).toEqual(DEGRADATION_DRIFT_TARGETS.map((t) => t.assetType));
  expect(elements(params[2])).toEqual(DEGRADATION_DRIFT_TARGETS.map((t) => t.pointKey));
  // No class is spliced into the text.
  for (const target of DEGRADATION_DRIFT_TARGETS) expect(text).not.toContain(`'${target.pointKey}'`);
  expect(text).not.toContain("'energy_meter'");
}

export function theAssetFilterIsChosenByIdsBeingNull(): void {
  const all = dialect.sqlToQuery(degradationCandidatesStatement(null));
  expect(all.sql).not.toMatch(/a\.id = ANY\(/);
  const some = dialect.sqlToQuery(degradationCandidatesStatement([A1, A2]));
  expect(normalise(some.sql)).toContain("a.id = ANY($4::uuid[])");
  expect(some.params[3]).toBe(`{${A1},${A2}}`);
  // An empty list is still a filter (it matches nothing), never the admin's unfiltered read.
  expect(normalise(dialect.sqlToQuery(degradationCandidatesStatement([])).sql)).toContain("a.id = ANY($4::uuid[])");
  expect(() => degradationCandidatesStatement(["not-a-uuid"])).toThrow(/not a UUID/);
}

export function aCandidateRowListsItsDriftPoints(): void {
  const row = (drift: unknown): DegradationCandidateDbRow => ({
    asset_id: A1,
    organization_id: A2,
    location_id: A2,
    asset_code: "FX-D1",
    asset_name: "Fixture cold room",
    asset_rtu_name: null,
    location_name: "Cold Store",
    location_zone: ZONE,
    organization_zone: "UTC",
    drift_points: drift as DegradationCandidateDbRow["drift_points"],
  });
  expect(driftPointsOf(row([{ point_key: "cold_room_temp_c", unit: "degC" }]))).toEqual([
    { pointKey: "cold_room_temp_c", unit: "degC" },
  ]);
  expect(driftPointsOf(row([]))).toEqual([]);
  expect(driftPointsOf(row(null))).toEqual([]);
}

export async function theScheduleStatementReadsActiveSchedulesOfTheIds(): Promise<void> {
  const { sql, params } = dialect.sqlToQuery(activeSchedulesStatement([A1, A2]));
  const text = normalise(sql);
  expect(text).toContain("FROM bms.maintenance_schedules s");
  expect(text).toContain("JOIN bms.maintenance_task_templates t ON t.id = s.template_id AND t.organization_id = s.organization_id");
  expect(text).toContain("JOIN bms.assets a ON a.id = t.asset_id AND a.organization_id = s.organization_id");
  expect(text).toContain("WHERE s.active AND t.asset_id = ANY($1::uuid[])");
  expect(text).toContain("ORDER BY t.asset_id, s.next_due_at, s.id");
  expect(params).toEqual([`{${A1},${A2}}`]);
  expect(() => activeSchedulesStatement(["x"])).toThrow(/not a UUID/);

  const due = Date.parse("2027-01-17T06:00:00.000Z");
  const { tx, statements } = fakeTx([{ schedule_id: S1, asset_id: A1, next_due_ms: String(due) }]);
  expect(await readActiveSchedules(tx, [A1])).toEqual([{ scheduleId: S1, assetId: A1, nextDueMs: due }]);
  expect(statements).toHaveLength(1);
  // No id, no read.
  const empty = fakeTx([]);
  expect(await readActiveSchedules(empty.tx, [])).toEqual([]);
  expect(empty.statements).toEqual([]);
}

export async function theCounterReadSumsTheCountsAndTakesTheMaxOfTheTallies(): Promise<void> {
  const fromMs = Date.parse("2026-10-20T18:30:00.000Z");
  const toMs = Date.parse("2026-11-17T18:30:00.000Z");
  const { pool, calls } = fakePool([
    { asset_id: A1, point_key: "t1", day: "2026-10-21", in_range_count: "900", sample_count: "1000", rule_count: 2, skipped_rule_count: "1" },
  ]);
  const rows = await readCounterDays(pool, [{ assetId: A1, zone: ZONE }, { assetId: A2, zone: "UTC" }], fromMs, toMs);
  expect(rows).toEqual([
    { assetId: A1, pointKey: "t1", day: "2026-10-21", inRangeCount: 900, sampleCount: 1000, ruleCount: 2, skippedRuleCount: 1 },
  ]);
  expect(calls).toHaveLength(1);
  const text = normalise(calls[0]!.text);
  expect(text).toContain("FROM telemetry.point_in_range_1h c");
  expect(text).toContain("JOIN unnest($1::uuid[], $2::text[]) AS z(asset_id, zone) ON z.asset_id = c.asset_id");
  expect(text).toContain("c.bucket >= $3 AND c.bucket < $4");
  expect(text).toContain("sum(c.in_range_count)");
  expect(text).toContain("sum(c.sample_count)");
  expect(text).toContain("max(c.rule_count)");
  expect(text).toContain("max(c.skipped_rule_count)");
  expect(text).not.toMatch(/sum\(c\.(rule_count|skipped_rule_count)\)/);
  expect(text).toContain("GROUP BY c.asset_id, c.point_key, (c.bucket AT TIME ZONE z.zone)::date");
  expect(calls[0]!.values).toEqual([[A1, A2], [ZONE, "UTC"], new Date(fromMs), new Date(toMs)]);
  // No asset, no read.
  const empty = fakePool([]);
  expect(await readCounterDays(empty.pool, [], fromMs, toMs)).toEqual([]);
  expect(empty.calls).toEqual([]);
}

export async function theMeanReadIsTheHourlyAggregateGroupedByLocalDay(): Promise<void> {
  const fromMs = Date.parse("2026-10-20T18:30:00.000Z");
  const toMs = Date.parse("2026-11-17T18:30:00.000Z");
  const { pool, calls } = fakePool([
    { asset_id: A1, point_key: "cold_room_temp_c", day: "2026-10-21", mean: "4.1", sample_count: "24" },
    { asset_id: A1, point_key: "cold_room_temp_c", day: "2026-10-22", mean: null, sample_count: 0 },
  ]);
  const rows = await readMeanDays(pool, [{ assetId: A1, pointKey: "cold_room_temp_c", zone: ZONE }], fromMs, toMs);
  expect(rows).toEqual([
    { assetId: A1, pointKey: "cold_room_temp_c", day: "2026-10-21", mean: 4.1, sampleCount: 24 },
    { assetId: A1, pointKey: "cold_room_temp_c", day: "2026-10-22", mean: null, sampleCount: 0 },
  ]);
  const text = normalise(calls[0]!.text);
  expect(text).toContain("FROM telemetry.point_values_1h v");
  expect(text).toContain(
    "JOIN unnest($1::uuid[], $2::text[], $3::text[]) AS z(asset_id, point_key, zone) ON z.asset_id = v.asset_id AND z.point_key = v.point_key",
  );
  expect(text).toContain("v.bucket >= $4 AND v.bucket < $5");
  expect(text).toContain("(sum(v.sum_value) / sum(v.sample_count))");
  expect(text).toContain("sum(v.sample_count)");
  expect(text).toContain("GROUP BY v.asset_id, v.point_key, (v.bucket AT TIME ZONE z.zone)::date");
  expect(calls[0]!.values).toEqual([[A1], ["cold_room_temp_c"], [ZONE], new Date(fromMs), new Date(toMs)]);
  const empty = fakePool([]);
  expect(await readMeanDays(empty.pool, [], fromMs, toMs)).toEqual([]);
  expect(empty.calls).toEqual([]);
}
