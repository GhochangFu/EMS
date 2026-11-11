import { z } from "zod";

import { defineQueue } from "./queue-registry";

/**
 * The `device-health` queue (`F3.16`, ADR 0127 decisions 12 and 16) — the
 * device-health sweep's declaration, on the `rules-sweep` shape.
 *
 * The worker host upserts one repeatable job every `DEVICE_HEALTH_INTERVAL_MS`
 * (30 s by default) under {@link DEVICE_HEALTH_SCHEDULER_ID}; the processor
 * (`DeviceHealthSweepService`, in `device-health/`) reads every monitored RTU
 * and every ingest host on the fleet handle, raises the `ingest_host` and
 * `rtu_comms` alarms through `AlarmRaiser.raiseDevice` under each
 * organization's tenant GUC, and prunes the hour buckets past 30 days.
 *
 * **Fleet, not tenant**: the read spans organizations by design and the host
 * rows carry no tenant column. The payload is `z.object({}).strict()` — the
 * scheduler is the identity, and the schema refuses a smuggled field at
 * `upsertSchedule` and again at the processor.
 *
 * **Retry policy: `RETRY_DEFAULTS`.** A sweep that throws is retried; the next
 * tick runs regardless, and every write it makes is idempotent (the raise
 * dedupes on `alarms_open_per_device_uidx`, the prune is a range delete).
 */

/** The job scheduler id. The scheduler is the identity — there is no `jobId` on a repeatable job. */
export const DEVICE_HEALTH_SCHEDULER_ID = "device-health";

export const deviceHealthQueue = defineQueue({
  name: "device-health",
  tenancy: "fleet",
  payload: z.object({}).strict(),
});
