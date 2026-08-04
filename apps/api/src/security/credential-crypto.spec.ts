import { randomBytes } from "node:crypto";

import { CredentialCryptoService } from "./credential-crypto.service";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** Round-trip tests for credential encryption. */
export function runCredentialCryptoTests(): void {
  const key = randomBytes(32).toString("base64");
  process.env.CREDENTIAL_ENCRYPTION_KEY = key;
  const svc = new CredentialCryptoService();
  const enc = svc.encrypt({ username: "u", password: "p" });
  const dec = svc.decrypt(enc.ciphertext, enc.iv);
  assert(dec.username === "u", "username round-trip");
  assert(dec.password === "p", "password round-trip");
  assert(CredentialCryptoService.isConfigured(), "isConfigured true");
  delete process.env.CREDENTIAL_ENCRYPTION_KEY;
  assert(!CredentialCryptoService.isConfigured(), "isConfigured false when unset");
}
