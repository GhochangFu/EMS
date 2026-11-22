import { parseModbusTcpHosts } from "@bms/shared/ingest";
import { expect } from "vitest";

import { lookupAdapter } from "../adapter/registry.js";
import { planEndpoints, type BindingRow } from "./bindings.js";
import { makeOptions, row } from "./bindings.spec.js";

/**
 * `F1.2` / ADR 0141 Amendment 1 (e), decision 22 (ruling P6) — the cloud host
 * dials only a Modbus host listed in `MODBUS_TCP_HOSTS`. Planned with the real
 * registry, so the factory is the shipped `modbus_tcp` adapter.
 *
 * Assertions live here; `bindings-modbus-hosts.test.ts` is the vitest entry point.
 */

const modbusRow = (host: string): BindingRow =>
  row({
    rtu_id: `rtu-${host}`,
    rtu_code: `M-${host}`,
    source_type: "catalog",
    config_protocol: "modbus_tcp",
    telemetry_source: "catalog",
    connection_config: {
      host,
      port: 502,
      device: { unitId: 1, registers: [{ sourceKey: "flow", table: "holding", address: 0, type: "uint16" }] },
    },
  });

const plan = (rows: readonly BindingRow[], hosts: string | undefined) =>
  planEndpoints(rows, {
    ...makeOptions({ lookup: lookupAdapter }),
    ...(hosts === undefined ? { modbusTcpHosts: undefined } : { modbusTcpHosts: parseModbusTcpHosts(hosts) }),
  });

export function assertAListedHostIsPlanned(): void {
  const result = plan([modbusRow("10.0.0.5"), modbusRow("meter.site")], "10.0.0.0/24,meter.site");
  expect(result.skipped).toEqual([]);
  expect(result.endpoints.map((e) => e.endpointKey).sort()).toEqual(["modbus_tcp://10.0.0.5:502", "modbus_tcp://meter.site:502"]);
}

export function assertAnUnlistedHostIsSkippedByName(): void {
  const result = plan([modbusRow("10.0.1.5"), modbusRow("other.site")], "10.0.0.0/24,meter.site");
  expect(result.endpoints).toEqual([]);
  expect(result.skipped).toEqual([
    { rtuId: "rtu-10.0.1.5", rtuCode: "M-10.0.1.5", reason: "modbus-host-not-allowed" },
    { rtuId: "rtu-other.site", rtuCode: "M-other.site", reason: "modbus-host-not-allowed" },
  ]);
}

export function assertNoListDialsNothing(): void {
  for (const hosts of [undefined, ""]) {
    const result = plan([modbusRow("10.0.0.5")], hosts);
    expect(result.endpoints, String(hosts)).toEqual([]);
    expect(result.skipped.map((s) => s.reason), String(hosts)).toEqual(["modbus-host-not-allowed"]);
  }
}

/** PR 4 code review 2: one socket, one set of request settings; a second RTU that differs is skipped by name. */
export function assertDifferentRequestSettingsOnOneGatewayConflict(): void {
  const slow = row({
    ...modbusRow("10.0.0.5"),
    rtu_id: "rtu-slow",
    rtu_code: "M-slow",
    connection_config: {
      host: "10.0.0.5",
      port: 502,
      timeoutMs: 5_000,
      interRequestDelayMs: 200,
      device: { unitId: 2, registers: [{ sourceKey: "flow", table: "holding", address: 0, type: "uint16" }] },
    },
  });
  const result = plan([modbusRow("10.0.0.5"), slow], "10.0.0.5");
  expect(result.endpoints).toHaveLength(1);
  expect(result.endpoints[0]?.bindings.map((b) => b.deviceKey)).toEqual(["M-10.0.0.5"]);
  expect(result.skipped).toEqual([
    { rtuId: "rtu-slow", rtuCode: "M-slow", reason: "endpoint-config-conflict", detail: "modbus_tcp://10.0.0.5:502" },
  ]);
}

/** PR 4 code review 8: the allow-list is the cloud's; an edge-served Modbus RTU is not checked against it. */
export function assertAnEdgeServedRtuIsNotChecked(): void {
  const result = plan([row({ ...modbusRow("10.9.9.9"), edge_gateway_id: "gw-1" })], "");
  expect(result.skipped).toEqual([]);
  expect(result.endpoints).toEqual([]);
  expect(result.edgeServed.size).toBe(1);
}

/** ADR 0141 Amendment 2 (a): a poll endpoint serves one organization; another's RTU on it is skipped by name. */
export function assertASecondOrganizationOnAPollEndpointIsSkipped(): void {
  const mine = { ...modbusRow("10.0.0.5"), rtu_id: "rtu-a", rtu_code: "M-A", organization_code: "ORG-A" };
  const sameOrg = { ...mine, rtu_id: "rtu-a2", rtu_code: "M-A2" };
  const theirs = { ...mine, rtu_id: "rtu-b", rtu_code: "M-B", organization_code: "ORG-B" };
  const result = plan([row(mine), row(sameOrg), row(theirs)], "10.0.0.5");
  expect(result.endpoints).toHaveLength(1);
  expect(result.endpoints[0]?.bindings.map((b) => b.deviceKey)).toEqual(["M-A", "M-A2"]);
  expect(result.skipped).toEqual([
    { rtuId: "rtu-b", rtuCode: "M-B", reason: "endpoint-organization-conflict", detail: "modbus_tcp://10.0.0.5:502" },
  ]);
}

/** The other direction: MQTT is push, and one broker serves many organizations. */
export function assertTwoOrganizationsShareAnMqttBroker(): void {
  const a = row({ rtu_id: "rtu-a", rtu_code: "R-A", mqtt_topic: "t/a", organization_code: "ORG-A" });
  const b = row({ rtu_id: "rtu-b", rtu_code: "R-B", mqtt_topic: "t/b", organization_code: "ORG-B" });
  const result = plan([a, b], undefined);
  expect(result.skipped).toEqual([]);
  expect(result.endpoints).toHaveLength(1);
  expect(result.endpoints[0]?.bindings).toHaveLength(2);
}

export function assertMqttIsNotAffected(): void {
  const result = plan([row()], undefined);
  expect(result.endpoints).toHaveLength(1);
  expect(result.skipped).toEqual([]);
}
