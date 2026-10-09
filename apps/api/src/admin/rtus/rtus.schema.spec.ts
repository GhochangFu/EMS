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

/**
 * `F2.10` (ADR 0098 Amendment 1, A4) — the RTU update cannot move an RTU:
 * `locationId` is omitted from the update schema and the object is strict, so
 * a body naming it is refused before the service runs. That is why A4's
 * inactive-location check has no RTU-update arm; if this ever accepts a
 * `locationId`, `RtusAdminService.update` needs `assertLocationActive` too.
 * The positive control keeps the refusal from being a schema that refuses
 * everything.
 */
export function assertTheUpdateSchemaRefusesALocationId(): void {
  expect(updateRtuBodySchema.safeParse({ displayName: "F2.10 control" }).success).toBe(true);
  expect(
    updateRtuBodySchema.safeParse({ locationId: "00000000-0000-4000-8000-000000000000" }).success,
  ).toBe(false);
}
