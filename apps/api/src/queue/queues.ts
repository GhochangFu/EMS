import type { QueueDeclaration } from "./queue-registry";

/**
 * The one registry list (ADR 0063 decision 4): every queue this deployment
 * declares, in one place. `QueueModule` (Unit 4) builds a `QueueClient` from
 * it, and the worker host registers a processor for each entry.
 *
 * Empty at Unit 2. **Unit 3 adds `heartbeatQueue`** (`./heartbeat`), the
 * decision 10 repeatable job — `[heartbeatQueue] as const`. `F3.11` and
 * `F3.12` append theirs here, each with its own tenancy and retry policy,
 * and nowhere else.
 *
 * `as const satisfies readonly QueueDeclaration[]`: the tuple keeps each
 * entry's literal `name` and `tenancy` for `PayloadOf` and the processor
 * context, and `satisfies` refuses an entry that is not a declaration
 * without widening the tuple to `QueueDeclaration[]`.
 */
export const ALL_QUEUES = [] as const satisfies readonly QueueDeclaration[];
