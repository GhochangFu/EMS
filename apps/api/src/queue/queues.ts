import { heartbeatQueue } from "./heartbeat";
import type { QueueDeclaration } from "./queue-registry";
import { rulesSweepQueue } from "./rules-sweep";

/**
 * The one registry list (ADR 0063 decision 4): every queue this deployment
 * declares, in one place. `QueueModule` (Unit 4) builds a `QueueClient` from
 * it, and the worker host registers a processor for each entry.
 *
 * Two entries — `heartbeatQueue` (`./heartbeat`), the decision 10
 * repeatable job, and `rulesSweepQueue` (`./rules-sweep`, `F3.11`, ADR 0064
 * decision 2), the scheduled rule evaluation. `F3.12` appends its own here,
 * with its own tenancy, payload schema and retry policy, and nowhere else.
 *
 * A declaration's `jobId` de-duplicates only while the earlier job is still
 * retained (decision 7's `removeOnComplete` / `removeOnFail` counts), so
 * every processor registered against an entry here must be idempotent on
 * its own row — the queue never promises exactly-once.
 *
 * `as const satisfies readonly QueueDeclaration[]`: the tuple keeps each
 * entry's literal `name` and `tenancy` for `PayloadOf` and the processor
 * context, and `satisfies` refuses an entry that is not a declaration
 * without widening the tuple to `QueueDeclaration[]`.
 */
export const ALL_QUEUES = [heartbeatQueue, rulesSweepQueue] as const satisfies readonly QueueDeclaration[];
