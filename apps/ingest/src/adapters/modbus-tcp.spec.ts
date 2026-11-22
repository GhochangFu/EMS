import { decodeAdu, serveModbusFrame, type ModbusImage, type SourceSample } from "@bms/shared/ingest";
import { expect } from "vitest";

import type { AdapterContractFixtures } from "../adapter/adapter-contract.spec.js";
import { CREDENTIAL_SENTINEL } from "../adapter/adapter-contract.spec.js";
import type { AdapterContext, AdapterLogger, RtuBinding } from "../adapter/types.js";
import { createModbusTcpAdapter, modbusTcpAdapterFactory, type ModbusAdapterDeps } from "./modbus-tcp.js";
import type { ModbusSocket } from "./modbus-transport.js";

/**
 * `F1.2` plan T4.3 / ADR 0141 decisions 5–9, 11, Amendment 1 (b) — the Modbus
 * TCP poll adapter over a fake transport. The fake socket answers each request
 * from a per-unit image through the shared codec's `serveModbusFrame`, so the
 * bytes on the wire are the real ones; a unit marked silent never answers, and
 * the injected deadline then fires.
 *
 * Assertions live here; `modbus-tcp.test.ts` is the vitest entry point.
 */

type Fake = {
  deps: ModbusAdapterDeps;
  images: Map<number, ModbusImage>;
  silentUnits: Set<number>;
  failConnect: boolean;
  written: Uint8Array[];
  lose(): void;
};

function fakeDeps(): Fake {
  let closeListener: (() => void) | undefined;
  let alive = false;
  const fake: Fake = {
    images: new Map(),
    silentUnits: new Set(),
    failConnect: false,
    written: [],
    lose: () => {
      if (alive) {
        alive = false;
        closeListener?.();
      }
    },
    deps: {
      socketFactory: async () => {
        if (fake.failConnect) {
          fake.failConnect = false;
          throw new Error("refused");
        }
        alive = true;
        let dataListener: ((chunk: Uint8Array) => void) | undefined;
        const socket: ModbusSocket = {
          write(frame) {
            fake.written.push(frame);
            const unitId = decodeAdu(frame).unitId;
            if (!alive || fake.silentUnits.has(unitId)) return;
            const reply = serveModbusFrame(frame, fake.images.get(unitId) ?? {});
            if (reply !== null) dataListener?.(reply);
          },
          onData(listener) {
            dataListener = listener;
          },
          onClose(listener) {
            closeListener = listener;
          },
          destroy() {
            fake.lose();
          },
        };
        return socket;
      },
      // Fires on the next turn: a served reply (synchronous in `write`) always wins.
      deadline: (_ms, expire) => {
        const handle = setImmediate(expire);
        return () => clearImmediate(handle);
      },
      delay: async () => undefined,
    },
  };
  return fake;
}

const register = (sourceKey: string, address: number, over: Record<string, unknown> = {}) => ({
  sourceKey,
  table: "holding",
  address,
  type: "uint16",
  ...over,
});

const CONFIG = { host: "10.0.0.5", port: 502 };

function logger(): { logger: AdapterLogger; lines: string[] } {
  const lines: string[] = [];
  const record = (level: string) => (message: string, fields?: Record<string, unknown>) => {
    lines.push(`${level} ${message} ${JSON.stringify(fields ?? {})}`);
  };
  return { logger: { info: record("info"), warn: record("warn"), error: record("error") }, lines };
}

function binding(deviceKey: string, device: unknown, sourceKeys: readonly string[] = []): RtuBinding<never> {
  return {
    rtuId: `${deviceKey}-id`,
    rtuCode: deviceKey,
    deviceKey,
    device: modbusTcpAdapterFactory.deviceSchema.parse(device) as never,
    sourceKeys,
  };
}

async function connected(fake: Fake, bindings: readonly RtuBinding<never>[]) {
  const adapter = createModbusTcpAdapter(fake.deps);
  const log = logger();
  const context: AdapterContext<never, never> = {
    protocol: "modbus_tcp",
    endpointKey: "modbus_tcp://10.0.0.5:502",
    config: modbusTcpAdapterFactory.configSchema.parse(CONFIG) as never,
    credentials: { password: CREDENTIAL_SENTINEL },
    bindings,
    logger: log.logger,
    signal: new AbortController().signal,
  };
  await adapter.connect(context as never);
  return { adapter, lines: log.lines };
}

const byKey = (samples: readonly SourceSample[]) =>
  Object.fromEntries(samples.map((s) => [`${s.deviceKey}/${s.sourceKey}`, { value: s.value, good: s.good }]));

/** The suite's bindings carry sourceKeys flow, press, temp (`adapter-contract.spec.ts`). */
export const modbusContractFixtures: AdapterContractFixtures<unknown, unknown> = {
  registryKey: "modbus_tcp",
  validConfig: CONFIG,
  invalidConfig: { host: "meter:502" },
  validDevice: { unitId: 1, registers: [register("flow", 0), register("press", 1), register("temp", 2)] },
  secondDevice: { unitId: 2, registers: [register("flow", 0), register("press", 1)] },
  create() {
    const fake = fakeDeps();
    fake.images.set(1, { holding: new Map([[0, 10], [1, 20], [2, 30]]) });
    fake.images.set(2, { holding: new Map([[0, 40], [1, 50]]) });
    let failNext = false;
    return {
      adapter: createModbusTcpAdapter(fake.deps) as never,
      completeConnect: () => undefined,
      failNextConnect: () => {
        failNext = true;
        fake.failConnect = failNext;
      },
      loseTransport: () => fake.lose(),
    };
  },
};

export function assertTheFactoryShape(): void {
  expect(modbusTcpAdapterFactory.protocol).toBe("modbus_tcp");
  expect(modbusTcpAdapterFactory.mode).toBe("poll");
  expect(modbusTcpAdapterFactory.supportsDiscovery ?? false).toBe(false);
  const adapter = createModbusTcpAdapter(fakeDeps().deps);
  expect(adapter.mode === "poll" && adapter.defaultPollIntervalMs).toBe(10_000);
}

export function assertTheEndpointKeyIsHostAndPort(): void {
  const config = modbusTcpAdapterFactory.configSchema.parse({ host: "GW.Site", port: 1502 });
  expect(modbusTcpAdapterFactory.endpointKey(config, "rtu-a")).toBe("modbus_tcp://gw.site:1502");
  expect(modbusTcpAdapterFactory.endpointKey(config, "rtu-b")).toBe("modbus_tcp://gw.site:1502");
  const v6 = modbusTcpAdapterFactory.configSchema.parse({ host: "fe80::1" });
  expect(modbusTcpAdapterFactory.endpointKey(v6, "rtu-a")).toBe("modbus_tcp://[fe80::1]:502");
}

export async function assertValuesAreScaledAndCarryTheDeviceKeyAndNoTime(): Promise<void> {
  const fake = fakeDeps();
  fake.images.set(1, { holding: new Map([[0, 0x4366], [1, 0x8000], [2, 1234]]) });
  const { adapter } = await connected(fake, [
    binding("M1", {
      unitId: 1,
      registers: [
        register("kw", 0, { type: "float32" }),
        register("pf", 2, { scale: 0.5, offset: -100 }),
      ],
    }),
  ]);
  const samples = adapter.mode === "poll" ? await adapter.poll() : [];
  expect(byKey(samples)).toEqual({ "M1/kw": { value: 230.5, good: true }, "M1/pf": { value: 517, good: true } });
  for (const sample of samples) {
    expect(sample.deviceKey).toBe("M1");
    expect("at" in sample).toBe(false);
  }
}

export async function assertAnExceptionFailsOnlyItsBlock(): Promise<void> {
  const fake = fakeDeps();
  // Address 0 present, address 10 absent: the second block gets exception 02.
  fake.images.set(1, { holding: new Map([[0, 7], [20, 9]]) });
  const { adapter, lines } = await connected(fake, [
    binding("M1", { unitId: 1, registers: [register("a", 0), register("b", 10), register("c", 20)] }),
  ]);
  const samples = adapter.mode === "poll" ? await adapter.poll() : [];
  expect(byKey(samples)).toEqual({
    "M1/a": { value: 7, good: true },
    "M1/b": { value: 0, good: false },
    "M1/c": { value: 9, good: true },
  });
  expect(adapter.health().state).toBe("connected");
  expect(lines.filter((l) => l.includes("modbus block failed"))).toHaveLength(1);
  expect(lines.join("\n")).toContain('"reason":"exception-2"');
}

export async function assertATimeoutFailsOnlyItsUnit(): Promise<void> {
  const fake = fakeDeps();
  fake.images.set(1, { holding: new Map([[0, 1]]) });
  fake.images.set(2, { holding: new Map([[0, 2]]) });
  fake.silentUnits.add(2);
  const { adapter } = await connected(fake, [
    binding("M1", { unitId: 1, registers: [register("kw", 0)] }),
    binding("M2", { unitId: 2, registers: [register("kw", 0)] }),
    binding("M3", { unitId: 1, registers: [register("kw", 0)] }),
  ]);
  const samples = adapter.mode === "poll" ? await adapter.poll() : [];
  expect(byKey(samples)).toEqual({
    "M1/kw": { value: 1, good: true },
    "M2/kw": { value: 0, good: false },
    "M3/kw": { value: 1, good: true },
  });
}

export async function assertAnOutOfRangeValueIsNotGood(): Promise<void> {
  const fake = fakeDeps();
  fake.images.set(1, { holding: new Map([[0, 0x0020], [1, 0], [2, 0], [3, 0], [4, 0x7fc0], [5, 0]]) });
  const { adapter } = await connected(fake, [
    binding("M1", {
      unitId: 1,
      registers: [register("energy", 0, { type: "uint64" }), register("kw", 4, { type: "float32" })],
    }),
  ]);
  const samples = adapter.mode === "poll" ? await adapter.poll() : [];
  expect(byKey(samples)).toEqual({ "M1/energy": { value: 0, good: false }, "M1/kw": { value: 0, good: false } });
}

export async function assertOnlyMappedKeysAreRead(): Promise<void> {
  const fake = fakeDeps();
  fake.images.set(1, { holding: new Map([[0, 1], [5, 2]]) });
  const { adapter } = await connected(fake, [
    binding("M1", { unitId: 1, registers: [register("kw", 0), register("kvar", 5)] }, ["kw"]),
  ]);
  const samples = adapter.mode === "poll" ? await adapter.poll() : [];
  expect(byKey(samples)).toEqual({ "M1/kw": { value: 1, good: true } });
  expect(fake.written).toHaveLength(1);
}

export async function assertALostSocketRejectsAndReadsDisconnected(): Promise<void> {
  const fake = fakeDeps();
  fake.images.set(1, { holding: new Map([[0, 1]]) });
  const { adapter } = await connected(fake, [binding("M1", { unitId: 1, registers: [register("kw", 0)] })]);
  fake.lose();
  await expect(adapter.mode === "poll" ? adapter.poll() : Promise.resolve([])).rejects.toThrow();
  expect(adapter.health().state).toBe("disconnected");
  expect(adapter.health().detail).toBe("connection closed");
}

export async function assertBitsAreRead(): Promise<void> {
  const fake = fakeDeps();
  fake.images.set(1, { coil: new Map([[3, true], [4, false]]) });
  const { adapter } = await connected(fake, [
    binding("M1", {
      unitId: 1,
      registers: [register("trip", 3, { table: "coil", type: "bool" }), register("closed", 4, { table: "coil", type: "bool" })],
    }),
  ]);
  const samples = adapter.mode === "poll" ? await adapter.poll() : [];
  expect(byKey(samples)).toEqual({ "M1/trip": { value: 1, good: true }, "M1/closed": { value: 0, good: true } });
}

export async function assertARecoveredBlockLogsOnce(): Promise<void> {
  const fake = fakeDeps();
  fake.images.set(1, { holding: new Map() });
  const { adapter, lines } = await connected(fake, [binding("M1", { unitId: 1, registers: [register("kw", 0)] })]);
  if (adapter.mode !== "poll") return;
  await adapter.poll();
  await adapter.poll();
  fake.images.set(1, { holding: new Map([[0, 5]]) });
  await adapter.poll();
  await adapter.poll();
  expect(lines.filter((l) => l.includes("modbus block failed"))).toHaveLength(1);
  expect(lines.filter((l) => l.includes("modbus block recovered"))).toHaveLength(1);
  expect(lines.join("\n")).not.toMatch(/10\.0\.0\.5/);
}
