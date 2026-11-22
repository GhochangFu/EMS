import { vi } from "vitest";

import type { DeviceProfileDto, StockDeviceProfileDto } from "@bms/shared/contracts";

/**
 * `F1.2` (plan T6.1) — fixtures and the wire stub the two device-profile specs
 * share: `device-profile-editor.spec.tsx` and `device-profiles-page.spec.tsx`.
 * Not a test itself; nothing in the app imports it.
 */

export const ORG_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";

type Register = DeviceProfileDto["registers"][number];

export function register(overrides: Partial<Register> & Pick<Register, "sourceKey" | "address">): Register {
  return {
    table: "holding",
    type: "uint16",
    wordOrder: "big",
    byteSwap: false,
    scale: 1,
    offset: 0,
    ...overrides,
  };
}

export function profile(
  overrides: Partial<DeviceProfileDto> & Pick<DeviceProfileDto, "id" | "code" | "version">,
): DeviceProfileDto {
  return {
    organizationId: ORG_ID,
    protocol: "modbus_tcp",
    vendor: "Spec Vendor",
    model: "SV-100",
    source: { document: "SV-100 manual", revision: "R2", pages: "12-14" },
    verified: false,
    registers: [register({ sourceKey: "kwh_total", address: 0 })],
    stockCode: null,
    stockVersion: null,
    createdBy: USER_ID,
    createdAt: new Date(0).toISOString(),
    ...overrides,
  };
}

export function stockProfile(overrides: Partial<StockDeviceProfileDto> & Pick<StockDeviceProfileDto, "code">) {
  return {
    version: 1,
    vendor: "Stock Vendor",
    model: "ST-1",
    source: { document: "ST-1 manual", revision: "A", pages: "3" },
    verified: true,
    registers: [register({ sourceKey: "kwh_total", address: 0 })],
    ...overrides,
  } satisfies StockDeviceProfileDto;
}

/** One request as it left the client: the path after `/api/v1`, the method and the parsed body. */
export type WireCall = { path: string; method: string; body: unknown };

export type WireReply = { status: number; body: unknown };

/**
 * Stubs `fetch` and records every request. `reply` answers each one; an
 * unanswered request is a 404, so a request the spec did not expect is visible
 * in `calls` and never reaches a local API.
 */
export function stubWire(reply: (call: WireCall) => WireReply | undefined): WireCall[] {
  const calls: WireCall[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    const path = String(url).replace(/^.*\/api\/v1/, "");
    const body = typeof init.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
    const call = { path, method: (init.method ?? "GET").toUpperCase(), body };
    calls.push(call);
    const answer = reply(call) ?? { status: 404, body: { message: "not stubbed" } };
    return new Response(JSON.stringify(answer.body), { status: answer.status });
  });
  return calls;
}
