/**
 * The DI token for the one `QueueClient` (ADR 0063 decision 4). `QueueModule`
 * provides it from `REDIS_URL` and `ALL_QUEUES`; producers (`F3.11`, `F3.12`)
 * and the worker host inject it. A symbol, like the database tokens, so no
 * string can alias it by accident.
 */
export const QUEUE_CLIENT = Symbol("QUEUE_CLIENT");

/**
 * The DI token for the worker process's `WorkerConfig` (`F3.11`, ADR 0064
 * decision 6). `worker.ts` reads and validates the environment before any
 * Nest context exists; `WorkerModule` provides this token from a second,
 * deterministic read of the same environment so `RULE_SWEEP_INTERVAL_MS`
 * reaches `WorkerHostService` through the graph rather than through a
 * `process.env` read inside the service. Only `WorkerModule` provides it —
 * the API process has no worker config.
 */
export const WORKER_CONFIG = Symbol("WORKER_CONFIG");
