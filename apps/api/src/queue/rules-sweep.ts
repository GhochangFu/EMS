import { type RuleSweepSummary, ruleSweepSummarySchema } from "@bms/shared";
import type { Logger } from "@nestjs/common";
import { z } from "zod";

import type { MetricsService } from "../observability/metrics.service";
import { defineQueue } from "./queue-registry";

/**
 * The `rules-sweep` queue (`F3.11`, ADR 0064 decision 2) — the scheduled
 * rule evaluation's declaration, beside the heartbeat's and on the same
 * shape (`./heartbeat`).
 *
 * The worker host upserts one repeatable job every `RULE_SWEEP_INTERVAL_MS`
 * under `RULE_SWEEP_SCHEDULER_ID`; the processor (`RuleSweepService`, in
 * `rules/`) walks every enabled published rule across organizations and
 * raises through `AlarmRaiser`. This file holds only what BOTH processes
 * share: the declaration `QueueModule` builds a client from, the Redis key
 * the worker writes the last completed sweep to and the API reads back on
 * `GET /health`, the fail-closed parse of that key, and the three sinks a
 * completed sweep lands in (decision 8).
 *
 * **Fleet, not tenant.** The read is cross-organization by design (ADR 0033
 * decision 2); the per-rule writes then run under each rule's own tenant
 * GUC inside the processor. The payload is `z.object({}).strict()` — the
 * scheduler is the identity, and the schema refuses a field being smuggled
 * in, at `upsertSchedule` and again at the processor.
 *
 * **Retry policy: `RETRY_DEFAULTS`.** A sweep that throws is retried on
 * backoff and its failure counted in `bms_queue_jobs_total{queue=
 * "rules-sweep",outcome="failed"}`; the next scheduled tick runs regardless.
 */

/** The job scheduler id. The scheduler is the identity — there is no `jobId` on a repeatable job. */
export const RULE_SWEEP_SCHEDULER_ID = "rules-sweep";

export const rulesSweepQueue = defineQueue({
  name: "rules-sweep",
  tenancy: "fleet",
  payload: z.object({}).strict(),
});

/**
 * The Redis key the last completed sweep lands in, under the queue prefix
 * so it sits beside BullMQ's own `bms:rules-sweep:*` keys and beside
 * `heartbeatKey(prefix)` — the same namespace the integration spec isolates
 * with its own prefix.
 */
export function ruleSweepKey(prefix: string): string {
  return `${prefix}:rules-sweep:last`;
}

/**
 * The stored summary, or `null`. Three answers, all `null` except the last:
 *
 * 1. `null` in → `null` out: the worker has never completed a sweep.
 * 2. `JSON.parse` throws → `null`: a corrupt key.
 * 3. Parses but is not the schema → `null`: a shape from another build, or
 *    a hand-written value.
 * 4. Otherwise the summary, as `ruleSweepSummarySchema` narrows it.
 *
 * **Fails closed to "no sweep recorded", and never throws** — the health
 * read that calls this is racing a timeout and folds any rejection into
 * `disconnected()`; a bad VALUE must not read as a lost connection
 * (`queue-health.spec.ts` pins the difference).
 */
export function parseRuleSweepSummary(raw: string | null): RuleSweepSummary | null {
  if (raw === null) {
    return null;
  }
  let candidate: unknown;
  try {
    candidate = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = ruleSweepSummarySchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

/**
 * The three sinks of a completed sweep (decision 8), in one place so the
 * processor cannot drop one: the Redis key `GET /health` reads back, the
 * two metrics, and one `info` line with the same three counts.
 *
 * `observeRuleSweep` takes SECONDS — Prometheus's base unit for a
 * `_seconds` histogram — so the conversion from the summary's `durationMs`
 * happens here and nowhere else.
 *
 * The log line carries counts only: never a rule code, never a value
 * (AGENTS.md §9.6) — the sweep's per-rule detail is in `bms.rule_executions`
 * for whoever is entitled to read it.
 */
export async function recordRuleSweep(
  summary: RuleSweepSummary,
  sinks: {
    writeSummary(json: string): Promise<void>;
    metrics: Pick<MetricsService, "observeRuleSweep">;
    logger: Pick<Logger, "log">;
  },
): Promise<void> {
  await sinks.writeSummary(JSON.stringify(summary));
  sinks.metrics.observeRuleSweep(summary.durationMs / 1000, summary.raised);
  sinks.logger.log(
    `rules-sweep finished: evaluated=${summary.evaluated} raised=${summary.raised} durationMs=${summary.durationMs}`,
  );
}
