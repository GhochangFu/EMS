import {
  decodeRegisterValue,
  MODBUS_TYPE_WORDS,
  modbusConfigSchema,
  modbusDeviceSchema,
  type ModbusConfig,
  type ModbusDevice,
  type ModbusReadReply,
  type AdapterHealth,
  type SourceSample,
} from "@bms/shared/ingest";

import type { AdapterContext, IngestAdapterFactory, PollIngestAdapter } from "../adapter/types.js";
import { planModbusReads, type ModbusReadBlock, type ModbusReadEntry } from "./modbus-read-plan.js";
import {
  openModbusTransport,
  realDeadline,
  realDelay,
  realSocketFactory,
  ModbusTimeoutError,
  ModbusTransportClosedError,
  type ModbusDeadline,
  type ModbusDelay,
  type ModbusSocketFactory,
  type ModbusTransport,
} from "./modbus-transport.js";

/**
 * The read-only Modbus TCP poll adapter (ADR 0141; `F1.2` plan C4–C6, T4.3).
 *
 * One instance per endpoint (`modbus_tcp://host:port`, decision 5): every RTU
 * behind one gateway shares one socket, and each binding is one Modbus unit
 * (decision 6). `poll()` reads every binding's planned blocks in order through
 * the sequential transport and returns one sample per planned register:
 *
 * - `value = raw × scale + offset` (decision 7), `good: true`;
 * - a block answered with an exception, timed out or malformed: every sample
 *   of that block is `{ value: 0, good: false }`, and the poll continues with
 *   the next block (decision 9, Amendment 1 (b)). The `0` is a placeholder;
 *   under the default `discard_bad` the host drops and counts it;
 * - a 64-bit value past `Number.MAX_SAFE_INTEGER` or a non-finite float:
 *   `{ value: 0, good: false }`, never rounded;
 * - a lost socket: `poll()` rejects and `health()` reads `disconnected`, so the
 *   host restarts the adapter through its backoff (ADR 0016 Amendment 10 (c)).
 *
 * No sample carries `at` (the host stamps receive time, ADR 0061). No
 * credential is read (decision 11). The adapter owns no timer: the host sleeps
 * between polls, and the transport's deadline is one-shot per request.
 */

/** Decision 10: the adapter's own interval, the last fallback after the endpoint's and the organization's. */
export const MODBUS_DEFAULT_POLL_INTERVAL_MS = 10_000;

export type ModbusAdapterDeps = {
  readonly socketFactory: ModbusSocketFactory;
  readonly deadline: ModbusDeadline;
  readonly delay: ModbusDelay;
};

const REAL_DEPS: ModbusAdapterDeps = { socketFactory: realSocketFactory, deadline: realDeadline, delay: realDelay };

/** One binding's read plan: its unit and its blocks. */
type DevicePlan = {
  readonly deviceKey: string;
  readonly unitId: number;
  readonly blocks: readonly ModbusReadBlock[];
};

/** Fixed reasons only: a block failure logs no bytes, host or value. */
function failureReason(error: unknown, reply?: ModbusReadReply): string {
  if (reply?.kind === "exception") {
    return `exception-${reply.exceptionCode}`;
  }
  return error instanceof ModbusTimeoutError ? "timeout" : "malformed-reply";
}

function sampleOf(deviceKey: string, entry: ModbusReadEntry, reply: ModbusReadReply): SourceSample {
  const { register, offset } = entry;
  let raw: { value: number; inRange: boolean };
  if (reply.kind === "bits") {
    const bit = reply.bits[offset];
    raw = bit === undefined ? { value: 0, inRange: false } : { value: bit ? 1 : 0, inRange: true };
  } else if (reply.kind === "registers") {
    const words = reply.registers.slice(offset, offset + MODBUS_TYPE_WORDS[register.type]);
    raw =
      words.length < MODBUS_TYPE_WORDS[register.type]
        ? { value: 0, inRange: false }
        : decodeRegisterValue(words, register);
  } else {
    raw = { value: 0, inRange: false };
  }
  if (!raw.inRange) {
    return { deviceKey, sourceKey: register.sourceKey, value: 0, good: false };
  }
  const value = raw.value * register.scale + register.offset;
  return Number.isFinite(value)
    ? { deviceKey, sourceKey: register.sourceKey, value, good: true }
    : { deviceKey, sourceKey: register.sourceKey, value: 0, good: false };
}

export function createModbusTcpAdapter(deps: ModbusAdapterDeps = REAL_DEPS): PollIngestAdapter<ModbusConfig, ModbusDevice> {
  let transport: ModbusTransport | undefined;
  let context: AdapterContext<ModbusConfig, ModbusDevice> | undefined;
  let plans: readonly DevicePlan[] = [];
  let health: AdapterHealth = { state: "disconnected" };
  /** Blocks that failed on the last poll, so a failure and a recovery each log once. */
  const failing = new Set<string>();

  const lost = (): never => {
    health = { state: "disconnected", detail: "connection closed" };
    throw new ModbusTransportClosedError();
  };

  return {
    mode: "poll",
    defaultPollIntervalMs: MODBUS_DEFAULT_POLL_INTERVAL_MS,

    async connect(ctx) {
      context = ctx;
      health = { state: "disconnected" };
      plans = ctx.bindings.map((binding) => ({
        deviceKey: binding.deviceKey,
        unitId: binding.device.unitId,
        blocks: planModbusReads(binding.device.registers, binding.sourceKeys),
      }));
      transport = await openModbusTransport({
        host: ctx.config.host,
        port: ctx.config.port,
        timeoutMs: ctx.config.timeoutMs,
        interRequestDelayMs: ctx.config.interRequestDelayMs,
        signal: ctx.signal,
        ...deps,
      });
      health = { state: "connected" };
    },

    async poll() {
      if (transport === undefined || transport.closed) {
        return lost();
      }
      const samples: SourceSample[] = [];
      for (const plan of plans) {
        for (const block of plan.blocks) {
          const key = `${plan.deviceKey}\u0000${block.table}\u0000${block.address}`;
          let reply: ModbusReadReply | undefined;
          let error: unknown;
          try {
            reply = await transport.request(plan.unitId, {
              functionCode: block.functionCode,
              address: block.address,
              quantity: block.quantity,
            });
          } catch (caught) {
            if (caught instanceof ModbusTransportClosedError || transport.closed) {
              return lost();
            }
            error = caught;
          }
          if (reply === undefined || reply.kind === "exception") {
            if (!failing.has(key)) {
              failing.add(key);
              context?.logger.warn("modbus block failed", {
                deviceKey: plan.deviceKey,
                table: block.table,
                address: block.address,
                quantity: block.quantity,
                reason: failureReason(error, reply),
              });
            }
            for (const entry of block.entries) {
              samples.push({ deviceKey: plan.deviceKey, sourceKey: entry.register.sourceKey, value: 0, good: false });
            }
            continue;
          }
          if (failing.delete(key)) {
            context?.logger.info("modbus block recovered", {
              deviceKey: plan.deviceKey,
              table: block.table,
              address: block.address,
            });
          }
          for (const entry of block.entries) {
            samples.push(sampleOf(plan.deviceKey, entry, reply));
          }
        }
      }
      return samples;
    },

    async disconnect() {
      transport?.close();
      transport = undefined;
      health = { state: "disconnected" };
    },

    health: () => health,
  };
}

/** `modbus_tcp://host:port`; an IPv6 literal in brackets. Every RTU behind one gateway shares it. */
function endpointKeyOf(config: ModbusConfig): string {
  const host = config.host.includes(":") ? `[${config.host}]` : config.host;
  return `modbus_tcp://${host}:${config.port}`;
}

export const modbusTcpAdapterFactory: IngestAdapterFactory<ModbusConfig, ModbusDevice> = {
  protocol: "modbus_tcp",
  mode: "poll",
  configSchema: modbusConfigSchema,
  deviceSchema: modbusDeviceSchema,
  endpointKey: (config) => endpointKeyOf(config),
  supportsDiscovery: false,
  create: () => createModbusTcpAdapter(),
};

export default modbusTcpAdapterFactory;
