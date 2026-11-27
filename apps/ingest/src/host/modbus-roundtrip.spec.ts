import { parseModbusTcpHosts, type ModbusImage } from "@bms/shared/ingest";
import { expect } from "vitest";

import { lookupAdapter } from "../adapter/registry.js";
import type { IngestAdapterFactory } from "../adapter/types.js";
import { startModbusTestServer, type ModbusTestServer } from "../testing/modbus-test-server.js";
import { planEndpoints, type BindingRow, type EndpointPlan } from "./bindings.js";
import { makeOptions, row } from "./bindings.spec.js";
import { parseEdgeConfigFile } from "./edge-config.js";
import { planEdgeEndpoints } from "./edge-plan.js";
import { until } from "./edge-roundtrip.spec.js";
import { resolveSamples } from "./normaliser.js";
import type { ReceivedSample } from "./received-sample.js";
import { createSupervisor, realScheduler, type Supervisor } from "./supervisor.js";
import { makeMemoryBuffer, silentLogger } from "./supervisor.spec.js";

/**
 * `F1.2` plan T4.4 — the Modbus path end to end, with no database: the shipped
 * adapter, the real `node:net` transport and the real supervisor against an
 * in-process server on `127.0.0.1` (ADR 0141 decision 19).
 *
 * - Cloud wiring: binding rows → `planEndpoints` with the real registry →
 *   supervisor → `resolveSamples` gives the served values for the mapped
 *   points and drops nothing as `unmappedSourceKey` (plan C5).
 * - Edge wiring: the file → `parseEdgeConfigFile` → `planEdgeEndpoints` →
 *   supervisor; the edge reads every register (no `sourceKeys` on the box).
 * - The server stops: the adapter reports `disconnected`, the host restarts it
 *   through its backoff (ADR 0016 Amendment 10 (c)), and reads resume when the
 *   server is back on the same port.
 *
 * The cadence of a 1,000 ms plan interval is held on a fake scheduler by
 * `supervisor-poll.spec.ts` S1; here the real scheduler runs at that floor.
 *
 * Assertions live here; `modbus-roundtrip.test.ts` is the vitest entry point.
 */

const IMAGE = (): ModbusImage => ({ holding: new Map([[0, 120], [1, 345], [2, 678]]) });

const REGISTERS = [
  { sourceKey: "flow", table: "holding", address: 0, type: "uint16" },
  { sourceKey: "press", table: "holding", address: 1, type: "uint16", scale: 0.1 },
  { sourceKey: "temp", table: "holding", address: 2, type: "uint16" },
];

/** One Modbus RTU with two mapped points (flow, press); `temp` is in the profile but mapped to nothing. */
function rows(port: number): BindingRow[] {
  const base = {
    rtu_id: "rtu-mb1",
    rtu_code: "MB-1",
    source_type: "catalog",
    config_protocol: "modbus_tcp",
    telemetry_source: "catalog",
    connection_config: { host: "127.0.0.1", port, pollIntervalMs: 1_000, device: { unitId: 1, registers: REGISTERS } },
  };
  return [
    row({ ...base, point_key: "FLOW_RATE", source_data_key: "flow" }),
    row({ ...base, point_key: "PRESSURE", source_data_key: "press" }),
  ];
}

function run(factory: IngestAdapterFactory, plan: EndpointPlan) {
  const batches: ReceivedSample[][] = [];
  const supervisor: Supervisor = createSupervisor({
    factory,
    plan,
    logger: silentLogger,
    buffer: makeMemoryBuffer(),
    scheduler: realScheduler,
    random: () => 0.5,
    writeSamples: async (samples) => {
      batches.push([...samples]);
    },
  });
  supervisor.start();
  return { supervisor, batches };
}

const valuesOf = (batch: readonly ReceivedSample[]) =>
  Object.fromEntries(batch.map((r) => [r.sample.sourceKey, r.sample.value]));

export async function assertTheCloudWiringReadsTheMappedPoints(): Promise<void> {
  const server = await startModbusTestServer(new Map([[1, IMAGE()]]));
  const planned = planEndpoints(rows(server.port), {
    ...makeOptions({ lookup: lookupAdapter }),
    modbusTcpHosts: parseModbusTcpHosts("127.0.0.1"),
  });
  expect(planned.skipped).toEqual([]);
  const plan = planned.endpoints[0] as EndpointPlan;
  expect(plan.pollIntervalMs).toBe(1_000);
  const { supervisor, batches } = run(lookupAdapter("modbus_tcp") as IngestAdapterFactory, plan);
  try {
    await until(() => batches.some((b) => b.length > 0), "a first Modbus batch");
    const batch = batches.find((b) => b.length > 0) as ReceivedSample[];
    expect(valuesOf(batch)).toEqual({ flow: 120, press: 34.5 });
    const resolved = resolveSamples(batch, plan.pointIndex);
    expect(resolved.rows).toHaveLength(2);
    expect(resolved.counters.unmappedSourceKey).toBe(0);
  } finally {
    await supervisor.stop();
    await server.close();
  }
}

export async function assertTheEdgeWiringReadsEveryRegister(): Promise<void> {
  const server = await startModbusTestServer(new Map([[1, IMAGE()]]));
  const text = JSON.stringify({
    endpoints: [
      {
        protocol: "modbus_tcp",
        config: { host: "127.0.0.1", port: server.port, pollIntervalMs: 1_000 },
        devices: [{ deviceKey: "MB-1", device: { unitId: 1, registers: REGISTERS } }],
      },
    ],
  });
  const [entry] = planEdgeEndpoints(
    parseEdgeConfigFile(text, { env: {}, lookup: lookupAdapter, mqttPlaintextHosts: new Set() }),
  );
  if (entry === undefined) throw new Error("no edge plan");
  expect(entry.plan.pollIntervalMs).toBe(1_000);
  const { supervisor, batches } = run(entry.factory, entry.plan);
  try {
    await until(() => batches.some((b) => b.length > 0), "a first edge batch");
    expect(valuesOf(batches.find((b) => b.length > 0) as ReceivedSample[])).toEqual({ flow: 120, press: 34.5, temp: 678 });
  } finally {
    await supervisor.stop();
    await server.close();
  }
}

export async function assertALostServerIsReconnected(): Promise<void> {
  let server: ModbusTestServer = await startModbusTestServer(new Map([[1, IMAGE()]]));
  const port = server.port;
  const planned = planEndpoints(rows(port), {
    ...makeOptions({ lookup: lookupAdapter }),
    modbusTcpHosts: parseModbusTcpHosts("127.0.0.1"),
  });
  const { supervisor, batches } = run(lookupAdapter("modbus_tcp") as IngestAdapterFactory, planned.endpoints[0] as EndpointPlan);
  try {
    await until(() => batches.length > 0, "a first batch");
    await server.close();
    await until(() => supervisor.health().state === "disconnected", "the endpoint to read disconnected");
    server = await startModbusTestServer(new Map([[1, { holding: new Map([[0, 999], [1, 1], [2, 2]]) }]]), { port });
    await until(
      () => batches.some((b) => b.some((r) => r.sample.sourceKey === "flow" && r.sample.value === 999)),
      "reads to resume from the restarted server",
    );
    // The restart went through the supervisor's backoff path (P10), not a new process.
    expect(supervisor.health().restarts).toBeGreaterThanOrEqual(1);
    expect(supervisor.health().state).toBe("connected");
  } finally {
    await supervisor.stop();
    await server.close();
  }
}
