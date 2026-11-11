import { z } from "zod";

/**
 * `F3.30` — the system status read (ADR 0075 decisions 3, 4).
 *
 * `GET /api/v1/system/status`. Three components, one verdict, one data
 * quality figure and, since `F3.16`, the device-offline counts — nothing else. This is a plain-object encoding: no
 * `z.intersection`, no `.readonly()`, because the API builds a mutable
 * object and no `A & B` shape exists here (ADR 0030 Amendment 1 does not
 * bind a plain field set).
 *
 * ---
 *
 * **Which component reads which state (ADR 0075 decision 3's table):**
 *
 * | `key` | Source | `ok` | `degraded` | `not_configured` / `not_monitored` |
 * |---|---|---|---|---|
 * | `queue` | `QueueHealthService.read()` | connected, heartbeat fresh | disconnected, or `heartbeatStale` | `not_configured` — no `REDIS_URL` |
 * | `storage` | `StorageHealthService.read()` | reachable | configured, unreachable | `not_configured` |
 * | `field_data` | the ingest host heartbeat (`bms.ingest_hosts`, `F3.16` / ADR 0127 decision 21) | heartbeat fresh (≤ 30 s) | heartbeat stale or no host row | `not_monitored` — no mqtt asset in scope |
 *
 * `not_configured` and `not_monitored` never degrade `status` — the same
 * rule `/health` uses for an unconfigured queue.
 *
 * **A component entry carries state only (decision 4).** No queue depth,
 * bucket name, heartbeat time or error text — those stay on the liveness
 * probe `/health` and in logs. `systemComponentSchema` is `{ key, state }`
 * and nothing else on purpose.
 */

/** The three components this read reports, in the ADR's fixed order. */
export const systemComponentKeySchema = z.enum(["queue", "storage", "field_data"]);

/** See the file docblock's table for which component reaches which state. */
export const systemComponentStateSchema = z.enum([
  "ok",
  "degraded",
  "not_configured",
  "not_monitored",
]);

/** State only — no depth, bucket name, heartbeat time or error text (decision 4). */
export const systemComponentSchema = z.object({
  key: systemComponentKeySchema,
  state: systemComponentStateSchema,
});

/**
 * The fresh share of streaming assets in the caller's scope.
 *
 * `percent` is `null` when `streamingAssets` is `0` — there is no ratio to
 * report, and `0` would claim a real, measured zero rather than "nothing to
 * measure". `windowSeconds` is the **smallest** window an asset can have, the
 * 25 s floor (ADR 0075 Amendment 3, `F4.350`): since that amendment each asset
 * is fresh inside its own RTU's window (`clamp(2.5 x interval, 25 s, 900 s)`),
 * so there is no single window to report. It is kept for the contract's sake.
 */
export const systemDataQualitySchema = z.object({
  percent: z.number().min(0).max(100).nullable(),
  freshAssets: z.number().int().nonnegative(),
  streamingAssets: z.number().int().nonnegative(),
  windowSeconds: z.number().int().positive(),
});

/**
 * `F3.16` / ADR 0127 decision 19 — the "N devices offline" KPI: monitored RTUs
 * in the caller's scope, and how many of them are Offline. Required.
 */
export const systemDevicesSchema = z.object({
  monitored: z.number().int().nonnegative(),
  offline: z.number().int().nonnegative(),
});

/**
 * `GET /api/v1/system/status`. `status` is `operational` when no component
 * is `degraded`, otherwise `degraded` (ADR 0075 decision 3) — `checkedAt` is
 * when the read ran, not a cache instant.
 *
 * **Not `.strict()` at the top level, on purpose.** The parse test suite
 * requires an extra top-level key to be tolerated, so a future additive
 * field on the wire does not require a lock-step contract release.
 */
export const systemStatusResponseSchema = z.object({
  status: z.enum(["operational", "degraded"]),
  components: z.array(systemComponentSchema),
  dataQuality: systemDataQualitySchema,
  devices: systemDevicesSchema,
  checkedAt: z.string(),
});
