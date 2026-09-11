import { describe, it } from "vitest";

import {
  assertEncodesIdsOnlyInDeclaredKeyOrder,
  assertRejectsANonUuidAlarmId,
  assertRejectsAnExtraKey,
  assertRejectsAnUnknownType,
  assertRejectsNonJson,
  assertRoundTripsAnEncodedNotification,
} from "./alarm-notify-channel.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 * One `it()` per row so a mutation reddens the row that owns the claim and
 * no other.
 */
describe("alarm-notify-channel", () => {
  it("encodes ids only, in key order type, alarmId, organizationId, under 7000 UTF-8 bytes", () => {
    assertEncodesIdsOnlyInDeclaredKeyOrder();
  });

  it("round-trips an encoded notification (positive control)", () => {
    assertRoundTripsAnEncodedNotification();
  });

  it("decodes a non-JSON payload to null rather than throwing", () => {
    assertRejectsNonJson();
  });

  it("decodes a type other than created to null until F4.132 widens the literal", () => {
    assertRejectsAnUnknownType();
  });

  it("decodes a payload with an extra key to null (.strict())", () => {
    assertRejectsAnExtraKey();
  });

  it("decodes a non-uuid alarmId to null (.uuid())", () => {
    assertRejectsANonUuidAlarmId();
  });
});
