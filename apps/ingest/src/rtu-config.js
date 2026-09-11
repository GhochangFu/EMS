import { createDecipheriv } from "node:crypto";

import {
  keyForVersion,
  resolveCredentialKeys,
} from "@bms/shared/credential-keys";

/**
 * The ADR 0012 credential seam for the ingest host (`E8.4`, ADR 0062
 * decisions 2, 4 and 9).
 *
 * **The cipher stays here; the key selection does not** (decision 2). This
 * process never constructs `CredentialCryptoService` — it is a standalone Node
 * host with its own dependency list — so its AES-GCM implementation below is
 * deliberately a second copy of the API's. What may *not* be duplicated is the
 * key window: two copies of a pin drift harmlessly, two copies of a rotation
 * window disagree about which key reads which row. So
 * `@bms/shared/credential-keys` resolves the window and maps a stored version
 * to exactly one key, in both applications.
 *
 * **The subpath import, not the barrel.** `apps/ingest` compiles with
 * `moduleResolution: "NodeNext"`, which honours the `exports` map;
 * `apps/api` is node10 and ignores it, which is why that side imports from
 * `@bms/shared` instead. One file, two routes.
 *
 * **Everything here is JSDoc-typed on purpose.** `main.ts` forwards to
 * `decryptCredentials` and hands `resolveMqttConnection` to `planEndpoints`,
 * and JSDoc parameters make those calls arity- and shape-checked from
 * TypeScript even with `checkJs: false` — a dropped third argument is
 * `TS2554: Expected 3 arguments, but got 2` at `pnpm typecheck:tests` rather
 * than a credential silently decrypted under the wrong key. That gate is why
 * the assertions moved to `rtu-config.spec.ts` and `rtu-config.test.js` was
 * deleted (plan ruling 4): a `.js` spec is type-checked by nothing.
 */

const TAG_LENGTH = 16;

/**
 * `packages/shared` has no `@types/node` reachable, so the resolver works over
 * `Uint8Array` and takes its base64 decoder from the caller. This is the
 * ingest's half; `credential-crypto.service.ts` injects the same one.
 *
 * @type {import("@bms/shared/credential-keys").Base64Decoder}
 */
const decode = (value) => Buffer.from(value, "base64");

/**
 * One RTU's `rtu_connection_configs` row, as `BINDING_QUERY` returns it.
 *
 * @typedef {{
 *   config?: unknown,
 *   credentials_ciphertext?: Buffer | null,
 *   credentials_iv?: Buffer | null,
 *   key_version?: number | null,
 * }} RtuConfigRow
 */

/**
 * What one endpoint connects with, and where each half of it came from.
 *
 * @typedef {{
 *   host: string,
 *   port: number,
 *   username: string | undefined,
 *   password: string | undefined,
 *   source: "db" | "env",
 *   credentialSource: "db" | "env",
 * }} MqttConnection
 */

/**
 * True when a current key is loaded.
 *
 * Swallows a **dead** window and answers `false` rather than throwing, matching
 * `CredentialCryptoService.isConfigured()`. That is safe here for the same
 * reason it is safe there: `readHostConfig` calls the resolver at startup, so a
 * dead window has already refused the boot and can never reach this function in
 * a running host.
 *
 * @returns {boolean}
 */
export function isCredentialKeyConfigured() {
  try {
    return resolveCredentialKeys(process.env, decode).current !== null;
  } catch {
    return false;
  }
}

/**
 * Decrypts AES-256-GCM credentials **at the version they were stored under**
 * (decision 4).
 *
 * `keyVersion` is the value the row holds. The current version selects the
 * current key, the current version minus one selects the previous key, and
 * anything else throws `CredentialKeyVersionError`. There is no second attempt
 * with the other key: an AES-GCM tag check would make a guess *work*, so a
 * process that tries both cannot tell a rotated row from a correct one, and a
 * rotation that silently accepts an unknown version can never report that it
 * has finished.
 *
 * @param {Buffer} ciphertext AES-GCM ciphertext with the 16-byte tag appended.
 * @param {Buffer} iv
 * @param {number | null} keyVersion `rtu_connection_configs.key_version`.
 * @returns {Record<string, unknown>}
 */
export function decryptCredentials(ciphertext, iv, keyVersion) {
  const key = keyForVersion(resolveCredentialKeys(process.env, decode), keyVersion);
  const encrypted = ciphertext.subarray(0, ciphertext.length - TAG_LENGTH);
  const tag = ciphertext.subarray(ciphertext.length - TAG_LENGTH);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return JSON.parse(decrypted.toString("utf8"));
}

/**
 * Resolves MQTT connection options from per-RTU config or global env.
 *
 * **`source` and `credentialSource` are two different questions, and decision 9
 * narrows the first rather than reinterpreting it.**
 *
 * - `source` reports **whether a config row existed**, and nothing else. It has
 *   always meant that: `host` and `port` fall back to the environment inside
 *   the same `"db"` branch, so it never described where the connection settings
 *   came from. Its meaning is unchanged; this docblock is what was missing.
 * - `credentialSource` reports where the **credential** came from, and is
 *   `"db"` only when a username or a password was actually read out of the
 *   decrypted blob. A config row that stores no ciphertext, or one this process
 *   holds no key for, therefore reports `source: "db"` with
 *   `credentialSource: "env"` — which is the fail-open case, and the host warns
 *   on exactly that pair.
 *
 * `MQTT_USERNAME`/`MQTT_PASSWORD` stay as the fallback (decision 10):
 * `rtu_connection_configs` still holds 0 rows, so they remain the pilot's only
 * working credential path. Decision 9 makes the fallback honest, which is the
 * part that does not depend on the data.
 *
 * @param {RtuConfigRow | null} configRow
 * @returns {MqttConnection}
 */
export function resolveMqttConnection(configRow) {
  const globalHost = process.env.MQTT_HOST ?? "phe.thinkiot.co.in";
  const globalPort = Number(process.env.MQTT_PORT ?? "8883");
  const globalUser = process.env.MQTT_USERNAME;
  const globalPass = process.env.MQTT_PASSWORD;

  if (!configRow) {
    return {
      host: globalHost,
      port: globalPort,
      username: globalUser,
      password: globalPass,
      source: "env",
      credentialSource: "env",
    };
  }

  const cfg = configRow.config ?? {};
  let username = globalUser;
  let password = globalPass;
  /** @type {"db" | "env"} */
  let credentialSource = "env";
  if (
    configRow.credentials_ciphertext &&
    configRow.credentials_iv &&
    isCredentialKeyConfigured()
  ) {
    const creds = decryptCredentials(
      configRow.credentials_ciphertext,
      configRow.credentials_iv,
      configRow.key_version ?? null,
    );
    if (typeof creds.username === "string") {
      username = creds.username;
      credentialSource = "db";
    }
    if (typeof creds.password === "string") {
      password = creds.password;
      credentialSource = "db";
    }
  }

  return {
    host: typeof cfg.host === "string" ? cfg.host : globalHost,
    port: typeof cfg.port === "number" ? cfg.port : globalPort,
    username,
    password,
    source: "db",
    credentialSource,
  };
}
