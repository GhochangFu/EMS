import { expect } from "vitest";

import { BINDING_QUERY, planEndpoints, type BindingRow, type PlanResult } from "./bindings.js";
import { makeOptions, row } from "./bindings.spec.js";

/**
 * `F4.334` / ADR 0116 decision 4 and plan R4, R8 — the binding plan's payload
 * format: the catalog join, the three skips, the device slice the adapter
 * decodes with, and the decoder fingerprint. Vitest entry point: the sibling
 * `.test.ts` (ADR 0014).
 */

/** The `thinkiot-register-array` definition as the catalog stores it (migration 0130). */
export const BCPL_DEFINITION = {
  kind: "declarative",
  root: "array",
  deviceKey: ["TagName"],
  time: { path: ["Timestamp"], unit: "epoch_s" },
  wordOrder: "big",
  byteOrder: "big",
  readings: [
    { key: "treated_water_flow_klh", register: { path: ["Data"], index: 0, type: "float32" } },
    { key: "outlet_flow_totalizer_kl", register: { path: ["Data"], index: 3, type: "float32" } },
  ],
};

const CODE = "thinkiot-register-array";

/** One BCPL RTU row naming `code`, joined to `definition` (or to nothing). */
function bcplRow(
  rtu: string,
  topic: string,
  code: string | undefined,
  joined: { code: string | null; definition: unknown } = { code: code ?? null, definition: BCPL_DEFINITION },
  extra: Record<string, unknown> = {},
): BindingRow {
  return row({
    rtu_id: `id-${rtu}`,
    rtu_code: rtu,
    mqtt_topic: topic,
    source_data_key: "treated_water_flow_klh",
    connection_config: { ...(code === undefined ? {} : { payloadFormat: code }), ...extra },
    payload_format_code: code === undefined ? null : joined.code,
    payload_format_definition: code === undefined ? null : joined.definition,
  });
}

function plan(rows: readonly BindingRow[]): PlanResult {
  return planEndpoints(rows, makeOptions());
}

function deviceOf(result: PlanResult, rtuCode: string): Record<string, unknown> | undefined {
  for (const endpoint of result.endpoints) {
    const binding = endpoint.bindings.find((b) => b.rtuCode === rtuCode);
    if (binding !== undefined) {
      return binding.device as Record<string, unknown>;
    }
  }
  return undefined;
}

/** P1 — the query joins the catalog on the config's code and still joins the config. */
export function theQueryJoinsTheCatalog(): void {
  const sql = BINDING_QUERY.replace(/\s+/g, " ");
  expect(sql).toContain("LEFT JOIN bms.mqtt_payload_formats f ON f.code = c.config->>'payloadFormat'");
  expect(sql).toContain("f.code AS payload_format_code");
  expect(sql).toContain("f.definition AS payload_format_definition");
  expect(sql).toContain("LEFT JOIN bms.rtu_connection_configs c ON c.rtu_id = r.id");
}

/** P2 — a joined format reaches the device slice; a stored one never does. */
export function theDeviceSliceCarriesTheJoinedFormatOnly(): void {
  const served = plan([bcplRow("BCPL_LAKWA_02", "BCPL/LAKWA", CODE)]);
  expect(served.skipped).toEqual([]);
  const device = deviceOf(served, "BCPL_LAKWA_02");
  expect((device?.payloadFormat as { code: string }).code).toBe(CODE);
  expect((device?.payloadFormat as { definition: { kind: string } }).definition.kind).toBe("declarative");

  // Security twin: a stored device.payloadFormat with its own definition is overwritten.
  const forged = {
    code: CODE,
    definition: { ...BCPL_DEFINITION, readings: [{ key: "x", field: ["evil"] }] },
  };
  const overwritten = plan([bcplRow("B1", "BCPL/1", CODE, undefined, { device: { payloadFormat: forged } })]);
  expect(JSON.stringify(deviceOf(overwritten, "B1")?.payloadFormat)).not.toContain("evil");
  const none = plan([bcplRow("B2", "BCPL/2", undefined, undefined, { device: { payloadFormat: forged } })]);
  expect(deviceOf(none, "B2")?.payloadFormat).toBeUndefined();
}

/** P3 — a code with no catalog row, or a row that fails the schema, is skipped by name. */
export function unknownAndInvalidFormatsAreSkipped(): void {
  const unknown = plan([bcplRow("B1", "BCPL/1", "no-such", { code: null, definition: null })]);
  expect(unknown.endpoints).toEqual([]);
  expect(unknown.skipped).toEqual([
    { rtuId: "id-B1", rtuCode: "B1", reason: "payload-format-unknown", detail: "no-such" },
  ]);
  const invalid = plan([bcplRow("B1", "BCPL/1", CODE, { code: CODE, definition: { kind: "script", body: "x" } })]);
  expect(invalid.endpoints).toEqual([]);
  expect(invalid.skipped).toEqual([{ rtuId: "id-B1", rtuCode: "B1", reason: "payload-format-invalid", detail: CODE }]);
  // The detail never carries the definition.
  expect(JSON.stringify(invalid.skipped)).not.toContain("script");
  // A code the config schema refuses is an invalid config, not a format skip.
  const badCode = plan([bcplRow("B1", "BCPL/1", "Bad Code", { code: null, definition: null })]);
  expect(badCode.skipped.map((s) => s.reason)).toEqual(["invalid-connection-config"]);
}

/** P4 — one topic, one format; different topics on one broker may differ. */
export function oneTopicMeansOneFormat(): void {
  const conflict = plan([
    bcplRow("B1", "shared/topic", CODE),
    bcplRow("B2", "shared/topic", undefined),
  ]);
  expect(conflict.skipped).toEqual([
    { rtuId: "id-B2", rtuCode: "B2", reason: "payload-format-conflict", detail: "shared/topic" },
  ]);
  expect(conflict.endpoints).toHaveLength(1);
  expect(conflict.endpoints[0]?.bindings.map((b) => b.rtuCode)).toEqual(["B1"]);

  const apart = plan([bcplRow("B1", "topic/1", CODE), bcplRow("B2", "topic/2", undefined)]);
  expect(apart.skipped).toEqual([]);
  expect(apart.endpoints).toHaveLength(1);
  expect(apart.endpoints[0]?.bindings.map((b) => b.rtuCode)).toEqual(["B1", "B2"]);

  // Same topic, same format: both served.
  const same = plan([bcplRow("B1", "shared/topic", CODE), bcplRow("B2", "shared/topic", CODE)]);
  expect(same.skipped).toEqual([]);
  expect(same.endpoints[0]?.bindings).toHaveLength(2);
}

/** P5 — PHE unchanged: RTUs that name no format plan exactly as before. */
export function aPheRtuPlansAsBefore(): void {
  const result = plan([
    row(),
    row({ rtu_id: "rtu-uuid-2", rtu_code: "RTU-2", mqtt_topic: "Airsprint-1051/Data/RTU-2" }),
  ]);
  expect(result.skipped).toEqual([]);
  expect(result.endpoints).toHaveLength(1);
  expect(result.endpoints[0]?.bindings).toEqual([
    {
      rtuId: "rtu-uuid-1",
      rtuCode: "RTU-1",
      deviceKey: "RTU-1",
      device: { topic: "Airsprint-1051/Data/RTU-1" },
      sourceKeys: ["flow"],
    },
    {
      rtuId: "rtu-uuid-2",
      rtuCode: "RTU-2",
      deviceKey: "RTU-2",
      device: { topic: "Airsprint-1051/Data/RTU-2" },
      sourceKeys: ["flow"],
    },
  ]);
  // No format named, so no format key with a value on the device.
  expect(result.endpoints[0]?.bindings.every((b) => (b.device as { payloadFormat?: unknown }).payloadFormat === undefined)).toBe(true);
}

/** P6 — the fingerprint moves with the definition and the code, never with a name or credentials. */
export function theFingerprintFollowsTheDecoder(): void {
  const fingerprint = (rows: readonly BindingRow[]) => plan(rows).endpoints[0]?.decoderFingerprint;
  const base = fingerprint([bcplRow("B1", "t/1", CODE)]);
  expect(base).toMatch(/^[0-9a-f]{64}$/);
  expect(fingerprint([bcplRow("B1", "t/1", CODE)])).toBe(base);

  const swapped = {
    ...BCPL_DEFINITION,
    readings: [
      { key: "outlet_flow_totalizer_kl", register: { path: ["Data"], index: 0, type: "float32" } },
      { key: "treated_water_flow_klh", register: { path: ["Data"], index: 3, type: "float32" } },
    ],
  };
  expect(fingerprint([bcplRow("B1", "t/1", CODE, { code: CODE, definition: swapped })])).not.toBe(base);
  expect(fingerprint([bcplRow("B1", "t/1", undefined)])).not.toBe(base);
  // Two RTUs on one topic with one format fingerprint the same as one (the set, not the count).
  expect(fingerprint([bcplRow("B1", "t/1", CODE), bcplRow("B2", "t/1", CODE)])).toBe(base);
  // A different credential does not move it.
  const otherCreds = planEndpoints([bcplRow("B1", "t/1", CODE)], {
    ...makeOptions(),
    resolveMqttConnection: () => ({
      host: "phe.thinkiot.co.in",
      port: 8883,
      username: "other",
      password: "other-secret",
      credentialSource: "env",
    }),
  });
  expect(otherCreds.endpoints[0]?.decoderFingerprint).toBe(base);
}
