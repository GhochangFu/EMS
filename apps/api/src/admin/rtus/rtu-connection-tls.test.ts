import { describe, it } from "vitest";

import {
  noRowOrNotMqttIsNull,
  payloadFormatIsTheMqttCodeOrNull,
  plainIsFalseAndAnyOtherMqttValueIsTrue,
} from "./rtu-connection-tls.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.326 — the /admin/rtus tls value (ADR 0114 R4)", () => {
  it("is false only for a literal tls:false on an MQTT row", plainIsFalseAndAnyOtherMqttValueIsTrue);
  it("is null with no row or a non-MQTT row", noRowOrNotMqttIsNull);
  it("payloadFormat is the MQTT row's code, else null (F4.334)", payloadFormatIsTheMqttCodeOrNull);
});
