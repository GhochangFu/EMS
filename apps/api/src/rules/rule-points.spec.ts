import {
  CONTROL_ROOM_ELECTRICAL_POINT_KEYS,
  CONTROL_ROOM_ENVIRONMENT_POINT_KEYS,
  CONTROL_ROOM_IT_POINT_KEYS,
  CONTROL_ROOM_UPS_POINT_KEYS,
  ELECTRICAL_POINT_KEYS,
  HVAC_POINT_KEYS,
} from "@bms/shared";

import { pointKeysForAsset } from "./rule-points";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function same(actual: string[], expected: readonly string[], label: string): void {
  assert(
    actual.length === expected.length && actual.every((key, i) => key === expected[i]),
    `${label}: expected [${expected.join(", ")}], got [${actual.join(", ")}]`,
  );
}

/**
 * Assertions for the point catalog (ADR 0014, §4.6).
 *
 * The order of the checks inside `pointKeysForAsset` is load-bearing: several
 * `CR-` prefixes are narrower than the trailing control-room electrical
 * fallback. Each case below pins one branch *and* the branch it must beat.
 */
export function runRulePointsTests(): void {
  same(pointKeysForAsset("it", "CR-RACK-01"), CONTROL_ROOM_IT_POINT_KEYS, "CR-RACK");
  same(pointKeysForAsset("it", "CR-PDU-01"), CONTROL_ROOM_IT_POINT_KEYS, "CR-PDU");
  same(pointKeysForAsset("ups", "CR-UPS-01"), CONTROL_ROOM_UPS_POINT_KEYS, "CR-UPS");
  same(pointKeysForAsset("ups", "CR-BATT-01"), CONTROL_ROOM_UPS_POINT_KEYS, "CR-BATT");

  same(
    pointKeysForAsset("environment", "ANY-CODE"),
    CONTROL_ROOM_ENVIRONMENT_POINT_KEYS,
    "environment domain",
  );
  for (const code of ["CR-ENV-01", "CR-LEAK-01", "CR-SMOKE-01"]) {
    same(
      pointKeysForAsset("electrical", code),
      CONTROL_ROOM_ENVIRONMENT_POINT_KEYS,
      `${code} is environment by code even when its domain is not`,
    );
  }

  same(pointKeysForAsset("hvac", "CRAC-01"), HVAC_POINT_KEYS, "hvac domain");

  // The `CR-` fallback, and the two things that must beat it.
  same(
    pointKeysForAsset("electrical", "CR-MAIN-01"),
    CONTROL_ROOM_ELECTRICAL_POINT_KEYS,
    "an unrecognised CR- code falls back to control-room electrical",
  );
  // The `CR-RACK`-beats-`CR-` ordering is pinned by the content comparison
  // above: the IT and control-room-electrical catalogs differ, so `same()`
  // discriminates. An identity check against the shared constant would not —
  // every branch returns a fresh copy, so it is true either way.
  same(
    pointKeysForAsset("hvac", "CR-CRAC-01"),
    HVAC_POINT_KEYS,
    "the hvac domain must beat the CR- electrical fallback",
  );

  same(
    pointKeysForAsset("electrical", "FEEDER-01"),
    ELECTRICAL_POINT_KEYS,
    "a non-CR asset falls back to plain electrical",
  );

  // A fresh array each call — the catalogs are module constants and a caller
  // that mutated the result would corrupt every later lookup.
  const first = pointKeysForAsset("electrical", "FEEDER-01");
  first.push("injected");
  const second = pointKeysForAsset("electrical", "FEEDER-01");
  assert(
    !second.includes("injected"),
    "the returned array must be a copy, not the shared constant",
  );
}
