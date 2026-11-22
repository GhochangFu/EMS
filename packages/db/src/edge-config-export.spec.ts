import { expect } from "vitest";

import { edgeConfigFileSchema, modbusConfigSchema, modbusDeviceSchema } from "@bms/shared";

import {
  buildEdgeConfigExport,
  EDGE_EXPORT_MODBUS_DEFAULT_POLL_INTERVAL_MS,
  parseEdgeExportArgs,
  type EdgeExportRtu,
} from "./edge-config-export";

/**
 * `F1.2` (ADR 0141 decision 17, Amendment 1 (d); plan T7.5, builder call C14) — the edge export:
 * a gateway's Modbus RTUs as an `EDGE_CONFIG_FILE`. Pure: no database. The sibling `.test.ts`
 * carries the `it()`s; `tests/f1.2-edge-export-loads-on-the-edge.test.ts` feeds the output to the
 * edge host's own loader.
 */

function registers(keys: readonly string[]) {
  return keys.map((sourceKey, i) => ({
    sourceKey,
    table: "input",
    address: i * 2,
    type: "float32",
    wordOrder: "big",
    byteSwap: false,
    scale: 1,
    offset: 0,
  }));
}

const KEYS = ["kw", "kvar", "kwh_total"];

function modbusRtu(code: string, overrides: Partial<EdgeExportRtu> = {}, config: Record<string, unknown> = {}): EdgeExportRtu {
  return {
    code,
    rtuCode: `DEV-${code}`,
    active: true,
    ingestEnabled: true,
    protocol: "modbus_tcp",
    config: {
      host: "10.0.0.5",
      port: 502,
      device: { unitId: 1, profile: { code: "selec-mfm384", version: 2 }, registers: registers(KEYS) },
      ...config,
    },
    mappedSourceKeys: KEYS,
    ...overrides,
  };
}

/** E1 — the file parses through `edgeConfigFileSchema` and every slice through the adapter's strict schemas. */
export function runTheFileParsesThroughEverySchema(): void {
  const { file } = buildEdgeConfigExport({
    organizationDefaultPollIntervalMs: null,
    rtus: [modbusRtu("A", {}, { timeoutMs: 2000, pollIntervalMs: 30_000 })],
  });
  expect(file).not.toBeNull();
  expect(edgeConfigFileSchema.safeParse(file).success).toBe(true);
  for (const endpoint of file!.endpoints) {
    expect(endpoint.protocol).toBe("modbus_tcp");
    const { pollIntervalMs: _host, ...connection } = endpoint.config;
    expect(modbusConfigSchema.safeParse(connection).success).toBe(true);
    for (const device of endpoint.devices) {
      expect(modbusDeviceSchema.safeParse(device.device).success).toBe(true);
    }
  }
  expect(file!.endpoints[0]!.config).toEqual({ host: "10.0.0.5", port: 502, timeoutMs: 2000, interRequestDelayMs: 0, pollIntervalMs: 30_000 });
}

/** E2 — RTUs on one `host:port` share one endpoint (case-insensitive host); another port is another endpoint. */
export function runOneEndpointPerHostAndPort(): void {
  const { file } = buildEdgeConfigExport({
    organizationDefaultPollIntervalMs: null,
    rtus: [
      modbusRtu("A"),
      modbusRtu("B", {}, { host: "10.0.0.5", device: { unitId: 2, registers: registers(KEYS) } }),
      modbusRtu("C", {}, { host: "GW.SITE.LOCAL", port: 5020, device: { unitId: 3, registers: registers(KEYS) } }),
      modbusRtu("D", {}, { host: "10.0.0.5", port: 5020, device: { unitId: 4, registers: registers(KEYS) } }),
    ],
  });
  expect(file!.endpoints.map((e) => [e.config.host, e.config.port, e.devices.map((d) => d.deviceKey)])).toEqual([
    ["10.0.0.5", 502, ["DEV-A", "DEV-B"]],
    ["10.0.0.5", 5020, ["DEV-D"]],
    ["gw.site.local", 5020, ["DEV-C"]],
  ]);
}

/**
 * E3 — `pollIntervalMs` is the resolved value (decision 10, ruling P9, Amendment 2 (c)): the
 * endpoint's own, else the organization default; the shortest on a shared endpoint; when one RTU
 * falls through to the adapter default, no longer than that default; and no key when every RTU
 * does.
 */
export function runTheIntervalIsTheResolvedValue(): void {
  const interval = (defaultMs: number | null, rtus: EdgeExportRtu[]) =>
    buildEdgeConfigExport({ organizationDefaultPollIntervalMs: defaultMs, rtus }).file!.endpoints[0]!.config.pollIntervalMs;
  const own = (code: string, ms: number) => modbusRtu(code, {}, { pollIntervalMs: ms, device: { unitId: code.charCodeAt(0), registers: registers(KEYS) } });
  const bare = (code: string) => modbusRtu(code, {}, { device: { unitId: code.charCodeAt(0), registers: registers(KEYS) } });
  expect(interval(null, [own("A", 30_000)])).toBe(30_000);
  expect(interval(60_000, [bare("A")])).toBe(60_000);
  expect(interval(60_000, [own("A", 30_000), bare("B")])).toBe(30_000);
  expect(interval(null, [own("A", 30_000), own("B", 15_000)])).toBe(15_000);
  expect(interval(null, [own("A", 30_000), bare("B")])).toBe(EDGE_EXPORT_MODBUS_DEFAULT_POLL_INTERVAL_MS);
  expect(interval(null, [own("A", 5_000), bare("B")])).toBe(5_000);
  expect(interval(null, [bare("A")])).toBeUndefined();
  // An out-of-bound stored value is not exported as is: the next level down applies (decision 10).
  expect(interval(60_000, [own("A", 999)])).toBe(60_000);
}

/** E4 — no `sourceKeys` key is written; only mapped registers are; the rest are listed by `sourceKey`. */
export function runOnlyMappedRegistersAndNoSourceKeys(): void {
  const result = buildEdgeConfigExport({
    organizationDefaultPollIntervalMs: null,
    rtus: [modbusRtu("A", { mappedSourceKeys: ["kwh_total", "kw", "not_a_register"] })],
  });
  const device = result.file!.endpoints[0]!.devices[0]!;
  expect(Object.keys(device).sort()).toEqual(["device", "deviceKey"]);
  expect(JSON.stringify(result.file)).not.toContain("sourceKeys");
  expect((device.device as { registers: { sourceKey: string }[] }).registers.map((r) => r.sourceKey)).toEqual([
    "kw",
    "kwh_total",
  ]);
  expect(device.device).toMatchObject({ unitId: 1, profile: { code: "selec-mfm384", version: 2 } });
  expect(result.omittedRegisters).toEqual([{ code: "A", sourceKeys: ["kvar"] }]);
}

/** E5 — an RTU the file cannot carry is listed with its reason: MQTT, unbound, no device key, inactive, nothing mapped, bad config. */
export function runAnRtuNotExportedIsListed(): void {
  const result = buildEdgeConfigExport({
    organizationDefaultPollIntervalMs: null,
    rtus: [
      modbusRtu("OK"),
      { ...modbusRtu("MQ"), protocol: "mqtt", config: { host: "broker", port: 8883 } },
      { ...modbusRtu("NOCONF"), protocol: null, config: null },
      modbusRtu("UNBOUND", {}, { device: { unitId: 1 } }),
      modbusRtu("NOKEY", { rtuCode: null }),
      modbusRtu("OFF", { active: false }),
      modbusRtu("PAUSED", { ingestEnabled: false }),
      modbusRtu("UNMAPPED", { mappedSourceKeys: [] }),
      modbusRtu("BAD", {}, { host: "meter:502" }),
    ],
  });
  expect(result.file!.endpoints.flatMap((e) => e.devices.map((d) => d.deviceKey))).toEqual(["DEV-OK"]);
  expect(result.notExported).toEqual([
    { code: "BAD", reason: "the stored Modbus connection does not parse" },
    { code: "MQ", reason: "protocol mqtt is not exported (Modbus TCP only)" },
    { code: "NOCONF", reason: "no connection config" },
    { code: "NOKEY", reason: "no device ID (rtu_code)" },
    { code: "OFF", reason: "inactive" },
    { code: "PAUSED", reason: "ingest is off for this RTU" },
    { code: "UNBOUND", reason: "not bound to a device profile (no registers)" },
    { code: "UNMAPPED", reason: "no register is mapped to an active point" },
  ]);
}

/** E6 — a gateway with nothing to export yields no file (the file needs one endpoint). */
export function runNothingToExportIsNoFile(): void {
  const result = buildEdgeConfigExport({
    organizationDefaultPollIntervalMs: null,
    rtus: [{ ...modbusRtu("MQ"), protocol: "mqtt", config: {} }],
  });
  expect(result.file).toBeNull();
  expect(result.notExported).toHaveLength(1);
}

/** E7 — the CLI takes `--organization <code> --gateway <code>` and an optional `--out <file>`; anything else is refused. */
export function runTheArgumentsAreStrict(): void {
  expect(parseEdgeExportArgs(["--organization", "ION", "--gateway", "GW-1"])).toEqual({
    ok: true,
    organization: "ION",
    gateway: "GW-1",
    out: null,
  });
  expect(parseEdgeExportArgs(["--gateway", "GW-1", "--organization", "ION", "--out", "edge.json"])).toMatchObject({
    ok: true,
    out: "edge.json",
  });
  for (const bad of [[], ["--organization", "ION"], ["--organization", "--gateway", "GW"], ["--organization", "ION", "--gateway", "GW", "--x", "1"], ["ION", "GW"]]) {
    expect(parseEdgeExportArgs(bad).ok, bad.join(" ")).toBe(false);
  }
}
