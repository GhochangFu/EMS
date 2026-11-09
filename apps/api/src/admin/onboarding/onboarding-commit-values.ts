import { isIanaTimeZone, type OnboardingDraft } from "@bms/shared";

import { emptyTopicAsNull } from "../rtu-topic";
import type { CatalogPointKeyFields } from "./onboarding-point-key-conflict";

/**
 * `F4.339` (ADR 0117 decisions 10 and 11) — values the commit derives for a
 * row the draft left open. Pure; no I/O.
 */

/**
 * Plan R10: a draft made before `location.timezone` existed may carry the zone
 * in `meta.timezone`. Used only when it is a string the field's own check
 * accepts; anything else is ignored, never written.
 */
export function metaTimezone(meta: Readonly<Record<string, unknown>> | undefined): string | undefined {
  const zone = meta?.timezone;
  return typeof zone === "string" && zone.length <= 64 && isIanaTimeZone(zone) ? zone : undefined;
}

/**
 * Decision 11: the unit a mapping with no `unit` commits with — the draft's
 * own declaration of the key first (it is new to the catalog), then the
 * catalog's unit. `undefined` when neither has one.
 */
export function unitOf(
  pointKey: string,
  declared: OnboardingDraft["pointKeys"] | undefined,
  catalog: CatalogPointKeyFields,
): string | undefined {
  const own = (declared ?? []).find((key) => key.code === pointKey)?.unit;
  if (typeof own === "string" && own !== "") return own;
  const fromCatalog = catalog.get(pointKey)?.unit;
  return typeof fromCatalog === "string" && fromCatalog !== "" ? fromCatalog : undefined;
}

/**
 * The `mqtt_topic` the commit writes for a draft RTU's config (F4.228 / F4.234):
 * `topic`, else the legacy `mqttTopic`, with an empty result stored as NULL.
 * Moved here by `F4.339` so the pre-check below and the insert read one rule.
 */
export function draftRtuMqttTopic(config: Readonly<Record<string, unknown>>): string | null {
  return emptyTopicAsNull(
    (typeof config.topic === "string" ? config.topic : null) ?? (typeof config.mqttTopic === "string" ? config.mqttTopic : null),
  );
}

/**
 * `F4.339` (ADR 0117 decision 8, plan R8): the commit's sentence when an RTU of
 * the same organization already holds a draft RTU's topic. Both codes are the
 * caller's own organization's data (RLS shows only them); a holder in another
 * organization is never read here and keeps the index's fixed text.
 */
export function topicHolderMessage(draftCode: string, holderCode: string, holderActive: boolean): string {
  return (
    `The MQTT topic of draft RTU ${draftCode} is already used by RTU ${holderCode} (${holderActive ? "active" : "inactive"}) ` +
    "in this organization. Choose a different topic, or clear that RTU's topic."
  );
}
