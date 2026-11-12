import { z } from "zod";

import { lookupAdapter } from "../adapter/registry.js";
import type { IngestAdapterFactory } from "../adapter/types.js";
import { parseEdgeConfigFile } from "./edge-config.js";
import { planEdgeEndpoints } from "./edge-plan.js";
import { assert } from "./normaliser.spec.js";

/**
 * `E7.2` / ADR 0123 decision 3, plan T5.2 — the edge's endpoint plans.
 * Assertions live here; `edge-plan.test.ts` is the vitest entry point.
 */

/** A connection-per-device poll factory: its `endpointKey` is the device. */
const perDevice: IngestAdapterFactory = {
  protocol: "modbus_tcp",
  mode: "poll",
  configSchema: z.object({ host: z.string() }),
  deviceSchema: z.object({ unit: z.number() }),
  endpointKey: (_config, rtuId) => `unit:${rtuId}`,
  create: () => {
    throw new Error("not started in this spec");
  },
};

function lookup(protocol: string): IngestAdapterFactory | undefined {
  return protocol === "modbus_tcp" ? perDevice : lookupAdapter(protocol as "mqtt");
}

function plans(endpoints: readonly unknown[]) {
  const parsed = parseEdgeConfigFile(JSON.stringify({ endpoints }), {
    env: {},
    lookup,
    mqttPlaintextHosts: new Set(),
  });
  return planEdgeEndpoints(parsed).map((entry) => {
    assert(entry.factory.protocol === entry.plan.protocol, "the plan carries its own factory");
    return entry.plan;
  });
}

const BROKER = { host: "broker.site.local", port: 8883 };

/** One MQTT broker serves every device on it: one plan, every binding, an empty point index. */
export function oneBrokerIsOnePlan(): void {
  const [plan, ...rest] = plans([
    {
      protocol: "mqtt",
      config: BROKER,
      devices: [
        { deviceKey: "RTU-1", device: { topic: "site/1" }, sourceKeys: ["kw"] },
        { deviceKey: "RTU-2", device: { topic: "site/2" }, sourceKeys: ["kw", "kwh"] },
      ],
    },
  ]);
  assert(rest.length === 0, `one broker, one plan; got ${rest.length + 1}`);
  assert(plan?.endpointKey === "broker.site.local:8883", `the adapter's own key: ${plan?.endpointKey}`);
  assert(plan.bindings.map((b) => b.deviceKey).join(",") === "RTU-1,RTU-2", "every device is bound");
  const binding = plan.bindings[1];
  assert(binding?.rtuCode === "RTU-2" && binding.rtuId === "RTU-2", "rtuCode and rtuId are the device key");
  assert(binding.sourceKeys.join(",") === "kw,kwh", "sourceKeys carried");
  assert(plan.pointIndex.size === 0, "the edge holds no point mapping");
  // F4.333 (ADR 0129 decision 4): the edge plan never reloads, so it carries no credential fingerprint.
  assert(plan.credentialFingerprint === "", "the edge plan's credential fingerprint is empty");
}

/** A connection-per-device protocol gets one plan per `factory.endpointKey`; `sourceKeys` default `[]`. */
export function aPerDeviceProtocolIsOnePlanPerDevice(): void {
  const result = plans([
    {
      protocol: "modbus_tcp",
      config: { host: "10.0.0.5" },
      devices: [
        { deviceKey: "PLC-1", device: { unit: 1 } },
        { deviceKey: "PLC-2", device: { unit: 2 } },
      ],
    },
  ]);
  assert(result.map((p) => p.endpointKey).join(",") === "unit:PLC-1,unit:PLC-2", "one plan per device");
  assert(result.every((p) => p.bindings.length === 1 && p.bindings[0]?.sourceKeys.length === 0), "sourceKeys []");
}

/** Two file endpoints on one broker would share a buffer directory and a health line: refused. */
export function twoFileEndpointsOnOneKeyAreRefused(): void {
  let message = "";
  try {
    plans([
      { protocol: "mqtt", config: BROKER, devices: [{ deviceKey: "A", device: { topic: "a" }, sourceKeys: ["k"] }] },
      { protocol: "mqtt", config: BROKER, devices: [{ deviceKey: "B", device: { topic: "b" }, sourceKeys: ["k"] }] },
    ]);
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assert(message.includes("endpoints[0]") && message.includes("endpoints[1]"), `both are named: ${message}`);
}
