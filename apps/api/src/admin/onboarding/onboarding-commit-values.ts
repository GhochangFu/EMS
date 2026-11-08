import { isIanaTimeZone, type OnboardingDraft } from "@bms/shared";

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
