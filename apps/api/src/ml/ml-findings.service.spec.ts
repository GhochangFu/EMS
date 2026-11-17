import { PgDialect } from "drizzle-orm/pg-core";
import type { BmsDb } from "@bms/db";
import { mlFindingsSummaryResponseSchema } from "@bms/shared";
import { expect } from "vitest";

import {
  FXB,
  FX_NOW,
  forecastRows,
  fxaColdRoomPoints,
  fxbAnomalyRows,
  meansOf,
  organizationRow,
} from "./ml-findings.fixture";
import { MlFindingsService } from "./ml-findings.service";

/**
 * `E1.9a` (plan T1.6) — the service's order of reads on one transaction, with
 * the pools faked: a global admin (`null`) reads on the fleet branch's
 * transaction; `[]` reads nothing; the means and rule reads run only when the
 * findings read returned rows; the Q1(a) organization read always runs. The
 * routing itself is `withReadScope`'s, held in its own specs and the
 * integration suite. Entry point: `ml-findings.service.test.ts` (ADR 0014).
 */
const dialect = new PgDialect();

type Answer = { match: RegExp; rows: unknown[] };

function pools(answers: Answer[]) {
  const executed: string[] = [];
  const tx = {
    execute: async (statement: Parameters<PgDialect["sqlToQuery"]>[0]) => {
      const text = dialect.sqlToQuery(statement).sql.replace(/\s+/g, " ");
      const answer = answers.find((a) => a.match.test(text));
      executed.push(answer?.match.source ?? text.slice(0, 60));
      return { rows: answer?.rows ?? [] };
    },
  };
  let transactions = 0;
  const fleetDb = {
    transaction: async <T>(fn: (t: typeof tx) => Promise<T>) => {
      transactions += 1;
      return fn(tx);
    },
  } as unknown as BmsDb;
  const tenantDb = {} as unknown as BmsDb;
  return { svc: new MlFindingsService(tenantDb, fleetDb), executed, transactions: () => transactions };
}

const FINDINGS = /AS first_bucket_ms/;
const MEANS = /telemetry\.point_values_1h/;
const RULES = /bms\.automation_rules/;
const ANOMALY_ORGS = /SELECT DISTINCT s\.organization_id/;
const ANOMALY_FINDINGS = /AS baseline_only_hours/;
const FORECAST_ORGS = /SELECT DISTINCT f\.organization_id/;

export async function theForecastSummaryReadsInOrderOnOneTransaction(): Promise<void> {
  const points = fxaColdRoomPoints();
  const p = pools([
    { match: FINDINGS, rows: points.flatMap(forecastRows) },
    { match: MEANS, rows: meansOf(points) },
    { match: RULES, rows: [] },
    { match: ANOMALY_ORGS, rows: [organizationRow(FXB)] },
  ]);
  const body = mlFindingsSummaryResponseSchema.parse(await p.svc.forecastSummary(null, false, FX_NOW));
  expect(p.transactions()).toBe(1);
  expect(p.executed).toEqual([FINDINGS.source, MEANS.source, RULES.source, ANOMALY_ORGS.source]);
  expect(body.asOf).toBe(FX_NOW.toISOString());
  expect(body.cards.map((c) => c.organizationCode)).toEqual(["FXA", "FXB"]);
  expect(body.cards[1]?.facts).toEqual([{ id: "F_NONE", segments: [{ text: "No forecast points for this organization." }] }]);
  // The internal form keeps the time as its own part.
  const facts = await pools([{ match: FINDINGS, rows: points.flatMap(forecastRows) }]).svc.forecastFacts(null, true, FX_NOW);
  expect(facts.cards[0]?.facts[0]?.parts.map((part) => part.kind)).toEqual(["text", "time", "text"]);
}

export async function noForecastRowSkipsTheMeansAndRules(): Promise<void> {
  const p = pools([
    { match: FINDINGS, rows: [] },
    { match: ANOMALY_ORGS, rows: [organizationRow(FXB)] },
  ]);
  const body = await p.svc.forecastSummary(null, true, FX_NOW);
  expect(p.executed).toEqual([FINDINGS.source, ANOMALY_ORGS.source]);
  expect(body.cards[0]?.facts[0]?.segments).toEqual([{ text: "No forecast points in this selection." }]);
}

export async function anEmptyScopeReadsNothing(): Promise<void> {
  const p = pools([]);
  expect(await p.svc.forecastSummary([], false, FX_NOW)).toEqual({ asOf: FX_NOW.toISOString(), cards: [] });
  expect(await p.svc.anomalySummary([], false, FX_NOW)).toEqual({ asOf: FX_NOW.toISOString(), cards: [] });
  expect(p.transactions()).toBe(0);
  expect(p.executed).toEqual([]);
}

export async function theAnomalySummaryReadsTheAggregateThenTheOrganizations(): Promise<void> {
  const p = pools([
    { match: ANOMALY_FINDINGS, rows: fxbAnomalyRows() },
    { match: FORECAST_ORGS, rows: [] },
  ]);
  const body = mlFindingsSummaryResponseSchema.parse(await p.svc.anomalySummary(null, false, FX_NOW));
  expect(p.executed).toEqual([ANOMALY_FINDINGS.source, FORECAST_ORGS.source]);
  expect(body.cards.map((c) => c.organizationCode)).toEqual(["FXB"]);
  expect(body.cards[0]?.facts.map((f) => f.id)).toEqual(["A1", "A2", "A3", "A3", "A3", "A4"]);
}
