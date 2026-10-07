/**
 * `F4.221` — whether an MQTT topic holds a wildcard, `#` or `+`.
 *
 * A device topic names one device, so a wildcard is always a mistake: `#` would
 * subscribe to the entire broker. Three readers share this one predicate so they
 * cannot disagree: the MQTT device schema the ingest adapter parses with
 * (`./ingest-adapters/mqtt`, since `F3.24a`), the onboarding agent's `topicHasWildcard`
 * (`apps/api/src/admin/onboarding/onboarding-chat-summaries.ts`), and the admin
 * RTU routes' `mqttTopic` refine (`apps/api/src/admin/rtus/rtus.schema.ts`).
 *
 * A leaf module with no import (`F3.24a` review): `./ingest` re-exports it, and
 * `./ingest-adapters/mqtt` imports it from here rather than from `./ingest`, so
 * no runtime import cycle makes the protocol catalog depend on which module a
 * consumer loads first.
 */
export function mqttTopicHasWildcard(topic: string): boolean {
  return topic.includes("#") || topic.includes("+");
}
