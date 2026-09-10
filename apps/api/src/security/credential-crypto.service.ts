import { Injectable } from "@nestjs/common";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import {
  CREDENTIAL_KEY_ENV,
  CredentialKeyConfigError,
  type Base64Decoder,
  type LoadedCredentialKeys,
  keyForVersion,
  resolveCredentialKeys,
} from "@bms/shared";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

export type EncryptedPayload = {
  ciphertext: Buffer;
  iv: Buffer;
  keyVersion: number;
};

/**
 * `packages/shared` has no `@types/node` reachable, so `resolveCredentialKeys`
 * works over `Uint8Array` and takes its base64 decoder from the caller. This is
 * that caller's half (ADR 0062 decision 2); the ingest injects the same one.
 */
const decode: Base64Decoder = (s) => Buffer.from(s, "base64");

/**
 * AES-256-GCM encrypt/decrypt for RTU connection credentials and webhook HMAC
 * secrets (ADR 0012, ADR 0062 decisions 3, 4 and 5 with Amendment 1).
 *
 * The key window itself — which key is current, which is previous, and which
 * version each writes — is resolved in `@bms/shared`, never here. This class
 * owns the cipher and nothing about key selection.
 *
 * The import is from the barrel rather than `@bms/shared/credential-keys`
 * because `apps/api` compiles with `moduleResolution: "node"` (node10), which
 * ignores the `exports` map — `packages/shared/src/index.ts:60-66` records the
 * same reason for `./calc-dsl`.
 */
@Injectable()
export class CredentialCryptoService {
  /**
   * The resolver is called here for one reason: **its throw is the API's
   * refused boot** (decision 5). `main.ts` calls `NestFactory.create(AppModule)`
   * with `abortOnError` defaulting to `true` and Nest instantiates providers
   * eagerly, and this service is provided at `notifications.module.ts:47` and
   * `admin.module.ts:84` — so a `CredentialKeyConfigError` thrown from a
   * provider constructor stops the process before the first request. The
   * repository has no central env validator; `DatabaseModule` already uses this
   * shape.
   *
   * Dead configuration — a previous key at version 0, a key of the wrong
   * length, a malformed version — must not wait for the first decrypt, which
   * would surface in production at one broker connection on one RTU. An *unset*
   * `CREDENTIAL_ENCRYPTION_KEY` is not dead: it is unconfigured, the resolver
   * returns `current: null`, and this constructor succeeds. Several callers
   * branch on `isConfigured()` and `onboarding-chat-caps.spec.ts:176`
   * constructs the service with no key at all.
   *
   * The returned window is deliberately **not** cached — see `load()`.
   */
  constructor() {
    CredentialCryptoService.load();
  }

  /**
   * Reads `process.env` on **every** call, in `encrypt`, `decrypt`,
   * `isConfigured` and `currentKeyVersion` alike. That is the behaviour the old
   * `getKey()` had, and specs elsewhere in the repo depend on it: they mutate
   * `process.env` after they have constructed the service and expect the next
   * call to see the change (`channels.service.spec.ts:247-292`,
   * `notifications.module.ts:23`). Caching the window in the constructor would
   * be invisible to every assertion that does not switch keys mid-test.
   */
  private static load(): LoadedCredentialKeys {
    return resolveCredentialKeys(process.env, decode);
  }

  /**
   * True when a current key is loaded. Swallows a dead window and answers
   * `false` — the asymmetry with `currentKeyVersion()`, which propagates, is
   * deliberate: this static exists for the optional paths that must not throw,
   * and the constructor has already refused to boot on anything it hides.
   */
  static isConfigured(): boolean {
    try {
      return CredentialCryptoService.load().current !== null;
    } catch {
      return false;
    }
  }

  /**
   * The version the current key writes (decision 3). Answers even when no key
   * is configured — `onboarding-commit.service.ts` labels a credential-less row
   * with it — and propagates a `CredentialKeyConfigError` on a dead window.
   */
  static currentKeyVersion(): number {
    return CredentialCryptoService.load().currentVersion;
  }

  /** Encrypts a JSON-serializable credential object at the current version. */
  encrypt(credentials: Record<string, unknown>): EncryptedPayload {
    const keys = CredentialCryptoService.load();
    if (keys.current === null) {
      throw new CredentialKeyConfigError(`${CREDENTIAL_KEY_ENV.current} is required`);
    }
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, keys.current, iv);
    const plaintext = Buffer.from(JSON.stringify(credentials), "utf8");
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      ciphertext: Buffer.concat([encrypted, tag]),
      iv,
      keyVersion: keys.currentVersion,
    };
  }

  /**
   * Decrypts ciphertext produced by `encrypt()` **at the version it was stored
   * under** (decision 4). `keyVersion` is the value the carrier holds: the
   * current version selects the current key, the current version minus one
   * selects the previous key, and anything else — including the `null` that
   * `notification_channels.secret_key_version` may hold — throws
   * `CredentialKeyVersionError`. There is no second attempt with the other key:
   * an AES-GCM tag check would make a guess *work*, and a rotation that
   * silently accepts an unknown version can never report that it has finished.
   */
  decrypt(ciphertext: Buffer, iv: Buffer, keyVersion: number | null): Record<string, unknown> {
    const key = keyForVersion(CredentialCryptoService.load(), keyVersion);
    if (ciphertext.length <= TAG_LENGTH) {
      throw new Error("Invalid credentials ciphertext");
    }
    const encrypted = ciphertext.subarray(0, ciphertext.length - TAG_LENGTH);
    const tag = ciphertext.subarray(ciphertext.length - TAG_LENGTH);
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    const parsed: unknown = JSON.parse(decrypted.toString("utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("Decrypted credentials must be an object");
    }
    return parsed as Record<string, unknown>;
  }
}
