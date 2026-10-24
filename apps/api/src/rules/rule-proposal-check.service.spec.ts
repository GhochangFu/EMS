import "reflect-metadata";

import { expect } from "vitest";

import { assets, automationRules, pointValues, pointValues1m } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { RuleDraftBody } from "@bms/shared";

import { ruleRow } from "./rule-mapping.spec";
import { RuleProposalCheckService } from "./rule-proposal-check.service";
import {
  ARCHIVED_CANNOT_BE_EDITED,
  ONLY_PUBLISHED_CAN_TOGGLE,
  type RulesService,
} from "./rules.service";
import type { RuleDraftValues, RuleRow } from "./rules.types";

/**
 * `F4.278` (ADR 0099 Amendment 8, Q9) — the copilot's write-free rule check.
 * The database fake answers by table: the rule row (`automation_rules`), the
 * latest sample (`point_values`), the 1-minute buckets (`point_values_1m`) and
 * an asset's code (`assets`); it counts each read, and its `insert` throws, so
 * any write fails the case. The validator is a recorder.
 */

const ORG = "11111111-1111-4111-8111-111111111111";
const ASSET = "33333333-3333-4333-8333-333333333333";
const RULE = "44444444-4444-4444-8444-444444444444";
const NOW = new Date("2026-10-23T10:15:00.000Z");
const SAMPLE_TIME = new Date("2026-10-23T10:14:00.000Z");
const MINUTE = 60_000;

/** Two excursions above 3, apart by more than the 120 s hold: the backtest counts 2. */
const BUCKETS = [5, 1, 1, 1, 5, 1].map((value, i) => ({
  bucket: new Date(NOW.getTime() - 60 * MINUTE + i * MINUTE),
  sumValue: value,
  sampleCount: 1,
  minValue: value,
  maxValue: value,
}));

type Reads = { rule: number; sample: number; buckets: number; asset: number };

function fakeDb(row: RuleRow | undefined, hasSample = true): { db: BmsDb; reads: Reads } {
  const reads: Reads = { rule: 0, sample: 0, buckets: 0, asset: 0 };
  const answer = (table: unknown): unknown[] => {
    if (table === automationRules) {
      reads.rule += 1;
      return row ? [row] : [];
    }
    if (table === pointValues) {
      reads.sample += 1;
      return hasSample ? [{ time: SAMPLE_TIME, value: 4.2, unit: "°C" }] : [];
    }
    if (table === pointValues1m) {
      reads.buckets += 1;
      return BUCKETS;
    }
    if (table === assets) {
      reads.asset += 1;
      return [{ code: "CH-01" }];
    }
    throw new Error("the check read an unexpected table");
  };
  const select = () => {
    let table: unknown;
    const chain = {
      from: (t: unknown) => {
        table = t;
        return chain;
      },
      leftJoin: () => chain,
      innerJoin: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: () => chain,
      then: (resolve: (rows: unknown[]) => void, reject: (err: unknown) => void) => {
        try {
          resolve(answer(table));
        } catch (err) {
          reject(err);
        }
      },
    };
    return chain;
  };
  const db: Record<string, unknown> = {
    select,
    execute: async () => undefined,
    insert: () => {
      throw new Error("the rule check must write nothing");
    },
    update: () => {
      throw new Error("the rule check must write nothing");
    },
  };
  db.transaction = async (fn: (tx: unknown) => Promise<unknown>) => fn(db);
  return { db: db as unknown as BmsDb, reads };
}

type ValidateCall = { dto: RuleDraftBody; currentId: string | undefined; organizationId: string | null };

function validator(): { rules: Pick<RulesService, "validateRuleDraft">; calls: ValidateCall[] } {
  const calls: ValidateCall[] = [];
  const rules = {
    validateRuleDraft: async (dto: RuleDraftBody, currentId: string | undefined, organizationId: string | null) => {
      calls.push({ dto, currentId, organizationId });
      const values: RuleDraftValues = {
        code: dto.code,
        name: dto.name,
        description: dto.description ?? null,
        category: dto.category,
        ruleType: dto.ruleType,
        assetId: dto.assetId ?? null,
        pointKey: dto.pointKey ?? null,
        operator: dto.operator ?? null,
        thresholdValue: dto.thresholdValue ?? null,
        severity: dto.severity ?? null,
        clearHoldSeconds: dto.clearHoldSeconds ?? null,
        condition: dto.condition,
        action: dto.action,
      };
      return values;
    },
  };
  return { rules, calls };
}

const THRESHOLD_BODY = {
  name: "Chiller high",
  ruleType: "threshold",
  assetId: ASSET,
  pointKey: "supply_temp_c",
  operator: "gt",
  thresholdValue: 3,
  condition: { window: "latest" },
  action: { type: "notify", target: "Operations" },
};

const TIME_WINDOW_BODY = {
  name: "Weekday review",
  ruleType: "time_window",
  condition: { days: ["mon", "tue", "wed"], startTime: "08:00", endTime: "17:00" },
  action: { type: "review", target: "Operations" },
};

const THRESHOLD_ROW = ruleRow({ id: RULE, organizationId: ORG, assetId: ASSET, assetCode: "CH-01", pointKey: "supply_temp_c", thresholdValue: 3 });

function service(row: RuleRow | null = THRESHOLD_ROW) {
  const { db, reads } = fakeDb(row ?? undefined);
  const { rules, calls } = validator();
  return { check: new RuleProposalCheckService(db, rules as RulesService), reads, calls };
}

async function refusal(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error("the check was expected to refuse");
}

/** A create calls the validator with `(dto, undefined, organizationId)`: the route's own call. */
export async function aCreateCallsTheValidatorAsTheRouteDoes(): Promise<void> {
  const s = service();
  await s.check.check({ entryId: "rule.create", params: {}, body: THRESHOLD_BODY, organizationId: ORG, now: NOW });
  expect(s.calls.map((call) => [call.dto.name, call.currentId, call.organizationId])).toEqual([["Chiller high", undefined, ORG]]);
}

/** A create's note says it would match now, with the latest value and its time. */
export async function aCreateNoteSaysItWouldMatchNow(): Promise<void> {
  const s = service();
  const { note } = await s.check.check({ entryId: "rule.create", params: {}, body: THRESHOLD_BODY, organizationId: ORG, now: NOW });
  expect(note).toContain("Would match now: yes — latest value 4.2 °C at 2026-10-23 10:14 UTC.");
}

/** A create's note names the condition, with the asset's code and the default clear hold. */
export async function aCreateNoteNamesTheCondition(): Promise<void> {
  const s = service();
  const { note } = await s.check.check({ entryId: "rule.create", params: {}, body: THRESHOLD_BODY, organizationId: ORG, now: NOW });
  expect(note).toContain("Condition: CH-01 supply_temp_c above 3 (latest value; clear hold 120 s).");
}

/** A threshold create's note carries the 7-day backtest, labelled an estimate. */
export async function aCreateNoteCarriesTheBacktestEstimate(): Promise<void> {
  const s = service();
  const { note } = await s.check.check({ entryId: "rule.create", params: {}, body: THRESHOLD_BODY, organizationId: ORG, now: NOW });
  expect(note).toContain("Would have fired about 2 times in the last 7 days");
  expect(note).toContain("estimate");
}

/** The card names what the backtest compared (ruling Q1): a `gt` rule reads each minute's highest value. */
export async function aGtBacktestNamesTheMinuteHigh(): Promise<void> {
  const s = service();
  const { note } = await s.check.check({ entryId: "rule.create", params: {}, body: THRESHOLD_BODY, organizationId: ORG, now: NOW });
  expect(note).toContain("(an estimate from each minute's highest value; the live engine sees every sample).");
}

/** An `lt` rule's backtest reads each minute's lowest value. */
export async function anLtBacktestNamesTheMinuteLow(): Promise<void> {
  const s = service();
  const body = { ...THRESHOLD_BODY, operator: "lt" };
  const { note } = await s.check.check({ entryId: "rule.create", params: {}, body, organizationId: ORG, now: NOW });
  expect(note).toContain("(an estimate from each minute's lowest value; the live engine sees every sample).");
}

/** An `eq` rule's backtest still reads each minute's average. */
export async function anEqBacktestNamesTheMinuteAverage(): Promise<void> {
  const s = service();
  const body = { ...THRESHOLD_BODY, operator: "eq" };
  const { note } = await s.check.check({ entryId: "rule.create", params: {}, body, organizationId: ORG, now: NOW });
  expect(note).toContain("(an estimate from each minute's average; the live engine sees every sample).");
}

/** A time-window draft shows its window and "would match now", and no backtest. */
export async function aTimeWindowDraftHasNoBacktest(): Promise<void> {
  const s = service();
  const { note } = await s.check.check({ entryId: "rule.create", params: {}, body: TIME_WINDOW_BODY, organizationId: ORG, now: NOW });
  expect(note).toContain("Condition: mon, tue, wed 08:00–17:00.");
  expect(note).toContain("Would match now:");
  expect(note).not.toContain("Would have fired");
  expect(s.reads.buckets).toBe(0);
}

/** An update of an archived rule is refused with the route's own sentence. */
export async function anUpdateOfAnArchivedRuleIsRefused(): Promise<void> {
  const s = service(ruleRow({ ...THRESHOLD_ROW, lifecycleStatus: "archived" }));
  const message = await refusal(() =>
    s.check.check({ entryId: "rule.update", params: { id: RULE }, body: { thresholdValue: 4 }, organizationId: ORG, now: NOW }),
  );
  expect(message).toBe(ARCHIVED_CANNOT_BE_EDITED);
  expect(s.calls).toEqual([]);
}

/** An update validates the merged draft against the rule's own id and organization. */
export async function anUpdateValidatesTheMergedDraft(): Promise<void> {
  const s = service();
  await s.check.check({ entryId: "rule.update", params: { id: RULE }, body: { thresholdValue: 4 }, organizationId: ORG, now: NOW });
  expect(s.calls.map((call) => [call.dto.thresholdValue, call.dto.name, call.currentId, call.organizationId])).toEqual([
    [4, THRESHOLD_ROW.name, RULE, ORG],
  ]);
}

/** Enabling a draft is refused with the route's own sentence. */
export async function anEnableOfADraftIsRefused(): Promise<void> {
  const s = service(ruleRow({ ...THRESHOLD_ROW, lifecycleStatus: "draft" }));
  const message = await refusal(() =>
    s.check.check({ entryId: "rule.enable", params: { id: RULE }, body: { enabled: true }, organizationId: ORG, now: NOW }),
  );
  expect(message).toBe(ONLY_PUBLISHED_CAN_TOGGLE);
}

/** Enabling a half-built (philosophy) row is refused with `assertArmable`'s sentence. */
export async function anEnableOfAHalfBuiltRuleIsRefused(): Promise<void> {
  const s = service(ruleRow({ ...THRESHOLD_ROW, operator: null, thresholdValue: null }));
  const message = await refusal(() =>
    s.check.check({ entryId: "rule.enable", params: { id: RULE }, body: { enabled: true }, organizationId: ORG, now: NOW }),
  );
  expect(message).toContain("cannot be enabled");
}

/** Publish runs the validator on the row's own body, then `assertArmable` (Q9: stricter than today's route, as ruled). */
export async function aPublishValidatesTheRowAndAssertsArmable(): Promise<void> {
  const ok = service();
  await ok.check.check({ entryId: "rule.publish", params: { id: RULE }, body: {}, organizationId: ORG, now: NOW });
  expect(ok.calls.map((call) => [call.dto.name, call.currentId, call.organizationId])).toEqual([[THRESHOLD_ROW.name, RULE, ORG]]);
  const halfBuilt = service(ruleRow({ ...THRESHOLD_ROW, lifecycleStatus: "draft", operator: null, thresholdValue: null }));
  const message = await refusal(() =>
    halfBuilt.check.check({ entryId: "rule.publish", params: { id: RULE }, body: {}, organizationId: ORG, now: NOW }),
  );
  expect(message).toContain("cannot be enabled");
}

/** Duplicate, archive and disable arm nothing: no sample and no bucket is read, and the note carries the condition. */
export async function theNonArmingEntriesReadNoSampleAndShowTheCondition(): Promise<void> {
  for (const entryId of ["rule.duplicate", "rule.archive", "rule.disable"]) {
    const s = service();
    const { note } = await s.check.check({ entryId, params: { id: RULE }, body: {}, organizationId: ORG, now: NOW });
    expect([s.reads.sample, s.reads.buckets], entryId).toEqual([0, 0]);
    expect(note, entryId).toContain("Condition: CH-01 supply_temp_c above 3 (latest value; clear hold 300 s).");
  }
}

/** A rule the organization does not hold is not found. */
export async function anUnknownRuleIsNotFound(): Promise<void> {
  const s = service(null);
  const message = await refusal(() =>
    s.check.check({ entryId: "rule.publish", params: { id: RULE }, body: {}, organizationId: ORG, now: NOW }),
  );
  expect(message).toBe("Rule not found");
}

/** With no sample yet, the note says so rather than "no". */
export async function aRuleWithNoSampleSaysSo(): Promise<void> {
  const { db } = fakeDb(THRESHOLD_ROW, false);
  const check = new RuleProposalCheckService(db, validator().rules as RulesService);
  const { note } = await check.check({ entryId: "rule.enable", params: { id: RULE }, body: { enabled: true }, organizationId: ORG, now: NOW });
  expect(note).toContain("Would match now: no sample yet.");
}
