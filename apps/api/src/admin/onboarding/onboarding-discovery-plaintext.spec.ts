import { BadRequestException, ConflictException } from "@nestjs/common";
import { MQTT_PLAINTEXT_NOT_ALLOWED_MESSAGE, parseMqttPlaintextHosts } from "@bms/shared";
import { expect } from "vitest";

import { DISCOVERY_TARGET_CHANGED } from "./onboarding-discovery.service";
import { BODY, draft, harness, rejection, start } from "./onboarding-discovery.service.spec";

/**
 * `F4.326` / ADR 0114 decision 4 and R6 — the discovery start route applies the
 * plain-MQTT rule (400 with the fixed message and a refuse row) and binds the
 * card's TLS choice (`expected.tls`, absent = `true`; 409 on a mismatch).
 */

const PLAIN = draft({ rtu: { config: { host: "broker.example.com", port: 1883, tls: false, topic: "a/b" } } });
const PLAIN_BODY = { ...BODY, expected: { host: "broker.example.com", port: 1883, tls: false } };
const LISTED = parseMqttPlaintextHosts("broker.example.com");

/** R1 — unlisted plain: 400 with the fixed message, one refuse row, nothing queued. */
export async function anUnlistedPlainRtuIsRefused(): Promise<void> {
  for (const plaintextHosts of [undefined, parseMqttPlaintextHosts("other.example")]) {
    const h = harness({ draft: PLAIN, ...(plaintextHosts ? { plaintextHosts } : {}) });
    const err = await rejection(start(h, PLAIN_BODY));
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).message).toBe(MQTT_PLAINTEXT_NOT_ALLOWED_MESSAGE);
    expect(h.audits.map((a) => [a.action, a.payload.refusal])).toEqual([
      ["onboarding.discovery.refuse", "plaintext not allowed"],
    ]);
    expect(h.writes).toEqual([]);
    expect(h.jobs).toEqual([]);
  }
}

/** R2 — listed plain with `expected.tls: false`: queued. */
export async function aListedPlainRtuIsQueued(): Promise<void> {
  const h = harness({ draft: PLAIN, plaintextHosts: LISTED });
  await start(h, PLAIN_BODY);
  expect(h.jobs).toHaveLength(1);
  // Security review L1: the confirmed TLS choice travels with the job.
  expect(h.jobs[0]?.payload.tls).toBe(false);
}

/** R3 — a plain RTU whose body omits `expected.tls` (reads as `true`): 409, nothing written. */
export async function aPlainRtuWithoutExpectedTlsIs409(): Promise<void> {
  const h = harness({ draft: PLAIN, plaintextHosts: LISTED });
  const { tls: _omitted, ...expected } = PLAIN_BODY.expected;
  const err = await rejection(start(h, { ...PLAIN_BODY, expected }));
  expect(err).toBeInstanceOf(ConflictException);
  expect((err as ConflictException).message).toBe(DISCOVERY_TARGET_CHANGED);
  expect(h.writes).toEqual([]);
}

/** R4 — a TLS RTU: queued without `expected.tls`, 409 with `expected.tls: false`. Reddens on `?? false`. */
export async function aTlsRtuBindsItsTlsChoice(): Promise<void> {
  const ok = harness();
  await start(ok, BODY);
  expect(ok.jobs).toHaveLength(1);
  expect(ok.jobs[0]?.payload.tls).toBe(true);
  const stale = harness();
  const err = await rejection(start(stale, { ...BODY, expected: { ...BODY.expected, tls: false } }));
  expect(err).toBeInstanceOf(ConflictException);
}
