import type { RuleSweepSummary } from "@bms/shared";
import type { Logger } from "@nestjs/common";

import type { MetricsService } from "../observability/metrics.service";
import { heartbeatQueue } from "./heartbeat";
import { RETRY_DEFAULTS } from "./queue-registry";
import { ALL_QUEUES } from "./queues";
import {
  parseRuleSweepSummary,
  recordRuleSweep,
  ruleSweepKey,
  rulesSweepQueue,
} from "./rules-sweep";

/**
 * F3.11 (ADR 0064 decisions 2, 8) — the `rules-sweep` declaration, the
 * summary key, the fail-closed parse and the three sinks of a completed
 * sweep.
 *
 * Assertions live here; `rules-sweep.test.ts` is the Vitest wrapper
 * (§4.6/ADR 0014). One exported function per claim; the three sinks of
 * `recordRuleSweep` are three rows so a dropped sink cannot hide behind the
 * one that still fires.
 *
 * The metrics sink is a fake through `Pick<MetricsService,
 * "observeRuleSweep">` — these rows prove the ARGUMENTS the sweep hands the
 * method (seconds, not milliseconds); the real method's two series are
 * pinned in `queue-health.spec.ts` beside decision 11's.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const VALID: RuleSweepSummary = {
  finishedAt: "2026-09-11T12:00:00.000Z",
  evaluated: 12,
  raised: 2,
  durationMs: 412,
};

type RecordedSinks = {
  written: string[];
  observed: { durationSeconds: number; raised: number }[];
  logged: string[];
  sinks: Parameters<typeof recordRuleSweep>[1];
};

function recordingSinks(): RecordedSinks {
  const written: string[] = [];
  const observed: { durationSeconds: number; raised: number }[] = [];
  const logged: string[] = [];
  const metrics: Pick<MetricsService, "observeRuleSweep"> = {
    observeRuleSweep: (durationSeconds, raised) => {
      observed.push({ durationSeconds, raised });
    },
  };
  const logger = {
    log: (message: unknown) => {
      logged.push(String(message));
    },
  } as Pick<Logger, "log">;
  return {
    written,
    observed,
    logged,
    sinks: {
      writeSummary: async (json) => {
        written.push(json);
      },
      metrics,
      logger,
    },
  };
}

// ---------------------------------------------------------------------------
// declaration (decision 2)
// ---------------------------------------------------------------------------

export function assertRulesSweepQueueIsFleet(): void {
  assert(
    rulesSweepQueue.tenancy === "fleet",
    `expected tenancy "fleet", got "${rulesSweepQueue.tenancy}" — the sweep reads across organizations by design (ADR 0033 decision 2)`,
  );
}

export function assertRulesSweepQueueIsNamedRulesSweep(): void {
  assert(
    rulesSweepQueue.name === "rules-sweep",
    `expected name "rules-sweep", got "${rulesSweepQueue.name}"`,
  );
}

export function assertRulesSweepQueueKeepsTheRetryDefaults(): void {
  assert(
    JSON.stringify(rulesSweepQueue.retry) === JSON.stringify(RETRY_DEFAULTS),
    `expected retry ${JSON.stringify(RETRY_DEFAULTS)}, got ${JSON.stringify(rulesSweepQueue.retry)} — a silent override of decision 7's defaults`,
  );
}

export function assertRulesSweepQueueIsRegistered(): void {
  assert(
    (ALL_QUEUES as readonly unknown[]).includes(rulesSweepQueue),
    "ALL_QUEUES must list rulesSweepQueue — QueueModule builds its client from that list and nothing else",
  );
}

/** The positive control on the append: the list was extended, not replaced. */
export function assertHeartbeatQueueIsStillRegistered(): void {
  assert(
    (ALL_QUEUES as readonly unknown[]).includes(heartbeatQueue),
    "ALL_QUEUES must still list heartbeatQueue — the F3.11 append must not replace the list",
  );
}

export function assertSweepKeyStaysInsideThePrefixNamespace(): void {
  const key = ruleSweepKey("bms");
  assert(
    key === "bms:rules-sweep:last",
    `expected "bms:rules-sweep:last", got "${key}" — the key must sit under the queue prefix`,
  );
}

// ---------------------------------------------------------------------------
// parseRuleSweepSummary — fail closed to "no sweep recorded"
// ---------------------------------------------------------------------------

export function assertParseOfAbsentKeyIsNull(): void {
  const parsed = parseRuleSweepSummary(null);
  assert(parsed === null, `expected null for an absent key, got ${JSON.stringify(parsed)}`);
}

export function assertParseOfGarbageIsNull(): void {
  const parsed = parseRuleSweepSummary("{not json");
  assert(
    parsed === null,
    `expected null for a value JSON.parse rejects, got ${JSON.stringify(parsed)} — a corrupt key must not throw`,
  );
}

/** Valid JSON that is not the schema: `raised` missing. Reddens when the parse skips `safeParse`. */
export function assertParseOfJsonMissingRaisedIsNull(): void {
  const { raised: _dropped, ...withoutRaised } = VALID;
  const parsed = parseRuleSweepSummary(JSON.stringify(withoutRaised));
  assert(
    parsed === null,
    `expected null for JSON missing "raised", got ${JSON.stringify(parsed)} — the schema is not being applied`,
  );
}

/** The positive control: a value the worker wrote reads back as written. */
export function assertParseOfValidJsonRoundTrips(): void {
  const parsed = parseRuleSweepSummary(JSON.stringify(VALID));
  assert(
    JSON.stringify(parsed) === JSON.stringify(VALID),
    `expected ${JSON.stringify(VALID)}, got ${JSON.stringify(parsed)}`,
  );
}

// ---------------------------------------------------------------------------
// recordRuleSweep — the three sinks (decision 8)
// ---------------------------------------------------------------------------

export async function assertRecordWritesExactlyTheSummaryJson(): Promise<void> {
  const recorded = recordingSinks();
  await recordRuleSweep(VALID, recorded.sinks);
  const expected = JSON.stringify(VALID);
  assert(
    recorded.written.length === 1 && recorded.written[0] === expected,
    `expected one write of exactly ${expected}, got ${JSON.stringify(recorded.written)}`,
  );
}

export async function assertRecordObservesTheDurationInSeconds(): Promise<void> {
  const recorded = recordingSinks();
  await recordRuleSweep(VALID, recorded.sinks);
  const expected = JSON.stringify([{ durationSeconds: 0.412, raised: 2 }]);
  assert(
    JSON.stringify(recorded.observed) === expected,
    `expected observeRuleSweep(0.412, 2) once for durationMs 412 / raised 2, got ${JSON.stringify(recorded.observed)}`,
  );
}

/** Counts only — never a rule code, never a value (AGENTS.md §9.6). */
export async function assertRecordLogsTheCountsLine(): Promise<void> {
  const recorded = recordingSinks();
  await recordRuleSweep(VALID, recorded.sinks);
  const expected = "rules-sweep finished: evaluated=12 raised=2 durationMs=412";
  assert(
    recorded.logged.length === 1 && recorded.logged[0] === expected,
    `expected one log line "${expected}", got ${JSON.stringify(recorded.logged)}`,
  );
}
