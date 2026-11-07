import type { OnboardingDraft } from "@bms/shared";
import { expect } from "vitest";

import { plaintextRtusOf } from "./onboarding-commit-plaintext";

type DraftRtu = NonNullable<OnboardingDraft["rtus"]>[number];

function rtu(code: string, protocol: DraftRtu["protocol"], config: Record<string, unknown>): DraftRtu {
  return { code, displayName: code, protocol, config };
}

/** A1 — one plain MQTT RTU beside a TLS one: one entry, code and `tls: false` only (ruling 7). */
export function onePlainBesideATlsRtuIsOneEntry(): void {
  const entries = plaintextRtusOf({
    rtus: [
      rtu("PLAIN-1", "mqtt", { host: "plain.example", port: 1883, tls: false }),
      rtu("TLS-1", "mqtt", { host: "tls.example", port: 8883 }),
      rtu("STR-1", "mqtt", { host: "tls.example", port: 8883, tls: "false" }),
      rtu("MB-1", "modbus_tcp", { host: "10.0.0.5", port: 502, tls: false }),
    ],
  });
  expect(entries).toEqual([{ code: "PLAIN-1", tls: false }]);
  expect(JSON.stringify(entries)).not.toContain("plain.example");
}

/** A2 — no plain RTU: `[]`, so the field is always present. */
export function noPlainRtuIsAnEmptyList(): void {
  expect(plaintextRtusOf({ rtus: [rtu("TLS-1", "mqtt", { tls: true })] })).toEqual([]);
  expect(plaintextRtusOf({})).toEqual([]);
}
