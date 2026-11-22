import { describe, expect, it } from "vitest";

import { lookupAdapter } from "../apps/ingest/src/adapter/registry.js";
import { MODBUS_DEFAULT_POLL_INTERVAL_MS } from "../apps/ingest/src/adapters/modbus-tcp.js";
import { parseEdgeConfigFile } from "../apps/ingest/src/host/edge-config.js";
import {
  buildEdgeConfigExport,
  EDGE_EXPORT_MODBUS_DEFAULT_POLL_INTERVAL_MS,
  type EdgeExportRtu,
} from "../packages/db/src/edge-config-export";

/**
 * `F1.2` (ADR 0141 decision 17, plan T7.5) — the edge export's file, read by the edge host's own
 * loader (`parseEdgeConfigFile`, with the real adapter registry): what the export writes is what an
 * edge box accepts, through the Modbus adapter's own `configSchema` and `deviceSchema`. And the
 * export's copy of the adapter default (it cannot import `apps/ingest`) is held equal to the
 * adapter's. Assertions inline (§4.6 carves out `tests/`).
 */

const REGISTERS = ["kw", "kwh_total"].map((sourceKey, i) => ({
  sourceKey,
  table: "holding",
  address: i * 2,
  type: "float32",
  wordOrder: "big",
  byteSwap: false,
  scale: 1,
  offset: 0,
}));

function rtu(code: string, unitId: number, config: Record<string, unknown> = {}): EdgeExportRtu {
  return {
    code,
    rtuCode: `EDGE-${code}`,
    active: true,
    ingestEnabled: true,
    protocol: "modbus_tcp",
    config: { host: "10.1.2.3", port: 502, device: { unitId, profile: { code: "selec-mfm384", version: 1 }, registers: REGISTERS }, ...config },
    mappedSourceKeys: ["kw", "kwh_total"],
  };
}

describe("F1.2 — the edge export loads on the edge host", () => {
  it("is accepted by the edge loader with the real registry, one endpoint, the resolved interval", () => {
    const { file } = buildEdgeConfigExport({
      organizationDefaultPollIntervalMs: 60_000,
      rtus: [rtu("A", 1, { pollIntervalMs: 20_000 }), rtu("B", 2)],
    });
    expect(file).not.toBeNull();
    const endpoints = parseEdgeConfigFile(JSON.stringify(file), {
      env: {},
      lookup: lookupAdapter,
      mqttPlaintextHosts: new Set(),
    });
    expect(endpoints).toHaveLength(1);
    expect(endpoints[0]!.protocol).toBe("modbus_tcp");
    expect(endpoints[0]!.pollIntervalMs).toBe(20_000);
    expect(endpoints[0]!.devices.map((device) => device.deviceKey)).toEqual(["EDGE-A", "EDGE-B"]);
  });

  it("holds the export's adapter default equal to the Modbus adapter's", () => {
    expect(EDGE_EXPORT_MODBUS_DEFAULT_POLL_INTERVAL_MS).toBe(MODBUS_DEFAULT_POLL_INTERVAL_MS);
  });
});
