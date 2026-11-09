import type { OnboardingDraft } from "@bms/shared";

import { ownBlobAt, rtuSecretKey, storeBlobAt, type EncryptedBlob } from "./onboarding-redaction";

/**
 * `F4.339` (ADR 0117 decision 7, plan R7) — the pure core of the credential
 * copy: which broker an RTU config names, whether two are the same, and the
 * all-or-nothing write of one stored blob to several draft RTUs. The blob is
 * copied **as stored** (`{ c, iv, v }`), never decrypted (owner ruling Q4).
 */

/** The broker an MQTT config connects to. `host` and `port` may be absent (the ingest host's env fallback). */
export type MqttBroker = { host: string | null; port: number | null; tls: boolean };

/** Reads the broker of an RTU config; `tls` absent reads as `true` (ADR 0114 decision 2). */
export function brokerOf(config: unknown): MqttBroker {
  const record = typeof config === "object" && config !== null ? (config as Record<string, unknown>) : {};
  return {
    host: typeof record.host === "string" && record.host.trim() !== "" ? record.host.trim().toLowerCase() : null,
    port: typeof record.port === "number" ? record.port : null,
    tls: record.tls !== false,
  };
}

/** Same host (case-insensitive), port and TLS: a credential is the broker's, so a copy needs all three. */
export function sameBroker(a: MqttBroker, b: MqttBroker): boolean {
  return a.host === b.host && a.port === b.port && a.tls === b.tls;
}

export type CopyRefusal =
  | { refused: "no-code"; indexes: number[] }
  | { refused: "self"; codes: string[] }
  | { refused: "has-credential"; codes: string[] };

/**
 * Writes `blob` to every target, or nothing. A target with no distinct code,
 * the source itself, or (without `replace`) a target that already holds a
 * credential refuses the whole copy and names the targets.
 */
export function copyBlobToTargets(
  draft: OnboardingDraft,
  blob: EncryptedBlob,
  sourceCode: string | null,
  toIndexes: readonly number[],
  replace: boolean,
): { draft: OnboardingDraft } | CopyRefusal {
  const codes = toIndexes.map((index) => rtuSecretKey(draft, index));
  const noCode = toIndexes.filter((_, i) => codes[i] === null);
  if (noCode.length > 0) return { refused: "no-code", indexes: noCode };
  const named = codes as string[];
  if (sourceCode !== null && named.includes(sourceCode)) return { refused: "self", codes: [sourceCode] };
  if (!replace) {
    const held = named.filter((_, i) => ownBlobAt(draft, toIndexes[i] as number) !== null);
    if (held.length > 0) return { refused: "has-credential", codes: held };
  }
  const next = storeBlobAt(draft, blob, toIndexes);
  return next === null ? { refused: "no-code", indexes: [...toIndexes] } : { draft: next };
}
