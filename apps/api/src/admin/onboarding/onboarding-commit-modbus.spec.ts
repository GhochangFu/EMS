import { BadRequestException } from "@nestjs/common";
import { expect } from "vitest";

import type { OnboardingDraft } from "@bms/shared";

import { committedIngestEnabled, draftModbusRtus } from "./onboarding-commit-modbus";

/**
 * `F1.2` plan PR 11 (ADR 0141 Amendment 1 (f), decision 23) — the pure half of the onboarding
 * commit's Modbus step. The database half (the profile read, the endpoint rule, the stored row)
 * is `onboarding-commit.modbus-profile.integration.spec.ts`.
 */

const PROFILE_ID = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";

type DraftRtu = NonNullable<OnboardingDraft["rtus"]>[number];

const rtu = (protocol: DraftRtu["protocol"], config: Record<string, unknown>, code = "RTU-1"): DraftRtu => ({
  code,
  displayName: code,
  protocol,
  config,
});

/** CM1 — only Modbus TCP RTUs, by draft index, the host canonical and the port 502 by default. */
export function assertOnlyModbusRtusAreReadWithACanonicalEndpoint(): void {
  const found = draftModbusRtus({
    rtus: [
      rtu("mqtt", { host: "broker", topic: "a/b" }, "M"),
      rtu("modbus_tcp", { host: "Meter.Local.", profileId: PROFILE_ID, device: { unitId: 7 } }, "A"),
      rtu("snmp", { host: "x" }, "S"),
      rtu("modbus_tcp", { host: "FD00::10", port: 5020 }, "B"),
    ],
  });
  expect(found.map((entry) => [entry.index, entry.code])).toEqual([
    [1, "A"],
    [3, "B"],
  ]);
  expect(found[0].endpoint).toEqual({ host: "meter.local", port: 502 });
  expect(found[0].config).toEqual({ host: "meter.local", profileId: PROFILE_ID, device: { unitId: 7 } });
  expect(found[1].endpoint).toEqual({ host: "fd00:0:0:0:0:0:0:10", port: 5020 });
}

/** CM2 — a Modbus config that does not parse is the validation 400 at its path, never the value. */
export function assertAnUnparsableModbusConfigIsTheValidation400(): void {
  let caught: unknown;
  try {
    draftModbusRtus({ rtus: [rtu("modbus_tcp", { host: "meter", profileId: "s3ntinel" })] });
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(BadRequestException);
  const body = (caught as BadRequestException).getResponse() as { errors: { path: string; message: string }[] };
  expect(body.errors.map((error) => error.path)).toContain("rtus.0.config.profileId");
  expect(JSON.stringify(body)).not.toContain("s3ntinel");
}

/** CM3 — ingest at commit: MQTT keeps the switch, Modbus keeps it only with a profile, the rest are off. */
export function assertIngestIsKeptForMqttAndForABoundModbusRtuOnly(): void {
  expect(committedIngestEnabled("mqtt", true, false)).toBe(true);
  expect(committedIngestEnabled("mqtt", undefined, false)).toBe(false);
  expect(committedIngestEnabled("modbus_tcp", true, true)).toBe(true);
  expect(committedIngestEnabled("modbus_tcp", false, true)).toBe(false);
  expect(committedIngestEnabled("modbus_tcp", undefined, true)).toBe(false);
  expect(committedIngestEnabled("modbus_tcp", true, false)).toBe(false);
  expect(committedIngestEnabled("snmp", true, true)).toBe(false);
  expect(committedIngestEnabled("simulator", true, false)).toBe(false);
}
