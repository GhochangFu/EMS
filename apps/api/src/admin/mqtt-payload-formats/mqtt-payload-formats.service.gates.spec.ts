import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { expect } from "vitest";

import type { JwtPayload } from "@bms/shared";

import { MqttPayloadFormatsAdminService, testResponse } from "./mqtt-payload-formats.service";
import { decodeMqttPayload, mqttPayloadFormatDefinitionSchema } from "@bms/shared";

/**
 * `F4.334` / ADR 0116 decision 5 (plan R5, T3.1) — the gate order and the test
 * route, with stubbed pools (the database claims are the integration spec's).
 */

const JWT = { sub: "u", email: "someone@bms.local", role: "organization_admin" } as unknown as JwtPayload;

const BCPL_DEFINITION = {
  kind: "declarative",
  root: "array",
  deviceKey: ["TagName"],
  time: { path: ["Timestamp"], unit: "epoch_s" },
  readings: [
    { key: "treated_water_flow_klh", register: { path: ["Data"], index: 0, type: "float32" } },
    { key: "outlet_flow_totalizer_kl", register: { path: ["Data"], index: 3, type: "float32" } },
  ],
};
export const BCPL_SAMPLE = JSON.stringify([
  { Data: [16294, 26214, 81, 18230, 9202, 113, 17852, -17809, 177, 82], Timestamp: "1794077986", TagName: "BCPL_LAKWA_02" },
]);

/** A service whose pools throw if touched, so a gate that lets a call through reddens. */
function serviceFor(role: string, events: string[]): MqttPayloadFormatsAdminService {
  const untouched = new Proxy(
    {},
    {
      get: (_target, key) => {
        events.push(`db.${String(key)}`);
        throw new Error(`the database was reached (${String(key)})`);
      },
    },
  );
  const accessControl = {
    requireMasterDataUser: async () => ({ id: "u-1", role }),
    assertAdminRole: (r: string) => {
      if (r !== "admin") throw new ForbiddenException("global admin only");
    },
  };
  const audit = {
    write: async () => {
      events.push("audit");
    },
  };
  return new MqttPayloadFormatsAdminService(untouched as never, accessControl as never, audit as never, untouched as never);
}

/** G1 — every write and the test route are the global admin's, refused before any parse or read. */
export async function aTenantAdminIsRefusedEveryWriteFirst(): Promise<void> {
  const events: string[] = [];
  const svc = serviceFor("organization_admin", events);
  for (const run of [
    () => svc.create(JWT, { not: "a body" }),
    () => svc.update(JWT, "Bad Code", {}),
    () => svc.remove(JWT, "thinkiot-register-array"),
    () => svc.test(JWT, { definition: BCPL_DEFINITION, topic: "t", sample: BCPL_SAMPLE }),
  ]) {
    await expect(run()).rejects.toBeInstanceOf(ForbiddenException);
  }
  expect(events).toEqual([]);
}

/** G2 — the global admin's malformed body or code is a 400 before any read. */
export async function aMalformedInputIsA400(): Promise<void> {
  const events: string[] = [];
  const svc = serviceFor("admin", events);
  await expect(svc.create(JWT, { code: "x", name: "x", definition: { kind: "builtin", name: "thinkiot-envelope" } })).rejects.toBeInstanceOf(BadRequestException);
  await expect(svc.update(JWT, "Bad Code", { name: "x" })).rejects.toBeInstanceOf(BadRequestException);
  await expect(svc.update(JWT, "acme", {})).rejects.toBeInstanceOf(BadRequestException);
  await expect(svc.test(JWT, { definition: BCPL_DEFINITION, topic: "t", sample: "x".repeat(65_537) })).rejects.toBeInstanceOf(BadRequestException);
  expect(events).toEqual([]);
}

/** G3 — the test route decodes the BCPL sample, writes no audit row and touches no table. */
export async function theTestRouteDecodesAndStoresNothing(): Promise<void> {
  const events: string[] = [];
  const svc = serviceFor("admin", events);
  const answer = await svc.test(JWT, { definition: BCPL_DEFINITION, topic: "BCPL/LAKWA", sample: BCPL_SAMPLE });
  expect(answer).toEqual({
    ok: true,
    records: [
      {
        deviceKey: "BCPL_LAKWA_02",
        at: "2026-11-07T18:59:46.000Z",
        values: { treated_water_flow_klh: 1.2999999523162842, outlet_flow_totalizer_kl: 46627.9453125 },
      },
    ],
  });
  expect(events).toEqual([]);
  const failed = await svc.test(JWT, { definition: BCPL_DEFINITION, topic: "t", sample: "{}" });
  expect(failed).toEqual({ ok: false, reason: "root-mismatch", records: [] });
}

/** G4 — the built-in kind's raw values are narrowed to numbers or null on the wire. */
export function theTestResponseNarrowsBuiltinValues(): void {
  const builtin = mqttPayloadFormatDefinitionSchema.parse({ kind: "builtin", name: "thinkiot-envelope" });
  const decoded = decodeMqttPayload(builtin, "t", JSON.stringify({ dev_id: "PHE-1", values: { a: 1, b: "2.5", c: "x", d: { e: 1 } } }));
  expect(testResponse(decoded)).toEqual({
    ok: true,
    records: [{ deviceKey: "PHE-1", at: null, values: { a: 1, b: 2.5, c: null, d: null } }],
  });
}
