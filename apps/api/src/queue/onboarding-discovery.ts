import {
  MQTT_DISCOVERY_MAX_WINDOW_SECONDS,
  MQTT_DISCOVERY_MIN_WINDOW_SECONDS,
  MQTT_DISCOVERY_RTU_CODE_MAX,
  MQTT_DISCOVERY_TOPIC_MAX,
} from "@bms/shared";
import { z } from "zod";

import { defineQueue } from "./queue-registry";

/**
 * The `onboarding-discovery` queue (`F3.24b`, ADR 0103 decisions 1 and 7) —
 * one bounded, read-only MQTT listening job per confirmed discovery.
 *
 * **Tenant.** A discovery belongs to one onboarding session, so one
 * organization. `organizationId` is the field ADR 0103 decision 7's list does
 * not name (Amendment 1): the `tenant` overload of `defineQueue` requires it,
 * and the worker opens `withTenant` on the session row with it. The producer
 * (U3's route) takes it from the **locked session row**, never from the JWT
 * or the body (security review M4).
 *
 * **No credential, and `.strict()`.** The worker decrypts the RTU's
 * `_secrets` entry itself; a credential-shaped extra key is refused at
 * `enqueue` and again at the processor (`runProcessor` parses, it does not
 * cast).
 *
 * **`attempts: 1`.** A retried job would open a second broker connection
 * after a failure the user already saw. Idempotency is on
 * `draft._discovery.discoveryId`: the job runs only while the stored
 * discovery is this one and still `queued`.
 */
export const onboardingDiscoveryQueue = defineQueue({
  name: "onboarding-discovery",
  tenancy: "tenant",
  payload: z
    .object({
      organizationId: z.string().uuid(),
      sessionId: z.string().uuid(),
      rtuCode: z.string().min(2).max(MQTT_DISCOVERY_RTU_CODE_MAX),
      discoveryId: z.string().uuid(),
      topicPrefix: z.string().min(1).max(MQTT_DISCOVERY_TOPIC_MAX),
      windowSeconds: z
        .number()
        .int()
        .min(MQTT_DISCOVERY_MIN_WINDOW_SECONDS)
        .max(MQTT_DISCOVERY_MAX_WINDOW_SECONDS),
    })
    .strict(),
  retry: { attempts: 1 },
});

/** The BullMQ job id of one discovery — `JOB_ID_PATTERN` grammar, no colon. */
export function discoveryJobId(discoveryId: string): string {
  return `discovery-${discoveryId}`;
}
