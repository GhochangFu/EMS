import { describe, it } from "vitest";

import {
  assertANonUuidIsDroppedWithOneWarn,
  assertAnEmptyPayloadIsDropped,
  assertAUuidDisconnectsThatUser,
  assertDecodesAUuid,
  assertTheChannelName,
} from "./user-disabled-notify.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("bms_user_disabled NOTIFY (F3.78, ADR 0089 decision 8)", () => {
  it("listens on the channel bms_user_disabled", () => {
    assertTheChannelName();
  });

  it("decodes a uuid payload", () => {
    assertDecodesAUuid();
  });

  it("disconnects the user a uuid payload names", () => {
    assertAUuidDisconnectsThatUser();
  });

  it("drops a non-uuid payload with one warn that does not quote it", () => {
    assertANonUuidIsDroppedWithOneWarn();
  });

  it("drops an empty payload", () => {
    assertAnEmptyPayloadIsDropped();
  });
});
