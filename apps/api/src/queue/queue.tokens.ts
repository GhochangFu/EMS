/**
 * The DI token for the one `QueueClient` (ADR 0063 decision 4). `QueueModule`
 * provides it from `REDIS_URL` and `ALL_QUEUES`; producers (`F3.11`, `F3.12`)
 * and the worker host inject it. A symbol, like the database tokens, so no
 * string can alias it by accident.
 */
export const QUEUE_CLIENT = Symbol("QUEUE_CLIENT");
