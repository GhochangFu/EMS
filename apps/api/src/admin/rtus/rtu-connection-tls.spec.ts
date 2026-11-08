import { expect } from "vitest";

import { connectionPayloadFormatOf, connectionTlsOf } from "./rtu-connection-tls";

/** `F4.326` / ADR 0114 R4 — the `/admin/rtus` `tls` value. */
export function plainIsFalseAndAnyOtherMqttValueIsTrue(): void {
  expect(connectionTlsOf("mqtt", { tls: false })).toBe(false);
  expect(connectionTlsOf("mqtt", {})).toBe(true);
  expect(connectionTlsOf("mqtt", { tls: true })).toBe(true);
  expect(connectionTlsOf("mqtt", { tls: "false" })).toBe(true);
  expect(connectionTlsOf("mqtt", null)).toBe(true);
}

export function noRowOrNotMqttIsNull(): void {
  expect(connectionTlsOf(null, null)).toBeNull();
  expect(connectionTlsOf("modbus_tcp", { tls: false })).toBeNull();
}

/** `F4.334` / ADR 0116 decision 4 (plan R9) — the `/admin/rtus` `payloadFormat` value. */
export function payloadFormatIsTheMqttCodeOrNull(): void {
  expect(connectionPayloadFormatOf("mqtt", { payloadFormat: "thinkiot-register-array" })).toBe("thinkiot-register-array");
  expect(connectionPayloadFormatOf("mqtt", {})).toBeNull();
  expect(connectionPayloadFormatOf("mqtt", { payloadFormat: 7 })).toBeNull();
  expect(connectionPayloadFormatOf("mqtt", null)).toBeNull();
  expect(connectionPayloadFormatOf(null, null)).toBeNull();
  expect(connectionPayloadFormatOf("modbus_tcp", { payloadFormat: "x" })).toBeNull();
}
