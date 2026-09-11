import { describe, it } from "vitest";

import {
  assertHeartbeatQueueIsStillRegistered,
  assertParseOfAbsentKeyIsNull,
  assertParseOfGarbageIsNull,
  assertParseOfJsonMissingRaisedIsNull,
  assertParseOfValidJsonRoundTrips,
  assertRecordLogsTheCountsLine,
  assertRecordObservesTheDurationInSeconds,
  assertRecordWritesExactlyTheSummaryJson,
  assertRulesSweepQueueIsFleet,
  assertRulesSweepQueueIsNamedRulesSweep,
  assertRulesSweepQueueIsRegistered,
  assertRulesSweepQueueKeepsTheRetryDefaults,
  assertSweepKeyStaysInsideThePrefixNamespace,
} from "./rules-sweep.spec";

/**
 * F3.11 (ADR 0064 decisions 2, 8) — Vitest entry point for the
 * `rules-sweep` declaration, the summary key, the parse and the sinks.
 * Assertions live in the sibling `.spec` (§4.6/ADR 0014); this file only
 * runs them.
 */
describe("F3.11 — rules-sweep queue", () => {
  describe("declaration", () => {
    it("declares the queue as fleet", () => {
      assertRulesSweepQueueIsFleet();
    });

    it('is named "rules-sweep"', () => {
      assertRulesSweepQueueIsNamedRulesSweep();
    });

    it("keeps decision 7's retry defaults", () => {
      assertRulesSweepQueueKeepsTheRetryDefaults();
    });

    it("is listed in ALL_QUEUES", () => {
      assertRulesSweepQueueIsRegistered();
    });

    it("leaves heartbeatQueue listed in ALL_QUEUES (the append did not replace the list)", () => {
      assertHeartbeatQueueIsStillRegistered();
    });

    it("keys the summary under the queue prefix", () => {
      assertSweepKeyStaysInsideThePrefixNamespace();
    });
  });

  describe("parseRuleSweepSummary", () => {
    it("reads an absent key as null", () => {
      assertParseOfAbsentKeyIsNull();
    });

    it("reads a value JSON.parse rejects as null (never throws)", () => {
      assertParseOfGarbageIsNull();
    });

    it("reads valid JSON that is not the schema (raised missing) as null", () => {
      assertParseOfJsonMissingRaisedIsNull();
    });

    it("reads back a summary the worker wrote (positive control)", () => {
      assertParseOfValidJsonRoundTrips();
    });
  });

  describe("recordRuleSweep", () => {
    it("writes exactly JSON.stringify(summary) through writeSummary", async () => {
      await assertRecordWritesExactlyTheSummaryJson();
    });

    it("observes the duration in seconds and the raised count", async () => {
      await assertRecordObservesTheDurationInSeconds();
    });

    it("logs the counts line and nothing else", async () => {
      await assertRecordLogsTheCountsLine();
    });
  });
});
