import { NotFoundException } from "@nestjs/common";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { expect } from "vitest";

import type { BmsDb } from "@bms/db";
import { alarmRootCauseSuggestionsResponseSchema, type AlarmDetailsResponse } from "@bms/shared";

import type { AlarmDetailsService } from "./alarm-details.service";
import { AlarmRootCauseService } from "./alarm-root-cause.service";

/**
 * `E2.3` / ADR 0136 (plan §6 T1.5) — the service's order and routing with a
 * stub gate and a recording tenant handle: the gate runs first with the
 * caller's ids, a device alarm opens no transaction, every evidence statement
 * runs inside the one `withTenant` transaction of the alarm's organization,
 * R4 only with a rule, and the rows reach the ranking split by source. The SQL
 * itself is the integration suite's (`alarm-root-cause.integration.spec.ts`).
 * Vitest entry point: the sibling `.test.ts`.
 */

const dialect = new PgDialect();
const ORG = "3f0e2d1c-0b9a-4876-8543-210fedcba901";
const ALARM = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const ASSET = "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e";
const RULE = "3c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f";
const RTU = "4d5e6f7a-8b9c-4d0e-9f2a-3b4c5d6e7f80";
const LOCATION = "5e6f7a8b-9c0d-4e1f-8a3b-4c5d6e7f8091";
const PARENT = "6f7a8b9c-0d1e-4f2a-9b4c-5d6e7f8091a2";
const T = Date.UTC(2026, 10, 17, 10, 55, 0);
const NOW = new Date(Date.UTC(2026, 10, 17, 11, 0, 0));
const MIN = 60_000;

const uuid = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

function detailsOf(overrides: Partial<AlarmDetailsResponse> = {}): AlarmDetailsResponse {
  return {
    id: ALARM,
    assetId: ASSET,
    organizationId: ORG,
    source: "rule",
    ruleId: RULE,
    raisedAt: new Date(T).toISOString(),
    classPhilosophy: {
      templateId: uuid(90),
      templateVersion: 2,
      templateName: "Synthetic pump",
      alarmCode: "SYN_HIGH",
      cause: "A synthetic class cause.",
      impact: null,
      action: null,
      skillCode: null,
      skillLabel: null,
    },
    ...overrides,
  } as AlarmDetailsResponse;
}

type Recorded = { text: string; params: unknown[]; inTransaction: boolean };

/** A tenant handle that answers each statement by its text and records the order. */
function recordingTenant(rowsFor: (text: string) => unknown[]) {
  const statements: Recorded[] = [];
  let transactions = 0;
  let open = false;
  const execute = async (query: SQL) => {
    const { sql: text, params } = dialect.sqlToQuery(query);
    statements.push({ text, params, inTransaction: open });
    return { rows: rowsFor(text) };
  };
  const db = {
    execute,
    transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      transactions += 1;
      open = true;
      try {
        return await fn({ execute });
      } finally {
        open = false;
      }
    },
  } as unknown as BmsDb;
  return { db, statements, transactions: () => transactions };
}

const SUBJECT_ROW = { raised_ms: T, rtu_id: RTU, rtu_name: "RTU SYN-1", location_id: LOCATION };

function fullRows(text: string): unknown[] {
  if (text.includes("set_config")) return [];
  if (text.includes("r.display_name AS rtu_name")) return [SUBJECT_ROW];
  if (text.includes("bms.maintenance_windows w")) {
    return [{ id: uuid(1), starts_ms: T - 120 * MIN, end_ms: T + 60 * MIN, asset_id: null, location_id: PARENT }];
  }
  if (text.includes("WITH RECURSIVE")) {
    return [
      { id: LOCATION, organization_id: ORG, depth: 0 },
      { id: PARENT, organization_id: ORG, depth: 1 },
    ];
  }
  if (text.includes("PARTITION BY al.source")) {
    const base = {
      cleared_ms: null,
      asset_code: null,
      asset_rtu_id: null,
      asset_location_id: null,
      asset_rtu_name: null,
      asset_location_name: null,
    };
    return [
      { ...base, id: uuid(2), source: "rtu_comms", asset_id: null, rule_id: null, rtu_id: RTU, message: "Comms lost", raised_ms: T - 40 * MIN },
      {
        ...base,
        id: uuid(3),
        source: "rule",
        asset_id: uuid(50),
        rule_id: uuid(51),
        rtu_id: null,
        message: "Neighbour high",
        raised_ms: T - 10 * MIN,
        asset_code: "SYN-2",
        asset_rtu_id: RTU,
        asset_location_id: LOCATION,
      },
    ];
  }
  if (text.includes("bms.alarm_enrichments e")) return [{ root_cause: "Dry bearing", alarm_id: uuid(4), raised_ms: T - 3 * 24 * 60 * MIN }];
  if (text.includes("ml.anomaly_scores")) {
    return [{ bucket_ms: Date.UTC(2026, 10, 17, 8), detector: "baseline_mad", score: 0.999, contributing_points: ["kw"] }];
  }
  throw new Error(`unexpected statement: ${text.slice(0, 80)}`);
}

function serviceWith(details: AlarmDetailsService["get"], rows: (text: string) => unknown[] = fullRows) {
  const calls: unknown[][] = [];
  const order: string[] = [];
  const gate = {
    get: async (...args: Parameters<AlarmDetailsService["get"]>) => {
      calls.push(args);
      order.push("details.get");
      return details(...args);
    },
  } as unknown as AlarmDetailsService;
  const tenant = recordingTenant((text) => {
    order.push("evidence");
    return rows(text);
  });
  return { svc: new AlarmRootCauseService(gate, tenant.db), calls, order, tenant };
}

/** The gate runs first, with the caller's ids by identity; its 404 is the answer and no evidence is read. */
export async function theGateRunsFirstWithTheCallersIds(): Promise<void> {
  const notFound = new NotFoundException("Alarm not found or outside your access scope");
  const ids = [uuid(70), uuid(71)];
  const refused = serviceWith(async () => {
    throw notFound;
  });
  await expect(refused.svc.get(ALARM, ids, NOW)).rejects.toBe(notFound);
  expect(refused.calls).toEqual([[ALARM, ids]]);
  expect(refused.calls[0]![1]).toBe(ids);
  expect(refused.tenant.transactions()).toBe(0);
  expect(refused.tenant.statements).toEqual([]);

  for (const scope of [ids, [], null]) {
    const ok = serviceWith(async () => detailsOf());
    await ok.svc.get(ALARM, scope, NOW);
    expect(ok.calls[0]![1]).toBe(scope);
    expect(ok.order[0]).toBe("details.get");
    expect(ok.order.slice(1).every((step) => step === "evidence")).toBe(true);
  }
}

/** Q4: a device alarm answers the empty lists and opens no transaction. */
export async function aDeviceAlarmReadsNoEvidence(): Promise<void> {
  const { svc, tenant } = serviceWith(async () => detailsOf({ assetId: null, source: "rtu_comms", ruleId: null }));
  await expect(svc.get(ALARM, null, NOW)).resolves.toEqual({ computedAt: NOW.toISOString(), candidates: [], context: [] });
  expect(tenant.transactions()).toBe(0);
  expect(tenant.statements).toEqual([]);
}

/** Q2: one transaction; the GUC is the alarm's organization, set first; every statement runs inside it. */
export async function everyEvidenceReadRunsInOneTenantTransaction(): Promise<void> {
  const { svc, tenant } = serviceWith(async () => detailsOf());
  await svc.get(ALARM, null, NOW);
  expect(tenant.transactions()).toBe(1);
  expect(tenant.statements.every((s) => s.inTransaction)).toBe(true);
  const [first, ...rest] = tenant.statements;
  expect(first!.text).toContain("set_config('app.current_organization'");
  expect(first!.params).toEqual([ORG]);
  const kinds = rest.map((s) =>
    s.text.includes("r.display_name AS rtu_name")
      ? "subject"
      : s.text.includes("bms.maintenance_windows w")
        ? "windows"
        : s.text.includes("WITH RECURSIVE")
          ? "ancestors"
          : s.text.includes("PARTITION BY al.source")
            ? "related"
            : s.text.includes("bms.alarm_enrichments e")
              ? "past"
              : s.text.includes("ml.anomaly_scores")
                ? "anomalies"
                : "other",
  );
  expect(kinds).toEqual(["subject", "windows", "ancestors", "related", "past", "anomalies"]);
}

/** No rule (deleted), no R4 statement; no location target, no ancestor walk. */
export async function r4AndTheAncestorWalkRunOnlyWhenNeeded(): Promise<void> {
  const { svc, tenant } = serviceWith(
    async () => detailsOf({ ruleId: null }),
    (text) => (text.includes("bms.maintenance_windows w") ? [] : fullRows(text)),
  );
  await svc.get(ALARM, null, NOW);
  const texts = tenant.statements.map((s) => s.text);
  expect(texts.some((t) => t.includes("bms.alarm_enrichments e"))).toBe(false);
  expect(texts.some((t) => t.includes("WITH RECURSIVE"))).toBe(false);
}

/** An alarm whose asset is not in its organization reads as no asset: the empty answer. */
export async function aMismatchedAssetGivesTheEmptyAnswer(): Promise<void> {
  const { svc, tenant } = serviceWith(async () => detailsOf(), (text) =>
    text.includes("r.display_name AS rtu_name") ? [] : fullRows(text),
  );
  await expect(svc.get(ALARM, null, NOW)).resolves.toEqual({ computedAt: NOW.toISOString(), candidates: [], context: [] });
  expect(tenant.statements).toHaveLength(2);
}

/** The rows reach the ranking split by source; the anomaly rows only reach the context; the answer parses. */
export async function theRowsReachTheRankingSplitBySource(): Promise<void> {
  const { svc } = serviceWith(async () => detailsOf());
  const answer = await svc.get(ALARM, null, NOW);
  expect(alarmRootCauseSuggestionsResponseSchema.parse(answer)).toEqual(answer);
  expect(answer.computedAt).toBe(NOW.toISOString());
  expect(answer.candidates.map((c) => [c.rule, c.strength])).toEqual([
    ["maintenance", "strong"],
    ["rtu_comms", "strong"],
    ["linked_alarm", "moderate"],
  ]);
  expect(answer.candidates[1]!.title).toBe("Communication or power loss at RTU RTU SYN-1");
  expect(answer.candidates[1]!.evidence.map((e) => e.alarmId)).toEqual([uuid(2)]);
  expect(answer.candidates[2]!.evidence.map((e) => e.alarmId)).toEqual([uuid(3)]);
  expect(answer.context).toHaveLength(1);

  const { svc: quiet } = serviceWith(async () => detailsOf(), (text) => (text.includes("ml.anomaly_scores") ? [] : fullRows(text)));
  const withoutAnomalies = await quiet.get(ALARM, null, NOW);
  expect(withoutAnomalies.candidates).toEqual(answer.candidates);
  expect(withoutAnomalies.context).toEqual([]);
}
