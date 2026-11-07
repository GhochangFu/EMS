import { expect } from "vitest";

import { connectionTlsOf } from "./rtu-connection-tls";

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
