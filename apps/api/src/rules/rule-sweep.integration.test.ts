import type pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";
import type { BmsDb } from "@bms/db";

import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import {
  assertEvaluatedCountsTheTimeWindowRule,
  assertFreshSampleRaisesInTheSameSweep,
  assertLastEvaluatedAtIsTheSummaryFinishedAt,
  assertMatchingRuleOpensOneAlarm,
  assertMatchingRuleTracesOnceAsRuleSweep,
  assertNonMatchingRuleLeavesNoTraceAndNoAlarm,
  assertNotifyRuleDeliversOnceOnTheFirstSweep,
  assertSecondSweepChangesNoCount,
  assertSecondSweepDeliversForTheRuleThatTransitioned,
  assertSecondSweepWritesNoRowForAnOpenAlarm,
  assertStaleSampleDoesNotRaise,
  assertSweepTraceCarriesNoEvaluatedBy,
  assertTimeWindowRuleRaisesNothing,
  assertUpdatedAtIsUntouched,
  runBoundsSweep,
  runMatchingSweep,
  runNotifySweep,
  type BoundsSweepOutcome,
  type MatchingSweepOutcome,
  type NotifySweepOutcome,
} from "./rule-sweep.integration.spec";

/**
 * `F3.11` — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the database lifecycle.
 *
 * Integration, not unit: `rule-sweep.spec.ts` proves the body's policy
 * against a recording raiser, and this is the proof the same policy holds
 * when `RuleSweepService` is composed against `AlarmRaiser`, the real
 * `NotificationsService` and `stampRulesEvaluated` on a real database —
 * the dedupe index, the trace row, the ledger and the per-organization
 * `UPDATE` are all the database's behaviour, not the fake's.
 *
 * Each scenario runs once in its `describe`'s `beforeAll` (one sweep walks
 * every enabled, published rule in the database, so a scenario is seconds,
 * not milliseconds), and each claim is its own `it()` so a later assertion
 * is never hidden behind an earlier throw.
 */
const connectionString = requireIntegrationDb({
  item: "F3.11",
  label: "rule sweep integration tests",
  because:
    "they are the only proof that the scheduled sweep applies the streaming engine's write " +
    "policy on real rows (ADR 0064 decision 5): one trace on a raise tagged rule_sweep and " +
    "none for a rule that did not raise, one delivery on a transition and none on the sweep " +
    "after it, last_evaluated_at stamped once per organization with updated_at untouched, " +
    "and the freshness bound holding in the real composition. Fix the pipeline, do not " +
    "relax this guard.",
});

const SCENARIO_TIMEOUT_MS = 60_000;

describe.skipIf(!connectionString)("F3.11 — RuleSweepService against a real database", () => {
  let pool: pg.Pool;
  let db: BmsDb;

  beforeAll(async () => {
    pool = await openIntegrationPool(connectionString as string, "F3.11");
    db = createDb(pool);
  });

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
  });

  describe("a matching and a non-matching rule, swept twice (decision 5)", () => {
    let outcome: MatchingSweepOutcome;
    beforeAll(async () => {
      outcome = await runMatchingSweep(db);
    }, SCENARIO_TIMEOUT_MS);

    it("opens exactly one alarm for the matching rule", () => {
      assertMatchingRuleOpensOneAlarm(outcome);
    });

    it("writes one rule_executions row for it, tagged raisedBy: rule_sweep", () => {
      assertMatchingRuleTracesOnceAsRuleSweep(outcome);
    });

    it("writes no evaluatedBy key into that trace", () => {
      assertSweepTraceCarriesNoEvaluatedBy(outcome);
    });

    it("writes no trace and no alarm for the non-matching rule in the same sweep", () => {
      assertNonMatchingRuleLeavesNoTraceAndNoAlarm(outcome);
    });

    it("leaves every count unchanged on the second sweep", () => {
      assertSecondSweepChangesNoCount(outcome);
    });

    it("stamps both rules' last_evaluated_at with the returned finishedAt, to the millisecond", () => {
      assertLastEvaluatedAtIsTheSummaryFinishedAt(outcome);
    });

    it("leaves updated_at untouched (Amendment 1 A4)", () => {
      assertUpdatedAtIsUntouched(outcome);
    });
  });

  describe("a notify rule with a webhook channel, swept twice (decision 5)", () => {
    let outcome: NotifySweepOutcome;
    beforeAll(async () => {
      outcome = await runNotifySweep(db);
    }, SCENARIO_TIMEOUT_MS);

    it("writes exactly one sent delivery on the first sweep", () => {
      assertNotifyRuleDeliversOnceOnTheFirstSweep(outcome);
    });

    it("delivers on the second sweep for the rule that transitioned then (positive control)", () => {
      assertSecondSweepDeliversForTheRuleThatTransitioned(outcome);
    });

    it("writes no second row for the rule whose alarm is already open", () => {
      assertSecondSweepWritesNoRowForAnOpenAlarm(outcome);
    });
  });

  describe("the freshness bound and a time_window rule, in one sweep", () => {
    let outcome: BoundsSweepOutcome;
    beforeAll(async () => {
      outcome = await runBoundsSweep(db);
    }, SCENARIO_TIMEOUT_MS);

    it("does not raise for a matching sample 16 minutes old", () => {
      assertStaleSampleDoesNotRaise(outcome);
    });

    it("raises for the fresh sample beside it (positive control)", () => {
      assertFreshSampleRaisesInTheSameSweep(outcome);
    });

    it("counts the time_window rule in evaluated", () => {
      assertEvaluatedCountsTheTimeWindowRule(outcome);
    });

    it("raises nothing for the matched time_window rule", () => {
      assertTimeWindowRuleRaisesNothing(outcome);
    });
  });
});
