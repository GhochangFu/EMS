import { createHash } from "node:crypto";

import {
  MQTT_BUILTIN_PAYLOAD_FORMAT_CODE,
  MQTT_BUILTIN_PAYLOAD_FORMAT_DEFINITION,
  type IngestProtocol,
  type MqttPayloadFormatDefinition,
} from "@bms/shared/ingest";

import type { RtuBinding } from "../adapter/types.js";

/**
 * The endpoint plan's fingerprints — what the reload diff compares to decide
 * that a running endpoint must be replaced (`host/reconcile.ts`).
 *
 * `credentialMark`, `credentialFingerprint` and `decoderFingerprint` moved here
 * unchanged from `bindings.ts` (`F1.2` plan T3.1), which sat at the line cap.
 * `configFingerprint` is new (ADR 0016 Amendment 10 (a)). Every one is built
 * from non-secret fields only: no credential plaintext and no ciphertext ever
 * enters a hash here (ADR 0115 R5, ADR 0129 decision 4).
 */

/** The payload format one MQTT binding decodes with; `undefined` is the built-in. */
export type ResolvedPayloadFormat = { code: string; definition: MqttPayloadFormatDefinition } | undefined;

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

/**
 * `F4.333`: one bound RTU's part of `credentialFingerprint` — the id, the key
 * version, the IV and whether a ciphertext is present (security review I1: no
 * CHECK ties the two columns together). Never the ciphertext itself.
 */
export function credentialMark(
  rtuId: string,
  row: {
    readonly key_version: number | null;
    readonly credentials_iv: Buffer | null;
    readonly credentials_ciphertext: Buffer | null;
  },
): string {
  const iv = row.credentials_iv === null ? "-" : row.credentials_iv.toString("base64");
  const present = row.credentials_ciphertext === null ? "0" : "1";
  return [rtuId, String(row.key_version ?? "-"), iv, present].join("\u0000");
}

/** `F4.333` (ADR 0129 decision 4): `credentialFingerprint` from the bound RTUs' marks. */
export function credentialFingerprint(marks: readonly string[]): string {
  return sha256([...marks].sort().join("\n"));
}

/** `decoderFingerprint` for one endpoint's bindings (`F4.334` plan R8). */
export function decoderFingerprint(protocol: IngestProtocol, bindings: readonly RtuBinding<unknown>[]): string {
  const parts =
    protocol === "mqtt"
      ? bindings.map((binding) => {
          const device = asRecord(binding.device);
          const format = device.payloadFormat as ResolvedPayloadFormat;
          return [
            String(device.topic),
            format?.code ?? MQTT_BUILTIN_PAYLOAD_FORMAT_CODE,
            JSON.stringify(format?.definition ?? MQTT_BUILTIN_PAYLOAD_FORMAT_DEFINITION),
          ].join("\u0000");
        })
      : [];
  return sha256([...new Set(parts)].sort().join("\n"));
}

/**
 * JSON with every object's keys sorted, at every depth, so two configs that
 * differ only in key order hash alike. `undefined` (and an absent value) is
 * `null`; arrays keep their order, because a register list's order is data.
 */
export function canonicalJson(value: unknown): string {
  if (value === undefined || value === null || typeof value !== "object") {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

/**
 * `F1.2` (ADR 0016 Amendment 10 (a)): sha256 over the canonical connection
 * slice and each `deviceKey` with its canonical device slice and its sorted
 * `sourceKeys`, sorted by device key. A poll adapter plans its reads from
 * `sourceKeys` at connect, so a point mapped or unmapped on a running RTU must
 * replace the endpoint too (PR 4 code review 1). A new register list, a new unit id or a new timeout on a running poll
 * endpoint is a `replace` with `reason: "device-config-changed"`.
 *
 * `""` for MQTT: its connection is keyed and replaced by the decoder and
 * credential fingerprints already, and its plan stays byte for byte as it was.
 * The connection slice reaching here never holds `pollIntervalMs` (the host
 * removed it), so an interval change has its own reason.
 */
export function configFingerprint(
  protocol: IngestProtocol,
  config: unknown,
  bindings: readonly RtuBinding<unknown>[],
): string {
  if (protocol === "mqtt") {
    return "";
  }
  const devices = bindings
    .map(
      (binding) =>
        `${binding.deviceKey}\u0000${canonicalJson(binding.device)}\u0000${[...new Set(binding.sourceKeys)].sort().join(",")}`,
    )
    .sort();
  return sha256([canonicalJson(config), ...devices].join("\n"));
}
