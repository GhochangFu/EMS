import { modbusConfigSchema, modbusDeviceSchema, modbusRegistersSchema } from "@bms/shared";
import type { ModbusRegister } from "@bms/shared";

/**
 * Thrown when a profile row's stored `registers` no longer parse. Every write path validates them
 * (ADR 0141 decision 13), so this is a stored-data defect, not a caller error: the service answers
 * 500 and logs the profile id.
 */
export class StoredProfileRegistersInvalidError extends Error {
  constructor() {
    super("the device profile's stored registers do not parse");
    this.name = "StoredProfileRegistersInvalidError";
  }
}

/** The connection half of a bind, already parsed by `setRtuModbusBodySchema` (host lower-cased). */
export type ModbusBindConnection = {
  readonly host: string;
  readonly port?: number;
  readonly timeoutMs?: number;
  readonly interRequestDelayMs?: number;
  readonly pollIntervalMs: number | null;
  readonly unitId: number;
};

/** The profile row's fields a bind copies. `registers` is the stored JSONB, unparsed. */
export type ModbusBindProfile = {
  readonly code: string;
  readonly version: number;
  readonly registers: unknown;
};

/** The Modbus TCP port (ADR 0141 decision 5), written out so the stored row says what is dialled. */
const MODBUS_DEFAULT_PORT = 502;

/**
 * `F1.2` (ADR 0141 decisions 5, 6, 10 and 15, plan T7.2) — the `rtu_connection_configs.config` a
 * bind stores: `{ host, port, timeoutMs?, interRequestDelayMs?, pollIntervalMs?, device: { unitId,
 * profile: { code, version }, registers } }`. The one register-copy path: the RTUs page bind uses
 * it, and plan PR 11's onboarding commit must reuse it rather than write a second (Amendment 1 (f)).
 *
 * - **Built fresh**, never merged over the stored row: the adapter's `configSchema` and
 *   `deviceSchema` are `.strict()`, so a legacy key (onboarding's flat top-level `unitId`, plan M7)
 *   left in place would make the host skip the RTU. Nothing else lives in a Modbus row's config.
 * - **The registers are re-parsed** through `modbusRegistersSchema` and the result is stored, so
 *   every default is written out and a row that no longer parses is refused here, not at the host.
 * - `pollIntervalMs: null` writes no key: the endpoint then inherits the organization default
 *   (decision 10). The host strips the key before the adapter's strict schema sees the rest.
 * - The result is checked against the adapter's own schemas before it is returned, so what the API
 *   stores is what the host accepts.
 */
export function buildModbusConnectionConfig(
  connection: ModbusBindConnection,
  profile: ModbusBindProfile,
): Record<string, unknown> {
  const registers = modbusRegistersSchema.safeParse(profile.registers);
  if (!registers.success) {
    throw new StoredProfileRegistersInvalidError();
  }
  const device = modbusDeviceSchema.parse({
    unitId: connection.unitId,
    profile: { code: profile.code, version: profile.version },
    registers: registers.data satisfies ModbusRegister[],
  });
  const slice: Record<string, unknown> = {
    host: connection.host,
    port: connection.port ?? MODBUS_DEFAULT_PORT,
  };
  if (connection.timeoutMs !== undefined) {
    slice.timeoutMs = connection.timeoutMs;
  }
  if (connection.interRequestDelayMs !== undefined) {
    slice.interRequestDelayMs = connection.interRequestDelayMs;
  }
  // The adapter's strict connection schema must accept everything but the host-owned interval.
  modbusConfigSchema.parse(slice);
  return {
    ...slice,
    ...(connection.pollIntervalMs === null ? {} : { pollIntervalMs: connection.pollIntervalMs }),
    device,
  };
}
