import { createCipheriv, randomBytes } from "node:crypto";

import { decryptCredentials, resolveMqttConnection } from "./rtu-config.js";

/**
 * `E8.4` / ADR 0062 decisions 2, 4 and 9 — the ingest selects its credential
 * key by the stored version and names which credential it will actually use.
 *
 * Assertions live here; `rtu-config.test.ts` is the vitest entry point
 * (ADR 0014), **one `it()` per exported function** — `assert` throws, so two
 * claims in one `it()` would let only the first redden.
 *
 * **This file replaces `rtu-config.js`'s inline `runRtuConfigTests` and the
 * `rtu-config.test.js` wrapper** (plan ruling 4). That carve-out's stated
 * reason was that `rtu-config.js` is an unmodified pilot file; decision 2
 * modifies it, and a TypeScript spec is type-checked against the new JSDoc
 * signatures by `pnpm typecheck:tests` while a `.js` one never was.
 *
 * **The cipher stays duplicated, the key selection does not** (decision 2). The
 * ingest never constructs `CredentialCryptoService` — it keeps its own
 * `createDecipheriv` call — so these functions are the only place the ingest's
 * half of the two-key window is measured. `credential-crypto.spec.ts` proves
 * nothing about this process.
 *
 * Errors are matched on `err.name`, never `instanceof` — vitest can load two
 * module instances (`F4.108`).
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const ENV_NAMES = [
  "CREDENTIAL_ENCRYPTION_KEY",
  "CREDENTIAL_ENCRYPTION_KEY_PREVIOUS",
  "CREDENTIAL_ENCRYPTION_KEY_VERSION",
  "MQTT_HOST",
  "MQTT_PORT",
  "MQTT_USERNAME",
  "MQTT_PASSWORD",
] as const;

type IngestEnv = { readonly [name in (typeof ENV_NAMES)[number]]?: string };

/** Sets exactly the named variables and unsets every one that is absent. */
function applyEnv(env: IngestEnv): void {
  for (const name of ENV_NAMES) {
    const value = env[name];
    if (value === undefined) {
      delete process.env[name];
      continue;
    }
    process.env[name] = value;
  }
}

/**
 * Saves all seven variables, applies `env`, and restores them in a `finally` —
 * so a function may call `applyEnv` again inside `body` to move the key window
 * mid-test without leaking either window into the next `it()`.
 *
 * `rtu-config.js` reads `process.env` on every call (the pilot's shape, kept),
 * so an unrestored variable would silently arm the next function.
 */
function withEnv(env: IngestEnv, body: () => void): void {
  const saved = ENV_NAMES.map((name) => [name, process.env[name]] as const);
  try {
    applyEnv(env);
    body();
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) {
        delete process.env[name];
        continue;
      }
      process.env[name] = value;
    }
  }
}

type ThrownShape = { readonly name?: unknown; readonly message?: unknown };

/** Runs `fn`, returns what it threw, and fails when it threw nothing. */
function thrownBy(fn: () => unknown, what: string): ThrownShape {
  try {
    fn();
  } catch (err) {
    if (typeof err === "object" && err !== null) {
      return err as ThrownShape;
    }
    throw new Error(`${what} threw a non-object: ${String(err)}`);
  }
  throw new Error(`expected ${what} to throw`);
}

function nameOf(err: ThrownShape): string {
  return String(err.name);
}

function messageOf(err: ThrownShape): string {
  return String(err.message);
}

/**
 * The API's `encrypt` in six lines, so the spec needs no `apps/api` import: the
 * tag is appended to the ciphertext, which is the framing `decryptCredentials`
 * splits back off.
 */
function encrypt(key: Buffer, payload: Record<string, unknown>): {
  ciphertext: Buffer;
  iv: Buffer;
} {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(payload), "utf8")),
    cipher.final(),
  ]);
  return { ciphertext: Buffer.concat([body, cipher.getAuthTag()]), iv };
}

const SECRET = { username: "db-user", password: "db-secret" };

/** A 32-byte key and its base64 form, generated per function — never a fixture. */
function freshKey(): { bytes: Buffer; base64: string } {
  const bytes = randomBytes(32);
  return { bytes, base64: bytes.toString("base64") };
}

/** The environment half of the pilot fallback, set by every resolver function. */
const MQTT_ENV = {
  MQTT_HOST: "broker.example.com",
  MQTT_PORT: "8883",
  MQTT_USERNAME: "env-user",
  MQTT_PASSWORD: "env-secret",
} as const;

/**
 * The env-fallback checks moved out of `rtu-config.js` unchanged (ruling 4),
 * with decision 9's new field appended.
 *
 * No config row means no database opinion about anything: host, port and both
 * credentials come from the environment, `source` is `"env"` because no row
 * existed, and `credentialSource` agrees.
 */
export function runEnvFallbackTests(): void {
  withEnv({ ...MQTT_ENV }, () => {
    const conn = resolveMqttConnection(null);
    assert(conn.host === "broker.example.com", `env host, got ${conn.host}`);
    assert(conn.port === 8883, `env port, got ${conn.port}`);
    assert(conn.username === "env-user", `env username, got ${String(conn.username)}`);
    assert(conn.password === "env-secret", `env password, got ${String(conn.password)}`);
    assert(conn.source === "env", `env source, got ${conn.source}`);
    assert(
      conn.credentialSource === "env",
      `no row means the credential came from the environment, got ${conn.credentialSource}`,
    );
  });
}

/**
 * Decision 3 at the ingest: a blob written at version 2 reads back at version 2.
 * Reddens when the ingest pins the version — the pilot's key handling had no
 * version at all.
 */
export function runCurrentVersionRoundTripTests(): void {
  const key = freshKey();
  withEnv(
    { CREDENTIAL_ENCRYPTION_KEY: key.base64, CREDENTIAL_ENCRYPTION_KEY_VERSION: "2" },
    () => {
      const blob = encrypt(key.bytes, SECRET);
      const plaintext = decryptCredentials(blob.ciphertext, blob.iv, 2);
      assert(plaintext.username === "db-user", "username round-trips at version 2");
      assert(plaintext.password === "db-secret", "password round-trips at version 2");
    },
  );
}

/**
 * The rotation window read: a blob written under A, with A now loaded as
 * `PREVIOUS` at version 3, reads back at its stored version 2.
 *
 * **This is the positive control for `runWrongVersionLabelRefusedTests`** — it
 * is what proves the blob below is genuinely decryptable under the loaded
 * previous key, so the refusal there is a refusal and not a broken fixture.
 */
export function runPreviousKeyRoundTripTests(): void {
  const previous = freshKey();
  const current = freshKey();
  withEnv(
    {
      CREDENTIAL_ENCRYPTION_KEY: current.base64,
      CREDENTIAL_ENCRYPTION_KEY_PREVIOUS: previous.base64,
      CREDENTIAL_ENCRYPTION_KEY_VERSION: "3",
    },
    () => {
      const blob = encrypt(previous.bytes, SECRET);
      const plaintext = decryptCredentials(blob.ciphertext, blob.iv, 2);
      assert(plaintext.username === "db-user", "username round-trips under the previous key");
      assert(plaintext.password === "db-secret", "password round-trips under the previous key");
    },
  );
}

/**
 * **Decision 4's guess refusal, in the ingest.** The same blob the function
 * above round-trips at version 2, labelled version 1, must throw.
 *
 * An implementation that tries both loaded keys *succeeds* here, because the
 * previous key's AES-GCM tag verifies — the tag check cannot tell a guess from
 * a selection. So this is the one assertion in this file that distinguishes
 * selection from guessing, and it is the reason `decryptCredentials` calls
 * `keyForVersion` rather than looping.
 *
 * The whole message is pinned rather than probed for substrings: `"1"` alone
 * also appears in `(loaded: 3, 2)` renderings and in a length, so a substring
 * check would pass against a differently-shaped error.
 */
export function runWrongVersionLabelRefusedTests(): void {
  const previous = freshKey();
  const current = freshKey();
  withEnv(
    {
      CREDENTIAL_ENCRYPTION_KEY: current.base64,
      CREDENTIAL_ENCRYPTION_KEY_PREVIOUS: previous.base64,
      CREDENTIAL_ENCRYPTION_KEY_VERSION: "3",
    },
    () => {
      const blob = encrypt(previous.bytes, SECRET);
      const err = thrownBy(
        () => decryptCredentials(blob.ciphertext, blob.iv, 1),
        "a previous-key blob labelled version 1",
      );
      assert(
        nameOf(err) === "CredentialKeyVersionError",
        `an unloaded version is refused by name, got ${nameOf(err)}: ${messageOf(err)}`,
      );
      assert(
        messageOf(err) === "credential key version 1 is not loaded (loaded: 3, 2)",
        `the error names the stored and the loaded versions, got ${messageOf(err)}`,
      );
    },
  );
}

/**
 * The other direction: a blob written under the **current** key, labelled with
 * the previous version, must not be read by falling back to the current key.
 *
 * It throws a cipher error rather than a version error — version 2 is loaded,
 * so `keyForVersion` answers with the previous key and the GCM tag then fails.
 * `name !== "CredentialKeyVersionError"` is what says the selection happened
 * and the *cipher* refused, which is the state a fallback would hide.
 */
export function runCurrentCiphertextLabelledPreviousTests(): void {
  const previous = freshKey();
  const current = freshKey();
  withEnv(
    {
      CREDENTIAL_ENCRYPTION_KEY: current.base64,
      CREDENTIAL_ENCRYPTION_KEY_PREVIOUS: previous.base64,
      CREDENTIAL_ENCRYPTION_KEY_VERSION: "3",
    },
    () => {
      const blob = encrypt(current.bytes, SECRET);
      const err = thrownBy(
        () => decryptCredentials(blob.ciphertext, blob.iv, 2),
        "a current-key blob labelled version 2",
      );
      assert(
        nameOf(err) !== "CredentialKeyVersionError",
        "version 2 is loaded, so the refusal must come from the cipher, not from the version map",
      );
    },
  );
}

/**
 * Decision 9: `credentialSource` is `"db"` only when a credential actually came
 * out of the decrypted blob.
 *
 * `source` stays `"db"` too here, which is the uninteresting half — the two
 * fields agree whenever the row carries a readable credential. The two
 * functions below are where they disagree, and that is the whole point of
 * adding the second field.
 */
export function runDbCredentialSourceTests(): void {
  const key = freshKey();
  withEnv(
    {
      ...MQTT_ENV,
      CREDENTIAL_ENCRYPTION_KEY: key.base64,
      CREDENTIAL_ENCRYPTION_KEY_VERSION: "2",
    },
    () => {
      const blob = encrypt(key.bytes, SECRET);
      const conn = resolveMqttConnection({
        config: { host: "broker.db", port: 1883 },
        credentials_ciphertext: blob.ciphertext,
        credentials_iv: blob.iv,
        key_version: 2,
      });
      assert(conn.username === "db-user", `the stored username wins, got ${String(conn.username)}`);
      assert(conn.password === "db-secret", `the stored password wins, got ${String(conn.password)}`);
      assert(
        conn.credentialSource === "db",
        `a decrypted credential is credentialSource "db", got ${conn.credentialSource}`,
      );
      assert(conn.source === "db", `a config row existed, so source is "db", got ${conn.source}`);
    },
  );
}

/**
 * **Decision 9's exact narrowing.** A config row exists, so `source` is `"db"`
 * — that field names the row's existence and nothing else, and it keeps that
 * meaning. The row stores no ciphertext, so the credential is the environment's
 * and `credentialSource` says `"env"`.
 *
 * This is the disagreement the second field exists for. It reddens when
 * `credentialSource` is derived from the row rather than from the credential —
 * which is what `source` already does, and why reusing it was not an option.
 */
export function runConfigRowWithoutCiphertextTests(): void {
  const key = freshKey();
  withEnv(
    {
      ...MQTT_ENV,
      CREDENTIAL_ENCRYPTION_KEY: key.base64,
      CREDENTIAL_ENCRYPTION_KEY_VERSION: "2",
    },
    () => {
      const conn = resolveMqttConnection({
        config: { host: "broker.db", port: 1883 },
        credentials_ciphertext: null,
        credentials_iv: null,
        key_version: 2,
      });
      assert(conn.host === "broker.db", `the stored host still wins, got ${conn.host}`);
      assert(
        conn.username === "env-user",
        `the credential falls back to the environment, got ${String(conn.username)}`,
      );
      assert(
        conn.credentialSource === "env",
        `no stored credential means credentialSource "env", got ${conn.credentialSource}`,
      );
      assert(
        conn.source === "db",
        `source keeps meaning "a config row existed", got ${conn.source}`,
      );
    },
  );
}

/**
 * A stored credential the process cannot read is the same fail-open case: the
 * environment supplies the credential and `credentialSource` says so.
 *
 * **This is also what gates `isCredentialKeyConfigured`.** With no key
 * configured, an implementation that answered `true` would send `key_version:
 * 2` into `keyForVersion({ currentVersion: 1, current: null, previous: null })`,
 * which throws — so a wrong answer reddens this function by throwing rather
 * than by returning the wrong string.
 */
export function runCiphertextWithoutKeyTests(): void {
  const key = freshKey();
  withEnv({ ...MQTT_ENV }, () => {
    const blob = encrypt(key.bytes, SECRET);
    const conn = resolveMqttConnection({
      config: { host: "broker.db", port: 1883 },
      credentials_ciphertext: blob.ciphertext,
      credentials_iv: blob.iv,
      key_version: 2,
    });
    assert(
      conn.username === "env-user",
      `an unreadable credential falls back to the environment, got ${String(conn.username)}`,
    );
    assert(
      conn.credentialSource === "env",
      `an unconfigured key means credentialSource "env", got ${conn.credentialSource}`,
    );
    assert(conn.source === "db", `a config row existed, so source is "db", got ${conn.source}`);
  });
}

/**
 * A row labelled with a version no loaded key writes is refused, and the
 * refusal escapes `resolveMqttConnection` — `planEndpoints` is what turns it
 * into one skipped RTU with `detail: "key-version-not-loaded"`.
 *
 * Reddens when the stored version is ignored and the current key is used
 * regardless: the blob was written under that very key, so a resolver that
 * ignores `key_version` returns successfully here.
 */
export function runUnknownStoredVersionRefusedTests(): void {
  const key = freshKey();
  withEnv(
    {
      ...MQTT_ENV,
      CREDENTIAL_ENCRYPTION_KEY: key.base64,
      CREDENTIAL_ENCRYPTION_KEY_VERSION: "2",
    },
    () => {
      const blob = encrypt(key.bytes, SECRET);
      const err = thrownBy(
        () =>
          resolveMqttConnection({
            config: { host: "broker.db", port: 1883 },
            credentials_ciphertext: blob.ciphertext,
            credentials_iv: blob.iv,
            key_version: 9,
          }),
        "a row stored at key version 9",
      );
      assert(
        nameOf(err) === "CredentialKeyVersionError",
        `an unloaded stored version is refused by name, got ${nameOf(err)}: ${messageOf(err)}`,
      );
      assert(
        messageOf(err) === "credential key version 9 is not loaded (loaded: 2)",
        `the error names the stored and the loaded versions, got ${messageOf(err)}`,
      );
    },
  );
}
