import { expect } from "vitest";

import { readEncryptedCredentials, reconcileSecrets } from "./onboarding-redaction";

/**
 * `F4.339` (security review H1) — a copied credential is bound to the broker it
 * was copied for (`_secrets[code].b`). It is served only while its RTU still
 * names that host, port and TLS, and a merge drops it once the RTU names
 * another. An unbound blob (typed through `POST credentials`) is unchanged.
 * Assertions here; the sibling `.test.ts` is the Vitest entry point (ADR 0014).
 */

const BROKER = { host: "broker.test", port: 8883, tls: true };
const BLOB = { c: "Y2lwaGVy", iv: "aXZpdml2aXZp", v: 1 };

function draft(config: Record<string, unknown>, entry: Record<string, unknown>) {
  return {
    rtus: [{ code: "A", displayName: "A", protocol: "mqtt", config, credentialsSet: true }],
    _secrets: { A: entry },
  } as never;
}

/** A bound blob is served on its broker (the host compares case-insensitively), and not on another host, port or TLS. */
export function aBoundBlobIsServedOnlyOnItsBroker(): void {
  const bound = { ...BLOB, b: BROKER };
  expect(readEncryptedCredentials(draft({ host: "Broker.Test", port: 8883 }, bound), 0)).not.toBeNull();
  expect(readEncryptedCredentials(draft({ host: "evil.test", port: 8883 }, bound), 0)).toBeNull();
  expect(readEncryptedCredentials(draft({ host: "broker.test", port: 1883 }, bound), 0)).toBeNull();
  expect(readEncryptedCredentials(draft({ host: "broker.test", port: 8883, tls: false }, bound), 0)).toBeNull();
}

/** A merge drops a bound blob whose RTU now names another broker, and clears credentialsSet; it keeps a matching one. */
export function aMergeDropsABlobWhoseBrokerChanged(): void {
  const moved = reconcileSecrets(draft({ host: "evil.test", port: 8883 }, { ...BLOB, b: BROKER }), { deriveCredentialsSet: true });
  expect((moved as { _secrets?: unknown })._secrets).toBeUndefined();
  expect(moved.rtus?.[0]?.credentialsSet).toBe(false);

  const kept = reconcileSecrets(draft({ host: "broker.test", port: 8883 }, { ...BLOB, b: BROKER }), { deriveCredentialsSet: true });
  expect((kept as { _secrets?: Record<string, unknown> })._secrets?.A).toEqual({ ...BLOB, b: BROKER });
  expect(kept.rtus?.[0]?.credentialsSet).toBe(true);
}

/** An unbound blob is served whatever the config says (the typed-credential path is unchanged). */
export function anUnboundBlobIsUnchanged(): void {
  expect(readEncryptedCredentials(draft({ host: "anything.test" }, BLOB), 0)).not.toBeNull();
}

/** A binding that does not parse makes the entry absent (fail closed). */
export function aMalformedBindingIsAbsent(): void {
  expect(readEncryptedCredentials(draft({ host: "broker.test", port: 8883 }, { ...BLOB, b: { host: "broker.test" } }), 0)).toBeNull();
  expect(readEncryptedCredentials(draft({ host: "broker.test", port: 8883 }, { ...BLOB, b: "broker.test" }), 0)).toBeNull();
}
