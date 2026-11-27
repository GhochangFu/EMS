import type { RtuModbusDto } from "@bms/shared";

/** The Modbus TCP port when a stored row names none (ADR 0141 decision 5). */
const MODBUS_DEFAULT_PORT = 502;

function recordOf(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function intOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

/**
 * `F1.2` (ADR 0141 decisions 5, 6 and 15, plan T7.1) — the admin RTU row's `modbus` field: what a
 * `modbus_tcp` connection row holds, summarised. `null` for no row and for any other protocol.
 *
 * Read **leniently**, the `connectionTlsOf` rule: the list must never 500 on one stored row, and a
 * row onboarding wrote before a bind has its `unitId` at the top level (the catalog's flat
 * `exampleConfig`, plan M7) and no `device` yet. A field of the wrong type reads as absent. The
 * register list never leaves the server here, only its length.
 */
export function connectionModbusOf(protocol: string | null, config: unknown): RtuModbusDto | null {
  if (protocol !== "modbus_tcp") {
    return null;
  }
  const stored = recordOf(config);
  const device = recordOf(stored.device);
  const profile = recordOf(device.profile);
  return {
    host: typeof stored.host === "string" ? stored.host : "",
    port: intOrNull(stored.port) ?? MODBUS_DEFAULT_PORT,
    unitId: intOrNull(device.unitId) ?? intOrNull(stored.unitId),
    timeoutMs: intOrNull(stored.timeoutMs),
    interRequestDelayMs: intOrNull(stored.interRequestDelayMs),
    pollIntervalMs: intOrNull(stored.pollIntervalMs),
    profile:
      typeof profile.code === "string" && intOrNull(profile.version) !== null
        ? { code: profile.code, version: profile.version as number }
        : null,
    registerCount: Array.isArray(device.registers) ? device.registers.length : 0,
  };
}
