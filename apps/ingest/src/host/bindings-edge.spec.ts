import { edgeServedCounts } from "./binding-targets.js";
import { BINDING_QUERY, planEndpoints, type BindingRow, type PlanOptions, type PlanResult } from "./bindings.js";
import { makeOptions, row } from "./bindings.spec.js";
import type { PointTarget } from "./normaliser.js";

/**
 * `E7.2` / ADR 0123 decision 6, plan builder call C5 — an RTU with
 * `edge_gateway_id` set has one writer, the edge. `planEndpoints` puts it in
 * no endpoint and in no `skipped` list, and carries its point mapping in
 * `PlanResult.edgeServed` for the cloud receiver (PR 3). The branch sits after
 * the organization switch, protocol, `rtu_code` and `no-mqtt-owned-points`
 * checks, before config and credentials.
 *
 * Fixtures are `bindings.spec.ts`'s, so the two suites agree on what a binding
 * row is.
 */

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const GATEWAY_A = "gateway-uuid-a";
const GATEWAY_B = "gateway-uuid-b";

/** RTU-1's two points, optionally on a gateway. */
function rtuOne(gateway: string | null, overrides: Partial<BindingRow> = {}): BindingRow[] {
  return [
    row({ edge_gateway_id: gateway, ...overrides }),
    row({ edge_gateway_id: gateway, point_key: "PRESSURE", source_data_key: "pressure", unit: "bar", ...overrides }),
  ];
}

/** A second RTU on the same broker as RTU-1. */
function rtuTwo(gateway: string | null, overrides: Partial<BindingRow> = {}): BindingRow {
  return row({
    rtu_id: "rtu-uuid-2",
    rtu_code: "RTU-2",
    mqtt_topic: "Airsprint-1051/Data/RTU-2",
    asset_id: "asset-2",
    edge_gateway_id: gateway,
    ...overrides,
  });
}

function boundRtuIds(result: PlanResult): string[] {
  return result.endpoints.flatMap((e) => e.bindings.map((b) => b.rtuId));
}

/** `sourceKey → targets` for one device, as plain data, for a deep compare. */
function plainTargets(index: ReadonlyMap<string, readonly PointTarget[]> | undefined): unknown {
  return index === undefined ? undefined : Object.fromEntries([...index].map(([k, v]) => [k, v]));
}

/**
 * E0: the query selects `r.edge_gateway_id` and never filters on it — a
 * filtered row could not reach `edgeServed`, and the fixtures above supply the
 * column themselves, so only this and the integration spec see the SQL.
 */
export function runBindingQuerySelectsTheGatewayTests(): void {
  const sql = BINDING_QUERY.replace(/\s+/g, " ");
  assert(sql.includes(" r.edge_gateway_id,"), "the binding query must select rtus.edge_gateway_id");
  const where = sql.slice(sql.indexOf(" WHERE "));
  assert(!where.includes("edge_gateway_id"), `selected, never filtered: ${where}`);
}

/** E1: an edge-served RTU is in no endpoint; the endpoint it would have made is not planned. */
export function runEdgeServedRtuIsInNoEndpointTests(): void {
  const result = planEndpoints(rtuOne(GATEWAY_A), makeOptions());
  assert(
    !boundRtuIds(result).includes("rtu-uuid-1"),
    `an edge-served RTU must not be bound to a cloud endpoint (the cloud would dial it): ${JSON.stringify(boundRtuIds(result))}`,
  );
  assert(
    result.endpoints.length === 0,
    `an endpoint whose every RTU is edge-served is not planned, got ${result.endpoints.length}`,
  );
}

/**
 * RTU-1 with real metadata: every scale and band column set, a known and an
 * unknown `quality_policy`, and a second asset sharing one `source_data_key`,
 * so the E2 compare covers the coalesced columns, the policy narrowing and the
 * fan-out list rather than five nulls.
 */
function rtuOneWithMetadata(gateway: string | null): BindingRow[] {
  return [
    row({
      edge_gateway_id: gateway,
      scale_multiplier: 0.1,
      scale_offset: -4,
      eng_min: 0,
      eng_max: 250,
      quality_policy: "accept_bad",
    }),
    row({
      edge_gateway_id: gateway,
      point_key: "PRESSURE",
      source_data_key: "pressure",
      unit: "bar",
      scale_multiplier: 2.5,
      scale_offset: 1,
      eng_min: -1,
      eng_max: 16,
      quality_policy: "from-a-newer-api",
    }),
    // A header asset fed by the same flow meter: one source key, two targets.
    row({
      edge_gateway_id: gateway,
      asset_id: "asset-header",
      point_key: "HEADER_FLOW",
      scale_multiplier: 1000,
      scale_offset: 0,
      eng_min: 5,
      eng_max: 90,
      quality_policy: "discard_bad",
    }),
  ];
}

/** E2: its targets are in `edgeServed.get(gateway).pointIndex`, equal to what the endpoint would hold. */
export function runEdgeServedCarriesTheEndpointsPointIndexTests(): void {
  const cloud = planEndpoints(rtuOneWithMetadata(null), makeOptions());
  const expected = cloud.endpoints[0]?.pointIndex.get("RTU-1");
  assert(expected !== undefined && expected.size === 2, "control: the cloud plan indexes RTU-1's two source keys");
  const flow = expected.get("flow");
  assert(
    flow !== undefined && flow.length === 2 && flow[0].scaleMultiplier === 0.1 && flow[0].qualityPolicy === "accept_bad",
    `control: the shared source key fans out to both assets with their metadata: ${JSON.stringify(flow)}`,
  );
  assert(
    expected.get("pressure")?.[0]?.qualityPolicy === null,
    "control: an unknown quality_policy narrows to null (discard_bad)",
  );

  const edge = planEndpoints(rtuOneWithMetadata(GATEWAY_A), makeOptions());
  const served = edge.edgeServed.get(GATEWAY_A);
  assert(served !== undefined, `gateway A must carry RTU-1: ${JSON.stringify([...edge.edgeServed.keys()])}`);
  assert(
    [...served.deviceKeys].join(",") === "RTU-1",
    `deviceKeys is the RTU's rtu_code: ${JSON.stringify([...served.deviceKeys])}`,
  );
  const actual = served.pointIndex.get("RTU-1");
  assert(
    JSON.stringify(plainTargets(actual)) === JSON.stringify(plainTargets(expected)),
    `the edge pointIndex must equal the endpoint's: ${JSON.stringify(plainTargets(actual))} vs ${JSON.stringify(plainTargets(expected))}`,
  );
  assert(edge.edgeServed.size === 1, `one gateway, got ${edge.edgeServed.size}`);
  assert(cloud.edgeServed.size === 0, "a plan with no edge-served RTU has an empty edgeServed");
}

/** E3: an edge-served RTU is not in `skipped` (nothing was dropped) nor in `warnings`. */
export function runEdgeServedRtuIsNotSkippedTests(): void {
  const result = planEndpoints(rtuOne(GATEWAY_A), makeOptions());
  assert(result.skipped.length === 0, `an edge-served RTU is not a skip: ${JSON.stringify(result.skipped)}`);
  assert(result.warnings.length === 0, `nor a warning: ${JSON.stringify(result.warnings)}`);
}

/** E4: a mixed endpoint keeps its cloud RTUs; two gateways stay apart; one gateway collects its RTUs. */
export function runMixedEndpointKeepsTheRestTests(): void {
  const mixed = planEndpoints([...rtuOne(null), rtuTwo(GATEWAY_A)], makeOptions());
  assert(mixed.endpoints.length === 1, `the shared broker still runs, got ${mixed.endpoints.length}`);
  const endpoint = mixed.endpoints[0];
  assert(
    endpoint.bindings.length === 1 && endpoint.bindings[0].deviceKey === "RTU-1",
    `only the cloud RTU binds: ${JSON.stringify(endpoint.bindings.map((b) => b.deviceKey))}`,
  );
  assert(endpoint.pointIndex.has("RTU-1"), "the cloud RTU keeps its point index");
  assert(
    !endpoint.pointIndex.has("RTU-2"),
    "the edge-served RTU must not be in the endpoint's point index, or the cloud writes it twice",
  );
  assert(
    mixed.edgeServed.get(GATEWAY_A)?.pointIndex.has("RTU-2") === true &&
      mixed.edgeServed.get(GATEWAY_A)?.pointIndex.has("RTU-1") === false,
    "gateway A carries RTU-2 alone",
  );

  const two = planEndpoints([...rtuOne(GATEWAY_A), rtuTwo(GATEWAY_B)], makeOptions());
  assert(
    [...(two.edgeServed.get(GATEWAY_A)?.deviceKeys ?? [])].join(",") === "RTU-1" &&
      [...(two.edgeServed.get(GATEWAY_B)?.deviceKeys ?? [])].join(",") === "RTU-2",
    "each gateway carries only its own RTU (a gateway may never write another's device)",
  );

  const one = planEndpoints([...rtuOne(GATEWAY_A), rtuTwo(GATEWAY_A)], makeOptions());
  const served = one.edgeServed.get(GATEWAY_A);
  assert(
    served !== undefined && [...served.deviceKeys].sort().join(",") === "RTU-1,RTU-2" && served.pointIndex.size === 2,
    `one gateway collects both RTUs: ${JSON.stringify(served === undefined ? null : [...served.deviceKeys])}`,
  );
}

/** E5: a switched-off organization's RTU is skipped by name and absent from `edgeServed`. */
export function runSwitchedOffOrganizationIsSkippedNotEdgeServedTests(): void {
  const result = planEndpoints(
    rtuOne(GATEWAY_A, { organization_code: "BCPL", organization_ingest_enabled: false }),
    makeOptions(),
  );
  assert(
    result.skipped.length === 1 &&
      result.skipped[0].reason === "organization-ingest-disabled" &&
      result.skipped[0].detail === "BCPL",
    `the organization switch still bites first: ${JSON.stringify(result.skipped)}`,
  );
  assert(result.edgeServed.size === 0, "a switched-off organization's RTU is not edge-served");
}

/** E6: the MQTT `telemetrySource` filter still applies to an edge-served RTU. */
export function runTelemetrySourceFilterStillAppliesTests(): void {
  const partly = planEndpoints(
    [row({ edge_gateway_id: GATEWAY_A }), row({ edge_gateway_id: GATEWAY_A, point_key: "SIM", source_data_key: "sim", telemetry_source: "catalog" })],
    makeOptions(),
  );
  const index = partly.edgeServed.get(GATEWAY_A)?.pointIndex.get("RTU-1");
  assert(
    index !== undefined && index.has("flow") && !index.has("sim"),
    `a catalog-sourced point stays the simulator's: ${JSON.stringify(plainTargets(index))}`,
  );

  const none = planEndpoints([row({ edge_gateway_id: GATEWAY_A, telemetry_source: "catalog" })], makeOptions());
  assert(
    none.skipped.length === 1 && none.skipped[0].reason === "no-mqtt-owned-points",
    `an RTU with no mqtt-owned point is skipped as before: ${JSON.stringify(none.skipped)}`,
  );
  assert(none.edgeServed.size === 0, "and is not edge-served");
}

/**
 * E7: decided before config and credentials — the cloud never decrypts an
 * edge-served RTU's blob nor resolves its broker, and a config the cloud would
 * refuse does not skip it.
 */
export function runDecidedBeforeConfigAndCredentialsTests(): void {
  let decrypts = 0;
  let resolves = 0;
  const base = makeOptions();
  const options: PlanOptions = {
    ...base,
    decryptCredentials: (...args) => {
      decrypts += 1;
      return base.decryptCredentials(...args);
    },
    resolveMqttConnection: (configRow) => {
      resolves += 1;
      return base.resolveMqttConnection(configRow);
    },
  };

  // Configs the cloud path would act on, control first, cloud-served: an MQTT
  // RTU is resolved (its broker), and a Modbus RTU with a blob is decrypted.
  const modbus: Partial<BindingRow> = {
    rtu_id: "rtu-uuid-3",
    rtu_code: "RTU-3",
    asset_id: "asset-3",
    config_protocol: "modbus_tcp",
    connection_config: { host: "10.0.0.5", port: 502, device: { unitId: 1 } },
    credentials_ciphertext: Buffer.from("cipher"),
    credentials_iv: Buffer.from("iv"),
    key_version: 1,
  };
  const control = planEndpoints([...rtuOne(null), row({ ...modbus, edge_gateway_id: null })], options);
  assert(
    control.endpoints.length === 2 && resolves > 0 && decrypts > 0,
    `control: the cloud path resolves and decrypts these RTUs (${resolves} / ${decrypts}): ${JSON.stringify(control.skipped)}`,
  );

  decrypts = 0;
  resolves = 0;
  const served = planEndpoints([...rtuOne(GATEWAY_A), row({ ...modbus, edge_gateway_id: GATEWAY_A })], options);
  assert(decrypts === 0 && resolves === 0, `no credential work for an edge-served RTU: ${decrypts} / ${resolves}`);
  assert(served.skipped.length === 0 && served.endpoints.length === 0, "and no endpoint or skip for either");
  assert(
    [...(served.edgeServed.get(GATEWAY_A)?.deviceKeys ?? [])].sort().join(",") === "RTU-1,RTU-3",
    "both are edge-served",
  );

  // A config the cloud would refuse does not skip an edge-served RTU.
  const refused = planEndpoints(
    rtuOne(GATEWAY_A, { connection_config: { rejectUnauthorized: false } }),
    options,
  );
  assert(refused.skipped.length === 0, `the cloud's config checks do not apply: ${JSON.stringify(refused.skipped)}`);
  assert(refused.edgeServed.get(GATEWAY_A)?.deviceKeys.has("RTU-1") === true, "it is still edge-served");
}

/** E8: the host's log counts — gateways and RTUs, never a device key. */
export function runEdgeServedCountsTests(): void {
  assert(
    JSON.stringify(edgeServedCounts(planEndpoints(rtuOne(null), makeOptions()).edgeServed)) ===
      JSON.stringify({ edgeGateways: 0, edgeServedRtus: 0 }),
    "no edge-served RTU counts zero",
  );
  const counts = edgeServedCounts(
    planEndpoints([...rtuOne(GATEWAY_A), rtuTwo(GATEWAY_A), row({ rtu_id: "rtu-uuid-3", rtu_code: "RTU-3", asset_id: "asset-3", edge_gateway_id: GATEWAY_B })], makeOptions()).edgeServed,
  );
  assert(
    counts.edgeGateways === 2 && counts.edgeServedRtus === 3,
    `two gateways, three RTUs (not five rows): ${JSON.stringify(counts)}`,
  );
}
