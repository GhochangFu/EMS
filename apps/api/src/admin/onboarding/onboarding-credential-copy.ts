import type { OnboardingDraft } from "@bms/shared";

import { brokerOf, isMqttBroker, sameBroker, type MqttBroker } from "./onboarding-mqtt-broker";
import { ownBlobAt, rtuSecretKey, storeBlobAt, type EncryptedBlob } from "./onboarding-redaction";

export { brokerOf, isMqttBroker, sameBroker, type MqttBroker };

/**
 * `F4.339` (ADR 0117 decision 7, plan R7) — the pure core of the credential
 * copy: which broker an RTU config names, whether two are the same, and the
 * all-or-nothing write of one stored blob to several draft RTUs. The blob is
 * copied **as stored** (`{ c, iv, v }`), never decrypted (owner ruling Q4).
 */

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
