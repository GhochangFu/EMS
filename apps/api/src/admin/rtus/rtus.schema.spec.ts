import { expect } from "vitest";

import { updateRtuBodySchema } from "./rtus.schema";

/**
 * `F4.60` — the empty string is the **only** way to clear `rtus.rtu_code`
 * through the admin API, so the schema has to keep accepting it.
 *
 * `updateRtuBodySchema` is `createRtuBodySchema.omit({locationId}).partial()`:
 * every field is optional but **not nullable**, and `update` reads
 * `body.rtuCode !== undefined ? body.rtuCode : existing.rtuCode`. So an omitted
 * key means "leave it alone" and `null` cannot be sent at all. `""` is what is
 * left.
 *
 * Migration `0071`'s index is `WHERE rtu_code IS NOT NULL AND rtu_code <> ''`
 * precisely so that many cleared rows can coexist. Adding `.min(1)` to `rtuCode`
 * — the reflex when tightening input validation, and the shape `code` and
 * `displayName` already have — would silently remove the affordance: an operator
 * who unbound an RTU from the ingest host would get a 400 and no way to do it.
 * Nothing else in the codebase states that dependency, which is why it is
 * asserted here rather than left to a comment.
 */
export function assertAnEmptyRtuCodeIsAcceptedByTheUpdateSchema(): void {
  expect(updateRtuBodySchema.safeParse({ rtuCode: "" }).success).toBe(true);
}

/**
 * `F4.221` — the wildcard refine on `mqttTopic` refuses `#` and `+` and nothing
 * else, so it must not refuse `""` (a refine written as "must name a device" is a
 * `.min(1)` in disguise). Unlike `rtuCode`, this is not a working clear path:
 * `rtus_mqtt_topic_idx` (migration `0016`) is only `WHERE mqtt_topic IS NOT NULL`
 * and does not exclude `""`, so a second RTU that stores `""` gets the 409.
 */
export function assertAnEmptyMqttTopicIsAcceptedByTheUpdateSchema(): void {
  expect(updateRtuBodySchema.safeParse({ mqttTopic: "" }).success).toBe(true);
}
