import { MODBUS_DEFAULT_POLL_INTERVAL_MS, modbusConfigSchema, modbusDeviceSchema, pollIntervalMsSchema } from "@bms/shared";
import type { EdgeConfigFile, EdgeEndpointEntry, ModbusDevice } from "@bms/shared";

/**
 * `F1.2` (ADR 0141 decision 17, Amendment 1 (d); plan T7.5, builder call C14) — an edge box's
 * `EDGE_CONFIG_FILE` (ADR 0123 decision 3) from the rows the product holds: the Modbus TCP RTUs
 * assigned to one edge gateway. Pure; `edge-config-export-cli.ts` reads the rows and writes the
 * file.
 *
 * - **One endpoint per `host:port`** (decision 5): every RTU behind one gateway shares one socket.
 *   The first RTU's connection slice (by `code`) is the endpoint's, as the cloud host keeps the
 *   first row's (plan M8).
 * - **The resolved interval** in each endpoint's `pollIntervalMs` (decision 10): the edge has no
 *   database, so `config.pollIntervalMs ?? organizations.default_poll_interval_ms` is written out,
 *   the shortest on a shared endpoint (ruling P9). When one RTU on it falls through to the adapter
 *   default, the endpoint is read no slower than that default (ADR 0141 Amendment 2 (c)); when every
 *   RTU does, no key is written and the edge uses the adapter's own.
 * - **Mapped registers only** (Amendment 1 (d)): a device carries the registers whose `sourceKey`
 *   an active measured point of that RTU maps, so the cloud receiver does not count the rest as
 *   unmapped on every batch. The ones left out are listed by `sourceKey`. **No `sourceKeys` key**
 *   is written (decision 17): the register list already names every key the device reads.
 * - Every RTU the file cannot carry is listed with its reason, never dropped silently.
 */

/**
 * The Modbus adapter's own default interval (ADR 0141 decision 10), needed when one RTU on an
 * endpoint falls through to it: an edge file that sets `pollIntervalMs` disables the default. The
 * shared constant the adapter itself uses (`@bms/shared`, since PR 7's review);
 * `tests/f1.2-edge-export-loads-on-the-edge.test.ts` still holds the two equal.
 */
export const EDGE_EXPORT_MODBUS_DEFAULT_POLL_INTERVAL_MS = MODBUS_DEFAULT_POLL_INTERVAL_MS;

/** One RTU assigned to the gateway, as the CLI reads it. */
export type EdgeExportRtu = {
  readonly code: string;
  /** The device key on the wire (`bms.rtus.rtu_code`). */
  readonly rtuCode: string | null;
  readonly active: boolean;
  readonly ingestEnabled: boolean;
  /** `rtu_connection_configs.protocol`, `null` when the RTU has no connection row. */
  readonly protocol: string | null;
  readonly config: unknown;
  /** The `source_data_key`s of the RTU's active measured points. */
  readonly mappedSourceKeys: readonly string[];
};

/** What the export reads for one gateway: its organization's default interval and its RTUs. */
export type EdgeExportInput = {
  readonly organizationDefaultPollIntervalMs: number | null;
  readonly rtus: readonly EdgeExportRtu[];
};

/** The file (or `null`), every RTU left out with its reason, and every register left out by `sourceKey`. */
export type EdgeExportResult = {
  /** `null` when nothing can be exported (the file needs at least one endpoint). */
  readonly file: EdgeConfigFile | null;
  readonly notExported: readonly { readonly code: string; readonly reason: string }[];
  readonly omittedRegisters: readonly { readonly code: string; readonly sourceKeys: readonly string[] }[];
};

type Planned = {
  readonly key: string;
  readonly connection: Record<string, unknown>;
  readonly devices: { deviceKey: string; device: ModbusDevice }[];
  readonly intervals: (number | null)[];
};

function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** The decision-10 value for one RTU: its own if in bounds, else the organization's, else `null`. */
function resolvedInterval(stored: unknown, organizationDefault: number | null): number | null {
  const own = pollIntervalMsSchema.safeParse(stored);
  if (own.success) {
    return own.data;
  }
  const org = pollIntervalMsSchema.safeParse(organizationDefault);
  return org.success ? org.data : null;
}

/** P9 and Amendment 2 (c): the shortest set value, no longer than the default when an RTU uses it. */
function endpointInterval(intervals: readonly (number | null)[]): number | null {
  const set = intervals.filter((value): value is number => value !== null);
  if (set.length === 0) {
    return null;
  }
  const shortest = Math.min(...set);
  return set.length < intervals.length ? Math.min(shortest, EDGE_EXPORT_MODBUS_DEFAULT_POLL_INTERVAL_MS) : shortest;
}

/** Builds a gateway's `EDGE_CONFIG_FILE` from its RTUs (the rules are in the module comment above). */
export function buildEdgeConfigExport(input: EdgeExportInput): EdgeExportResult {
  const notExported: { code: string; reason: string }[] = [];
  const omittedRegisters: { code: string; sourceKeys: string[] }[] = [];
  const endpoints = new Map<string, Planned>();

  for (const rtu of [...input.rtus].sort((a, b) => a.code.localeCompare(b.code))) {
    const refuse = (reason: string): void => {
      notExported.push({ code: rtu.code, reason });
    };
    if (rtu.protocol === null) {
      refuse("no connection config");
      continue;
    }
    if (rtu.protocol !== "modbus_tcp") {
      refuse(`protocol ${rtu.protocol} is not exported (Modbus TCP only)`);
      continue;
    }
    if (!rtu.active) {
      refuse("inactive");
      continue;
    }
    if (!rtu.ingestEnabled) {
      refuse("ingest is off for this RTU");
      continue;
    }
    if (rtu.rtuCode === null || rtu.rtuCode.trim() === "") {
      refuse("no device ID (rtu_code)");
      continue;
    }
    const stored = recordOf(rtu.config) ?? {};
    const { device: storedDevice, pollIntervalMs: storedInterval, ...storedConnection } = stored;
    const connection = modbusConfigSchema.safeParse(storedConnection);
    if (!connection.success) {
      refuse("the stored Modbus connection does not parse");
      continue;
    }
    if (recordOf(storedDevice)?.registers === undefined) {
      refuse("not bound to a device profile (no registers)");
      continue;
    }
    const device = modbusDeviceSchema.safeParse(storedDevice);
    if (!device.success) {
      refuse("the stored Modbus device does not parse");
      continue;
    }
    const mapped = new Set(rtu.mappedSourceKeys);
    const kept = device.data.registers.filter((register) => mapped.has(register.sourceKey));
    const left = device.data.registers.filter((register) => !mapped.has(register.sourceKey)).map((r) => r.sourceKey);
    if (kept.length === 0) {
      refuse("no register is mapped to an active point");
      continue;
    }
    if (left.length > 0) {
      omittedRegisters.push({ code: rtu.code, sourceKeys: left });
    }

    const key = `${connection.data.host}:${connection.data.port}`;
    const planned = endpoints.get(key) ?? { key, connection: { ...connection.data }, devices: [], intervals: [] };
    planned.devices.push({ deviceKey: rtu.rtuCode, device: { ...device.data, registers: kept } });
    planned.intervals.push(resolvedInterval(storedInterval, input.organizationDefaultPollIntervalMs));
    endpoints.set(key, planned);
  }

  const entries: EdgeEndpointEntry[] = [...endpoints.values()]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((planned) => {
      const interval = endpointInterval(planned.intervals);
      return {
        protocol: "modbus_tcp",
        config: interval === null ? planned.connection : { ...planned.connection, pollIntervalMs: interval },
        devices: planned.devices
          .sort((a, b) => a.deviceKey.localeCompare(b.deviceKey))
          .map(({ deviceKey, device }) => ({ deviceKey, device })),
      };
    });

  return { file: entries.length === 0 ? null : { endpoints: entries }, notExported, omittedRegisters };
}

/** The parsed CLI arguments, or the usage line to print. */
export type EdgeExportArgs =
  | {
      readonly ok: true;
      readonly organization: string;
      readonly gateway: string;
      readonly out: string | null;
      readonly force: boolean;
    }
  | { readonly ok: false; readonly message: string };

/** The CLI's usage line, printed for any argument it refuses. */
export const EDGE_EXPORT_USAGE =
  "usage: edge-config-export --organization <organization code> --gateway <edge gateway code> [--out <file> [--force]]" +
  " (--out writes the file owner-only and refuses an existing one unless --force)";

/** `--organization <code> --gateway <code> [--out <file>] [--force]`, in any order; anything else is refused. */
export function parseEdgeExportArgs(argv: readonly string[]): EdgeExportArgs {
  const values: Record<string, string> = {};
  const rest = argv.filter((arg) => arg !== "--force");
  const forces = argv.length - rest.length;
  if (forces > 1) {
    return { ok: false, message: EDGE_EXPORT_USAGE };
  }
  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i];
    const value = rest[i + 1];
    if (
      flag === undefined ||
      !["--organization", "--gateway", "--out"].includes(flag) ||
      value === undefined ||
      value.startsWith("--") ||
      flag in values
    ) {
      return { ok: false, message: EDGE_EXPORT_USAGE };
    }
    values[flag] = value;
  }
  const organization = values["--organization"];
  const gateway = values["--gateway"];
  if (!organization || !gateway) {
    return { ok: false, message: EDGE_EXPORT_USAGE };
  }
  return { ok: true, organization, gateway, out: values["--out"] ?? null, force: forces === 1 };
}

/**
 * PR 7 security review L4 — how `--out` writes: owner-only (`0600`; the file names the site's meter
 * addresses), and `wx`, so an existing file is never overwritten unless `--force` was given.
 */
export function edgeExportWriteOptions(force: boolean): { readonly mode: number; readonly flag: "w" | "wx" } {
  return { mode: 0o600, flag: force ? "w" : "wx" };
}
