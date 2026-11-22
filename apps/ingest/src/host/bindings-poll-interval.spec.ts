import type { IngestProtocol } from "@bms/shared/ingest";
import { expect } from "vitest";
import { z } from "zod";

import type { IngestAdapterFactory } from "../adapter/types.js";
import { mqttAdapterFactory } from "../adapters/mqtt.js";

import { BINDING_QUERY, planEndpoints, type BindingRow, type PlanResult } from "./bindings.js";
import { makeOptions, row } from "./bindings.spec.js";

/**
 * `F1.2` plan T3.3 / ADR 0016 Amendment 10 (a) — the planner resolves each
 * poll endpoint's interval and strips `pollIntervalMs` before the adapter's
 * schema sees the connection slice. MQTT (push) is unchanged.
 *
 * The fake poll factory's config schema is **strict**, so a `pollIntervalMs`
 * that reached it would skip the RTU as `invalid-connection-config`: the strip
 * is observed, not assumed. Fixtures are `bindings.spec.ts`'s.
 *
 * Assertions live here; `bindings-poll-interval.test.ts` is the vitest entry point.
 */

const seen: unknown[] = [];

const strictPollFactory: IngestAdapterFactory = {
  protocol: "modbus_tcp",
  mode: "poll",
  configSchema: z
    .object({ host: z.string(), port: z.number().int() })
    .strict()
    .transform((config) => {
      seen.push(config);
      return config;
    }),
  deviceSchema: z.object({ unitId: z.number().int() }),
  endpointKey: (config) => {
    const c = config as { host: string; port: number };
    return `modbus_tcp://${c.host}:${c.port}`;
  },
  create: () => {
    throw new Error("not constructed in these tests");
  },
};

const options = () =>
  makeOptions({
    lookup: (protocol: IngestProtocol) =>
      protocol === "modbus_tcp"
        ? strictPollFactory
        : protocol === "mqtt"
          ? (mqttAdapterFactory as unknown as IngestAdapterFactory)
          : undefined,
  });

/** One Modbus RTU row behind `host`, with its own unit id and stored interval. */
const modbusRow = (
  rtu: string,
  connection: Record<string, unknown>,
  organizationInterval: number | null = null,
  host = "10.0.0.5",
): BindingRow =>
  row({
    rtu_id: `rtu-${rtu}`,
    rtu_code: rtu,
    source_type: "catalog",
    config_protocol: "modbus_tcp",
    telemetry_source: "catalog",
    connection_config: { host, port: 502, ...connection, device: { unitId: Number(rtu.replace(/\D/g, "")) } },
    organization_default_poll_interval_ms: organizationInterval,
  });

const only = (result: PlanResult) => {
  expect(result.skipped).toEqual([]);
  expect(result.endpoints).toHaveLength(1);
  return result.endpoints[0] as PlanResult["endpoints"][number];
};

export function assertTheQuerySelectsTheOrganizationInterval(): void {
  expect(BINDING_QUERY).toContain("o.default_poll_interval_ms AS organization_default_poll_interval_ms");
}

export function assertThePlanCarriesTheResolvedInterval(): void {
  expect(only(planEndpoints([modbusRow("M1", { pollIntervalMs: 2_000 }, 60_000)], options())).pollIntervalMs).toBe(2_000);
  const inherited = only(planEndpoints([modbusRow("M1", {}, 60_000)], options()));
  expect(inherited.pollIntervalMs).toBe(60_000);
  expect(inherited.pollIntervalUsesDefault).toBe(false);
  const none = only(planEndpoints([modbusRow("M1", {})], options()));
  expect(none.pollIntervalMs).toBeNull();
  expect(none.pollIntervalUsesDefault).toBe(true);
}

export function assertTheAdapterSchemaNeverSeesTheInterval(): void {
  seen.length = 0;
  const plan = only(planEndpoints([modbusRow("M1", { pollIntervalMs: 2_000 })], options()));
  expect(seen).toEqual([{ host: "10.0.0.5", port: 502 }]);
  expect(plan.config).toEqual({ host: "10.0.0.5", port: 502 });
}

export function assertTheShortestIntervalOnASharedGatewayWins(): void {
  const plan = only(
    planEndpoints(
      [modbusRow("M1", { pollIntervalMs: 30_000 }), modbusRow("M2", { pollIntervalMs: 5_000 }), modbusRow("M3", {}, 60_000)],
      options(),
    ),
  );
  expect(plan.bindings.map((b) => b.deviceKey)).toEqual(["M1", "M2", "M3"]);
  expect(plan.pollIntervalMs).toBe(5_000);
  expect(plan.pollIntervalUsesDefault).toBe(false);
  const mixed = only(planEndpoints([modbusRow("M1", { pollIntervalMs: 30_000 }), modbusRow("M2", {})], options()));
  expect(mixed.pollIntervalMs).toBe(30_000);
  expect(mixed.pollIntervalUsesDefault).toBe(true);
}

export function assertAnOutOfBoundsValueWarnsByLevelAndFallsBack(): void {
  const endpoint = planEndpoints([modbusRow("M1", { pollIntervalMs: 500 }, 60_000)], options());
  expect(only(endpoint).pollIntervalMs).toBe(60_000);
  expect(endpoint.warnings).toEqual([
    { rtuId: "rtu-M1", rtuCode: "M1", reason: "poll-interval-out-of-bounds", detail: "endpoint" },
  ]);
  const organization = planEndpoints([modbusRow("M1", {}, 999)], options());
  expect(only(organization).pollIntervalMs).toBeNull();
  expect(organization.warnings).toEqual([
    { rtuId: "rtu-M1", rtuCode: "M1", reason: "poll-interval-out-of-bounds", detail: "organization" },
  ]);
  expect(JSON.stringify([endpoint.warnings, organization.warnings])).not.toMatch(/500|999/);
}

export function assertTheConfigFingerprintFollowsTheSlicesNotTheInterval(): void {
  const base = only(planEndpoints([modbusRow("M1", { pollIntervalMs: 2_000 })], options()));
  const otherInterval = only(planEndpoints([modbusRow("M1", { pollIntervalMs: 9_000 })], options()));
  expect(base.configFingerprint).toMatch(/^[0-9a-f]{64}$/);
  expect(otherInterval.configFingerprint).toBe(base.configFingerprint);
  const otherUnit = row({ ...modbusRow("M1", {}), connection_config: { host: "10.0.0.5", port: 502, device: { unitId: 9 } } });
  expect(only(planEndpoints([otherUnit], options())).configFingerprint).not.toBe(base.configFingerprint);
}

export function assertAnMqttPlanIsUnchanged(): void {
  // A push plan: no interval, no config fingerprint, and a stray `pollIntervalMs`
  // in its row is neither read nor stripped (MQTT's schema drops unknown keys itself).
  const result = planEndpoints([row({ connection_config: { pollIntervalMs: 2_000 } })], options());
  const plan = only(result);
  expect(plan.pollIntervalMs).toBeNull();
  expect(plan.configFingerprint).toBe("");
  expect(result.warnings.filter((w) => w.reason === "poll-interval-out-of-bounds")).toEqual([]);
  const withOrg = only(planEndpoints([row({ organization_default_poll_interval_ms: 999 })], options()));
  const without = only(planEndpoints([row()], options()));
  expect(withOrg.decoderFingerprint).toBe(without.decoderFingerprint);
  expect(withOrg.credentialFingerprint).toBe(without.credentialFingerprint);
  expect(withOrg.config).toEqual(without.config);
  expect(withOrg.pollIntervalMs).toBeNull();
}
