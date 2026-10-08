/**
 * `F4.223` — an empty topic is stored as NULL, never `''`.
 * `rtus_mqtt_topic_idx` (migration 0016) is `WHERE mqtt_topic IS NOT NULL` with no
 * `<> ''` arm, unlike `rtus_rtu_code_idx` (0071), so a stored `''` is a value two
 * rows cannot share: the second RTU with no topic answered the F4.141 409.
 * `''` stays accepted by the schema (`rtus.schema.test.ts`, F4.221) because it is the
 * only clear path; it is the stored value that changes. Applied to the restated
 * `existing.mqttTopic` too, so a row written before this fix is repaired on its
 * next edit. The audit payload keeps the body as sent.
 *
 * `F4.228`: the onboarding commit is the second caller, so the helper lives here
 * and both services import it.
 */
export function emptyTopicAsNull(topic: string | null): string | null {
  return topic === "" ? null : topic;
}
