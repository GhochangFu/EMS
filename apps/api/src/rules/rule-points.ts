import {
  CONTROL_ROOM_ELECTRICAL_POINT_KEYS,
  CONTROL_ROOM_ENVIRONMENT_POINT_KEYS,
  CONTROL_ROOM_IT_POINT_KEYS,
  CONTROL_ROOM_UPS_POINT_KEYS,
  ELECTRICAL_POINT_KEYS,
  HVAC_POINT_KEYS,
} from "@bms/shared";

/**
 * Which telemetry points a rule may reference for a given asset.
 *
 * Used twice: to populate the guided builder's catalog, and to reject a draft
 * whose point does not belong to its asset. Both must agree, which is why it is
 * one function rather than two lists.
 *
 * Order matters — the `CR-` prefix checks are narrower than the trailing
 * control-room electrical fallback, so they have to come first.
 */
export function pointKeysForAsset(domain: string, code: string): string[] {
  if (code.startsWith("CR-RACK") || code.startsWith("CR-PDU")) {
    return [...CONTROL_ROOM_IT_POINT_KEYS];
  }
  if (code.startsWith("CR-UPS") || code.startsWith("CR-BATT")) {
    return [...CONTROL_ROOM_UPS_POINT_KEYS];
  }
  if (domain === "environment" || code.startsWith("CR-ENV") || code.startsWith("CR-LEAK") || code.startsWith("CR-SMOKE")) {
    return [...CONTROL_ROOM_ENVIRONMENT_POINT_KEYS];
  }
  if (domain === "hvac") {
    return [...HVAC_POINT_KEYS];
  }
  if (code.startsWith("CR-")) {
    return [...CONTROL_ROOM_ELECTRICAL_POINT_KEYS];
  }
  return [...ELECTRICAL_POINT_KEYS];
}
