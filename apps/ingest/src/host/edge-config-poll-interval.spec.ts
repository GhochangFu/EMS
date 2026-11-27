import type { IngestProtocol } from "@bms/shared/ingest";
import { expect } from "vitest";
import { z } from "zod";

import type { IngestAdapterFactory } from "../adapter/types.js";
import { lookupAdapter } from "../adapter/registry.js";
import { EdgeConfigError, parseEdgeConfigFile } from "./edge-config.js";
import { planEdgeEndpoints } from "./edge-plan.js";

/**
 * `F1.2` plan T3.6 / ADR 0016 Amendment 10 (a), ADR 0141 decision 17 — the
 * edge reads a poll endpoint's `config.pollIntervalMs` from its file, bounds
 * it with the shared schema, removes it before the adapter's schema, and
 * carries it on the plan. The export (PR 7) writes the resolved interval there.
 *
 * The fake poll factory's config schema is strict, so an interval that reached
 * it would refuse the file by an `unrecognized_keys` path, not by the bound.
 *
 * Assertions live here; `edge-config-poll-interval.test.ts` is the vitest entry point.
 */

const strictPollFactory: IngestAdapterFactory = {
  protocol: "modbus_tcp",
  mode: "poll",
  configSchema: z.object({ host: z.string(), port: z.number().int() }).strict(),
  deviceSchema: z.object({ unitId: z.number().int() }),
  endpointKey: (config) => {
    const c = config as { host: string; port: number };
    return `modbus_tcp://${c.host}:${c.port}`;
  },
  create: () => {
    throw new Error("not constructed in these tests");
  },
};

const lookup = (protocol: IngestProtocol) => (protocol === "modbus_tcp" ? strictPollFactory : lookupAdapter(protocol));

const parse = (config: Record<string, unknown>) =>
  parseEdgeConfigFile(
    JSON.stringify({
      endpoints: [
        {
          protocol: "modbus_tcp",
          config: { host: "10.0.0.5", port: 502, ...config },
          devices: [{ deviceKey: "M1", device: { unitId: 1 } }, { deviceKey: "M2", device: { unitId: 2 } }],
        },
      ],
    }),
    { env: {}, lookup, mqttPlaintextHosts: new Set() },
  );

const refusal = (config: Record<string, unknown>): string => {
  try {
    parse(config);
  } catch (error) {
    if (error instanceof EdgeConfigError) return error.message;
    throw error;
  }
  throw new Error("expected the file to be refused");
};

export function assertTheIntervalIsReadAndStripped(): void {
  const [endpoint] = parse({ pollIntervalMs: 15_000 });
  expect(endpoint?.pollIntervalMs).toBe(15_000);
  expect(endpoint?.config).toEqual({ host: "10.0.0.5", port: 502 });
}

export function assertNoIntervalIsNull(): void {
  expect(parse({})[0]?.pollIntervalMs).toBeNull();
  expect(parse({ pollIntervalMs: null })[0]?.pollIntervalMs).toBeNull();
}

export function assertAnOutOfBoundsIntervalRefusesTheFileByPath(): void {
  for (const bad of [999, 3_600_001, 1.5, "15000"]) {
    const message = refusal({ pollIntervalMs: bad });
    expect(message, String(bad)).toContain("endpoints[0].config.pollIntervalMs:");
    expect(message, String(bad)).not.toContain(String(bad));
    expect(message, String(bad)).not.toContain("unrecognized_keys");
  }
}

export function assertTheEdgePlanCarriesTheInterval(): void {
  const [entry] = planEdgeEndpoints(parse({ pollIntervalMs: 15_000 }));
  expect(entry?.plan.pollIntervalMs).toBe(15_000);
  expect(entry?.plan.pollIntervalUsesDefault).toBe(false);
  expect(entry?.plan.configFingerprint).toBe("");
  const [none] = planEdgeEndpoints(parse({}));
  expect(none?.plan.pollIntervalMs).toBeNull();
  expect(none?.plan.pollIntervalUsesDefault).toBe(true);
}

export function assertAPushEndpointIsUntouched(): void {
  const [endpoint] = parseEdgeConfigFile(
    JSON.stringify({
      endpoints: [
        {
          protocol: "mqtt",
          config: { host: "broker.example", port: 8883, pollIntervalMs: 999 },
          devices: [{ deviceKey: "R1", device: { topic: "a/b" }, sourceKeys: ["kw"] }],
        },
      ],
    }),
    { env: {}, lookup, mqttPlaintextHosts: new Set() },
  );
  expect(endpoint?.pollIntervalMs).toBeNull();
}
