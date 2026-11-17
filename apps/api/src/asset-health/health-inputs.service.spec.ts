import { Logger } from "@nestjs/common";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { BmsDb } from "@bms/db";
import { assetHealthInputsResponseSchema, healthBadActorsResponseSchema } from "@bms/shared";
import { expect, vi } from "vitest";

import { DEFAULT_HEALTH_WINDOW_MINUTES } from "./asset-health.schema";
import type { AssetHealthService, HealthLocationFilter, HealthScopeScore } from "./asset-health.service";
import { CR, FX_NOW, MTR, fx, hoursRow, labelRow, scopeScore } from "./health-inputs.fixture";
import { HealthInputsService } from "./health-inputs.service";

/**
 * `E1.8a` / ADR 0050 Amendment 5 (plan T1.3, T1.6, R-g) — the service's reads
 * with the pools faked (the `ml-findings.service.spec.ts` shape): each fact in
 * its own transaction, a failed fact read is quiet (`null`, one `warn` with a
 * fixed message and the error's class name), the bad-actors read scores the
 * scope once and hands the anomaly read exactly the in-scope ids. The routing
 * itself is `withReadScope`'s; the fake answers its organization read with one
 * organization (the tenant branch) unless a case says otherwise. Entry point:
 * `health-inputs.service.test.ts` (ADR 0014).
 */
const dialect = new PgDialect();
const flat = (statement: SQL): { text: string; params: unknown[] } => {
  const query = dialect.sqlToQuery(statement);
  return { text: query.sql.replace(/\s+/g, " "), params: query.params };
};

const HOURS = /AS baseline_only_hours/;
const TICKETS = /AS open_corrective/;
const LABELS = /^ SELECT a\.id AS asset_id, a\.code AS asset_code/;
const SECRET = "boom: relation detail for asset";

type Answer = { match: RegExp; rows?: unknown[]; throws?: boolean };

const m = (i: number) => fx(MTR, i - 1);
const c = (i: number) => fx(CR, i - 1);

function harness(opts: { answers: Answer[]; organizations?: number; scores?: HealthScopeScore[] }) {
  const executed: { match: string; transaction: number; params: unknown[] }[] = [];
  const routedBy: unknown[][] = [];
  let transactions = 0;
  const run = async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
    transactions += 1;
    const id = transactions;
    const tx = {
      execute: async (statement: SQL) => {
        const { text, params } = flat(statement);
        if (/set_config\('app\.current_organization'/.test(text)) return { rows: [] };
        const answer = opts.answers.find((a) => a.match.test(text));
        executed.push({ match: answer?.match.source ?? text.slice(0, 60), transaction: id, params });
        if (answer?.throws) throw new TypeError(SECRET);
        return { rows: answer?.rows ?? [] };
      },
    };
    return fn(tx);
  };
  const organizations = Array.from({ length: opts.organizations ?? 1 }, (_, i) => ({ organizationId: `org-${i}` }));
  const fleetDb = {
    select: () => ({
      from: () => ({
        where: (predicate: SQL) => {
          routedBy.push(flat(predicate).params);
          return { groupBy: async () => organizations };
        },
      }),
    }),
    transaction: run,
  } as unknown as BmsDb;
  const tenantDb = { transaction: run } as unknown as BmsDb;
  const scopeCalls: { assetIds: readonly string[] | null; location: HealthLocationFilter | undefined; windowMinutes: number; now: Date }[] = [];
  const health = {
    scoresInScope: async (
      assetIds: readonly string[] | null,
      location: HealthLocationFilter | undefined,
      windowMinutes: number,
      now: Date,
    ) => {
      scopeCalls.push({ assetIds, location, windowMinutes, now });
      return opts.scores ?? [];
    },
  } as unknown as AssetHealthService;
  return {
    svc: new HealthInputsService(tenantDb, fleetDb, health),
    executed,
    routedBy,
    scopeCalls,
    transactions: () => transactions,
  };
}

/** Captures `Logger.prototype.warn` for the duration of `fn`. */
async function warnsOf<T>(fn: () => Promise<T>): Promise<{ value: T; warns: unknown[][] }> {
  const warns: unknown[][] = [];
  const spy = vi.spyOn(Logger.prototype, "warn").mockImplementation((...args: unknown[]) => void warns.push(args));
  try {
    return { value: await fn(), warns };
  } finally {
    spy.mockRestore();
  }
}

const TICKET_ROW = { open_corrective: 2, past_sla: 1 };

/** `forAsset`: the anomaly read, then the ticket read, each in its own transaction, routed by the one asset. */
export async function forAssetReadsEachFactInItsOwnTransaction(): Promise<void> {
  const h = harness({ answers: [{ match: HOURS, rows: [hoursRow(m(1), { strong: 3, baselineOnly: 5 })] }, { match: TICKETS, rows: [TICKET_ROW] }] });
  const body = assetHealthInputsResponseSchema.parse(await h.svc.forAsset(m(1).id, FX_NOW));
  expect(h.executed.map((e) => e.match)).toEqual([HOURS.source, TICKETS.source]);
  expect(h.executed.map((e) => e.transaction)).toEqual([1, 2]);
  expect(h.transactions()).toBe(2);
  expect(h.routedBy).toEqual([[m(1).id], [m(1).id]]);
  expect(h.executed[0]?.params).toContain(`{${m(1).id}}`);
  expect(h.executed[1]?.params).toContain(m(1).id);
  expect(body.anomalyHistory).toMatchObject({ strongHours: 3, baselineOnlyHours: 5, penalty: 3 / 168 });
  expect(body.maintenance).toEqual({ openCorrective: 2, pastSla: 1 });
  expect(body.asOf).toBe(FX_NOW.toISOString());
}

/** R-g: a failed fact read gives `null` for that fact only, one `warn` with no asset id, SQL or message, and no throw. */
export async function aFailedFactReadIsQuiet(): Promise<void> {
  const cases = [
    { throws: [HOURS], want: { anomalyHistory: null, maintenance: { openCorrective: 2, pastSla: 1 } }, warns: 1 },
    { throws: [TICKETS], want: { maintenance: null }, warns: 1 },
    { throws: [HOURS, TICKETS], want: { anomalyHistory: null, maintenance: null }, warns: 2 },
  ];
  for (const k of cases) {
    const h = harness({
      answers: [
        { match: HOURS, rows: [hoursRow(m(1), { strong: 1 })], throws: k.throws.includes(HOURS) },
        { match: TICKETS, rows: [TICKET_ROW], throws: k.throws.includes(TICKETS) },
      ],
    });
    const { value, warns } = await warnsOf(() => h.svc.forAsset(m(1).id, FX_NOW));
    expect(value, JSON.stringify(k.throws.map((t) => t.source))).toMatchObject(k.want);
    if (!k.throws.includes(HOURS)) expect(value.anomalyHistory).not.toBeNull();
    expect(h.executed.map((e) => e.match), "the second read still runs").toEqual([HOURS.source, TICKETS.source]);
    expect(warns).toHaveLength(k.warns);
    for (const args of warns) {
      const line = JSON.stringify(args);
      expect(line).toContain("TypeError");
      expect(line).not.toContain(m(1).id);
      expect(line).not.toContain(SECRET);
      expect(line).not.toMatch(/SELECT|FROM /);
    }
  }
}

/** `badActors`: the scope is scored once with the caller's ids, the location and the window, by reference. */
export async function badActorsScoresTheScopeOnce(): Promise<void> {
  const callerIds = [m(1).id, m(2).id, c(1).id];
  const location: HealthLocationFilter = { id: "f0000000-0000-4000-8000-0000000000a1", readableLocationIds: null, readableOrganizationIds: null };
  const h = harness({
    answers: [{ match: LABELS, rows: [labelRow(m(2))] }, { match: HOURS, rows: [hoursRow(m(2), { strong: 2 })] }],
    scores: [scopeScore(m(2), 0.6), scopeScore(c(1), null)],
  });
  const body = healthBadActorsResponseSchema.parse(await h.svc.badActors(callerIds, location, DEFAULT_HEALTH_WINDOW_MINUTES, FX_NOW));
  expect(h.scopeCalls).toHaveLength(1);
  expect(h.scopeCalls[0]?.assetIds).toBe(callerIds);
  expect(h.scopeCalls[0]?.location).toBe(location);
  expect(h.scopeCalls[0]?.windowMinutes).toBe(DEFAULT_HEALTH_WINDOW_MINUTES);
  expect(h.scopeCalls[0]?.now).toBe(FX_NOW);
  expect(body.scoredAssetCount).toBe(1);
  expect(body.lowestScores.map((r) => r.assetId)).toEqual([m(2).id]);
  expect(body.anomaly?.items.map((i) => i.assetId)).toEqual([m(2).id]);
  expect(body.anomaly?.items[0]).toMatchObject({ ruleScore: 0.6 });
  expect(body.anomaly?.losingAssetCount).toBe(1);
}

/** The anomaly read and its routing get exactly the in-scope ids, never the caller's set; labels only the lowest. */
export async function theAnomalyReadGetsExactlyTheInScopeIds(): Promise<void> {
  const inScope = [m(1).id, m(3).id];
  const h = harness({
    answers: [{ match: LABELS, rows: [labelRow(m(1))] }, { match: HOURS, rows: [] }],
    scores: [scopeScore(m(1), 0.5), scopeScore(m(3), null)],
    organizations: 2,
  });
  const body = await h.svc.badActors([m(1).id, m(2).id, m(3).id, c(1).id], undefined, DEFAULT_HEALTH_WINDOW_MINUTES, FX_NOW);
  expect(h.executed.map((e) => e.match)).toEqual([LABELS.source, HOURS.source]);
  expect(h.executed.map((e) => e.transaction)).toEqual([1, 2]);
  expect(h.routedBy).toEqual([inScope, inScope]);
  expect(h.executed[0]?.params).toEqual([`{${m(1).id}}`]);
  expect(h.executed[1]?.params).toContain(`{${inScope.join(",")}}`);
  expect(body.anomaly).toEqual({ windowDays: 7, unusualAssetCount: 0, losingAssetCount: 0, caveat: null, items: [] });
}

/** An empty scope answers the empty card and reads nothing; no lowest score skips the label read. */
export async function anEmptyScopeReadsNothing(): Promise<void> {
  for (const callerIds of [[], null, [m(1).id]]) {
    const h = harness({ answers: [] });
    const body = await h.svc.badActors(callerIds, undefined, DEFAULT_HEALTH_WINDOW_MINUTES, FX_NOW);
    expect(body).toEqual({ asOf: FX_NOW.toISOString(), scoredAssetCount: 0, lowestScores: [], anomaly: null });
    expect(h.executed).toEqual([]);
    expect(h.routedBy).toEqual([]);
    expect(h.transactions()).toBe(0);
  }
  const unscored = harness({ answers: [{ match: HOURS, rows: [] }], scores: [scopeScore(c(1), null)] });
  const body = await unscored.svc.badActors(null, undefined, DEFAULT_HEALTH_WINDOW_MINUTES, FX_NOW);
  expect(unscored.executed.map((e) => e.match)).toEqual([HOURS.source]);
  expect(body).toMatchObject({ scoredAssetCount: 0, lowestScores: [] });
  expect(body.anomaly).not.toBeNull();
}

/** A failed anomaly read gives `anomaly: null` with the lowest scores and the scored count still filled. */
export async function aFailedAnomalyReadKeepsTheRuleScores(): Promise<void> {
  const h = harness({
    answers: [{ match: LABELS, rows: [labelRow(m(1)), labelRow(m(2))] }, { match: HOURS, throws: true }],
    scores: [scopeScore(m(1), 0.5), scopeScore(m(2), 0.25)],
  });
  const { value, warns } = await warnsOf(() => h.svc.badActors(null, undefined, DEFAULT_HEALTH_WINDOW_MINUTES, FX_NOW));
  expect(value.anomaly).toBeNull();
  expect(value.scoredAssetCount).toBe(2);
  expect(value.lowestScores.map((r) => r.assetId)).toEqual([m(2).id, m(1).id]);
  expect(warns).toHaveLength(1);
  expect(JSON.stringify(warns)).not.toContain(SECRET);
}
