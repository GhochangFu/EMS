/**
 * The credential encryption key window (`E8.4`, ADR 0062 decisions 1, 2, 4
 * and 5, with Amendment 1).
 *
 * **Two keys, one current.** `CREDENTIAL_ENCRYPTION_KEY` encrypts and decrypts
 * at `CREDENTIAL_ENCRYPTION_KEY_VERSION` (default `1`);
 * `CREDENTIAL_ENCRYPTION_KEY_PREVIOUS` decrypts only, at that version minus
 * one. Both `CredentialCryptoService` (`apps/api`) and `rtu-config.js`
 * (`apps/ingest`) select a key through this module and nowhere else — two
 * copies of a pin drift harmlessly, two copies of a rotation window disagree
 * about which key reads which row (decision 2).
 *
 * **Why the shape is what it is.** `packages/shared` has no `@types/node`, and
 * `apps/web` bundles the barrel. So the resolver takes `env` as a parameter
 * rather than reading `process.env`, takes an injected base64 decoder rather
 * than calling `Buffer.from`, and works over `Uint8Array`. The API passes
 * `(s) => Buffer.from(s, "base64")`; the ingest does the same.
 *
 * **Two import routes, one file.** `apps/api` compiles with
 * `moduleResolution: "node"` (node10) and ignores the `exports` map, so it
 * imports from the barrel; the ingest (NodeNext) imports
 * `@bms/shared/credential-keys`. The same reason `./ingest` is re-exported
 * from `./index`.
 *
 * **No path tries a second key (decision 4).** `keyForVersion` maps a stored
 * version to exactly one key or throws `CredentialKeyVersionError`. An AES-GCM
 * tag check would make a guess *work*, and a rotation that silently accepts an
 * unknown version can never report that it has finished.
 *
 * **Key bytes and key strings never reach an error message.** The version
 * parse echoes its value (not a secret); the key parse reports a length only.
 */

export const CREDENTIAL_KEY_ENV = {
  current: "CREDENTIAL_ENCRYPTION_KEY",
  previous: "CREDENTIAL_ENCRYPTION_KEY_PREVIOUS",
  version: "CREDENTIAL_ENCRYPTION_KEY_VERSION",
} as const;

/** AES-256-GCM: the key is 32 bytes, in both applications. */
export const CREDENTIAL_KEY_BYTES = 32;

/** The slice of `process.env` the resolver reads — a parameter, never a global. */
export type CredentialKeyEnv = { readonly [name: string]: string | undefined };

/** Injected by the caller; `Buffer.from(s, "base64")` in both applications. */
export type Base64Decoder = (base64: string) => Uint8Array;

export type LoadedCredentialKeys = {
  /** `>= 1`; defaults to `1`; present even when `current` is null. */
  readonly currentVersion: number;
  /** `null` means unconfigured — every fail-closed path already handles it. */
  readonly current: Uint8Array | null;
  /** `null` means no rotation window is open. */
  readonly previous: Uint8Array | null;
};

/**
 * Dead configuration: a malformed version, a key of the wrong length, a
 * previous key at version 0, or a previous key with no current key. Both
 * applications refuse to boot on it (decision 5, Amendment 1).
 */
export class CredentialKeyConfigError extends Error {
  override readonly name = "CredentialKeyConfigError";
}

/**
 * A stored version this window cannot read. Carries the stored value and the
 * versions that are loaded, as integers — never the bytes.
 */
export class CredentialKeyVersionError extends Error {
  override readonly name = "CredentialKeyVersionError";

  constructor(
    readonly storedVersion: unknown,
    readonly loadedVersions: readonly number[],
  ) {
    super(
      `credential key version ${describeStoredVersion(storedVersion)} is not loaded ` +
        `(loaded: ${loadedVersions.join(", ")})`,
    );
  }
}

/**
 * Renders a stored version for the error message without ever dumping an
 * object: a `Uint8Array` passed by mistake would otherwise print its bytes.
 */
function describeStoredVersion(value: unknown): string {
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "number":
    case "bigint":
    case "boolean":
    case "undefined":
      return String(value);
    default:
      return value === null ? "null" : `<${typeof value}>`;
  }
}

/** An empty string is unset — compose passes `${VAR:-}` for an absent variable. */
function readSet(env: CredentialKeyEnv, name: string): string | null {
  const value = env[name];
  return value === undefined || value === "" ? null : value;
}

function parseVersion(raw: string): number {
  const value = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new CredentialKeyConfigError(
      `${CREDENTIAL_KEY_ENV.version} must be a positive integer, got ${JSON.stringify(raw)}`,
    );
  }
  return value;
}

function decodeKey(name: string, raw: string, decode: Base64Decoder): Uint8Array {
  const bytes = decode(raw);
  if (bytes.length !== CREDENTIAL_KEY_BYTES) {
    throw new CredentialKeyConfigError(
      `${name} must decode to ${CREDENTIAL_KEY_BYTES} bytes (base64), got ${bytes.length}`,
    );
  }
  return bytes;
}

/**
 * Parses the three variables into a key window. Throws
 * `CredentialKeyConfigError` on dead configuration; an unset current key is
 * *not* dead — it is unconfigured, and `current` is `null`.
 */
export function resolveCredentialKeys(env: CredentialKeyEnv, decode: Base64Decoder): LoadedCredentialKeys {
  const rawVersion = readSet(env, CREDENTIAL_KEY_ENV.version);
  const currentVersion = rawVersion === null ? 1 : parseVersion(rawVersion);

  const rawCurrent = readSet(env, CREDENTIAL_KEY_ENV.current);
  const current = rawCurrent === null ? null : decodeKey(CREDENTIAL_KEY_ENV.current, rawCurrent, decode);

  const rawPrevious = readSet(env, CREDENTIAL_KEY_ENV.previous);
  if (rawPrevious === null) {
    return { currentVersion, current, previous: null };
  }
  const previous = decodeKey(CREDENTIAL_KEY_ENV.previous, rawPrevious, decode);
  if (currentVersion === 1) {
    // Decision 5: the previous key would be version 0, and no row can hold
    // version 0. The likeliest cause is a rotation whose version bump was
    // forgotten.
    throw new CredentialKeyConfigError(
      `${CREDENTIAL_KEY_ENV.previous} is set while ${CREDENTIAL_KEY_ENV.version} is 1, ` +
        "which makes the previous key version 0 and no row can hold version 0; " +
        `set ${CREDENTIAL_KEY_ENV.version} to the version the current key writes`,
    );
  }
  if (current === null) {
    // Amendment 1: the two names were most likely swapped, and a process that
    // can decrypt but not encrypt is a half-done rotation.
    throw new CredentialKeyConfigError(
      `${CREDENTIAL_KEY_ENV.previous} is set while ${CREDENTIAL_KEY_ENV.current} is unset; ` +
        "a window with no current key can decrypt but never encrypt",
    );
  }
  return { currentVersion, current, previous };
}

/** The versions this window can read, current first — what the version error reports. */
export function loadedKeyVersions(keys: LoadedCredentialKeys): readonly number[] {
  return keys.previous === null ? [keys.currentVersion] : [keys.currentVersion, keys.currentVersion - 1];
}

/**
 * The one key a stored version maps to. The current version selects the
 * current key; the current version minus one selects the previous key when
 * one is loaded; anything else — including `null`, `NaN` and a numeric string
 * — throws `CredentialKeyVersionError`. There is no second attempt.
 */
export function keyForVersion(keys: LoadedCredentialKeys, storedVersion: unknown): Uint8Array {
  if (typeof storedVersion !== "number" || !Number.isSafeInteger(storedVersion)) {
    throw new CredentialKeyVersionError(storedVersion, loadedKeyVersions(keys));
  }
  if (storedVersion === keys.currentVersion) {
    if (keys.current === null) {
      throw new CredentialKeyConfigError(`${CREDENTIAL_KEY_ENV.current} is required`);
    }
    return keys.current;
  }
  if (storedVersion === keys.currentVersion - 1 && keys.previous !== null) {
    return keys.previous;
  }
  throw new CredentialKeyVersionError(storedVersion, loadedKeyVersions(keys));
}
