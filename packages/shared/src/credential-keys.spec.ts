import {
  type Base64Decoder,
  type CredentialKeyEnv,
  type LoadedCredentialKeys,
  keyForVersion,
  loadedKeyVersions,
  resolveCredentialKeys,
} from "./credential-keys";

/**
 * `E8.4` / ADR 0062 decisions 1, 2, 4 and 5 (with Amendment 1) — the one
 * credential key resolver both `CredentialCryptoService` and the ingest's
 * `rtu-config.js` select a key through.
 *
 * Assertions live here; `credential-keys.test.ts` is the vitest entry point
 * (ADR 0014), one `it()` per exported function — `assert` throws, so two rows
 * in one `it()` would let only the first redden.
 *
 * Nothing here touches `Buffer`, `atob` or `process`: `packages/shared` has no
 * `@types/node`, so the decoder is a lookup table and the env is a literal.
 * Errors are matched on `err.name`, never `instanceof` — vitest can load two
 * module instances (`F4.108`).
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** Element-by-element; a length match alone would pass a zero-filled key. */
function sameBytes(actual: Uint8Array | null, expected: Uint8Array, message: string): void {
  assert(actual !== null, `${message} — got null`);
  if (actual === null) return;
  assert(actual.length === expected.length, `${message} — length ${actual.length}, expected ${expected.length}`);
  for (let i = 0; i < expected.length; i += 1) {
    assert(actual[i] === expected[i], `${message} — byte ${i} is ${actual[i]}, expected ${expected[i]}`);
  }
}

type ThrownShape = {
  readonly name?: unknown;
  readonly message?: unknown;
  readonly storedVersion?: unknown;
  readonly loadedVersions?: unknown;
};

/** Runs `fn`, returns what it threw, and fails when it threw nothing. */
function thrownBy(fn: () => unknown, what: string): ThrownShape {
  try {
    fn();
  } catch (err) {
    if (typeof err === "object" && err !== null) return err as ThrownShape;
    throw new Error(`${what} threw a non-object: ${String(err)}`);
  }
  throw new Error(`expected ${what} to throw`);
}

function messageOf(err: ThrownShape): string {
  return String(err.message);
}

/**
 * The decoder table. Real base64 never enters the spec, so no Node global is
 * needed; the resolver only ever sees the bytes.
 */
const decode: Base64Decoder = (base64) => {
  if (base64 === "alpha") return new Uint8Array(32).fill(0x01);
  if (base64 === "beta") return new Uint8Array(32).fill(0x02);
  if (base64 === "short") return new Uint8Array(16);
  return new Uint8Array(0);
};

/**
 * The three variable names are written literally here, not read from
 * `CREDENTIAL_KEY_ENV`: compose sets these exact names, so a renamed constant
 * must redden the positive control below rather than stay self-consistent.
 */
function env(vars: { key?: string; previous?: string; version?: string }): CredentialKeyEnv {
  const out: Record<string, string | undefined> = {};
  if (vars.key !== undefined) out.CREDENTIAL_ENCRYPTION_KEY = vars.key;
  if (vars.previous !== undefined) out.CREDENTIAL_ENCRYPTION_KEY_PREVIOUS = vars.previous;
  if (vars.version !== undefined) out.CREDENTIAL_ENCRYPTION_KEY_VERSION = vars.version;
  return out;
}

/** A loaded two-key window: version 3 writes with alpha, version 2 reads with beta. */
function twoKeyWindow(): LoadedCredentialKeys {
  return { currentVersion: 3, current: decode("alpha"), previous: decode("beta") };
}

// ── resolveCredentialKeys ───────────────────────────────────────────────────

/** Reddens when the default version is not 1. */
export function runUnsetEnvTests(): void {
  const keys = resolveCredentialKeys({}, decode);
  assert(keys.currentVersion === 1, `unset VERSION defaults to 1, got ${keys.currentVersion}`);
  assert(keys.current === null, "unset KEY is an unconfigured current slot");
  assert(keys.previous === null, "unset PREVIOUS is no rotation window");
}

/** Reddens when the empty-string check is dropped — compose passes `${VAR:-}`. */
export function runEmptyStringIsUnsetTests(): void {
  const keys = resolveCredentialKeys(env({ key: "", previous: "", version: "" }), decode);
  assert(keys.currentVersion === 1, `empty VERSION reads as unset (1), got ${keys.currentVersion}`);
  assert(keys.current === null, "empty KEY reads as unset");
  assert(keys.previous === null, "empty PREVIOUS reads as unset");
}

/**
 * Positive control for the decoder wiring. Reddens when the resolver returns
 * a fixed key or ignores the env — the bytes are compared element by element.
 */
export function runCurrentKeyPositiveControlTests(): void {
  const keys = resolveCredentialKeys(env({ key: "alpha" }), decode);
  sameBytes(keys.current, decode("alpha"), "KEY=alpha decodes through the injected decoder");
  assert(keys.previous === null, "no PREVIOUS means no previous key");
  assert(keys.currentVersion === 1, `KEY alone still defaults the version to 1, got ${keys.currentVersion}`);
}

/** Reddens when the previous key is ignored or the version is not parsed. */
export function runPreviousKeyAndVersionTests(): void {
  const keys = resolveCredentialKeys(env({ key: "alpha", previous: "beta", version: "3" }), decode);
  assert(keys.currentVersion === 3, `VERSION=3 is parsed as 3, got ${keys.currentVersion}`);
  sameBytes(keys.previous, decode("beta"), "PREVIOUS=beta decodes into the previous slot");
  sameBytes(keys.current, decode("alpha"), "KEY=alpha still decodes into the current slot");
}

/**
 * Table. Reddens when the digit regex or the `>= 1` bound is dropped. The
 * failing input is in the assertion message because a loop of asserts reddens
 * on its first failing input only.
 */
export function runVersionRejectionTableTests(): void {
  for (const version of ["0", "-1", "abc", "1e3", "1.5"]) {
    const err = thrownBy(
      () => resolveCredentialKeys(env({ key: "alpha", version }), decode),
      `resolveCredentialKeys with VERSION=${JSON.stringify(version)}`,
    );
    assert(
      err.name === "CredentialKeyConfigError",
      `VERSION=${JSON.stringify(version)} throws CredentialKeyConfigError, got ${String(err.name)}`,
    );
    assert(
      messageOf(err).includes("CREDENTIAL_ENCRYPTION_KEY_VERSION"),
      `VERSION=${JSON.stringify(version)} names the variable: ${messageOf(err)}`,
    );
  }
}

/** Reddens when the current-key length check is dropped (ADR 0062 Amendment 1, ruling 1). */
export function runCurrentKeyLengthTests(): void {
  const err = thrownBy(() => resolveCredentialKeys(env({ key: "short" }), decode), "KEY=short");
  assert(err.name === "CredentialKeyConfigError", `KEY=short throws CredentialKeyConfigError, got ${String(err.name)}`);
  assert(messageOf(err).includes("32 bytes"), `the message names the required length: ${messageOf(err)}`);
}

/** Reddens when the previous-key length check is dropped (decision 5). */
export function runPreviousKeyLengthTests(): void {
  const err = thrownBy(
    () => resolveCredentialKeys(env({ key: "alpha", previous: "short", version: "2" }), decode),
    "PREVIOUS=short",
  );
  assert(
    err.name === "CredentialKeyConfigError",
    `PREVIOUS=short throws CredentialKeyConfigError, got ${String(err.name)}`,
  );
  assert(messageOf(err).includes("32 bytes"), `the message names the required length: ${messageOf(err)}`);
}

/**
 * Reddens when decision 5's version-0 guard is dropped.
 * `runPreviousKeyAndVersionTests` is its positive control: the same two keys
 * with VERSION=3 load.
 */
export function runVersionZeroWindowTests(): void {
  const err = thrownBy(
    () => resolveCredentialKeys(env({ key: "alpha", previous: "beta" }), decode),
    "PREVIOUS set with VERSION unset",
  );
  assert(
    err.name === "CredentialKeyConfigError",
    `a previous key at version 0 throws CredentialKeyConfigError, got ${String(err.name)}`,
  );
  assert(messageOf(err).includes("version 0"), `the message names version 0: ${messageOf(err)}`);
}

/**
 * Reddens when ruling 2 (ADR 0062 Amendment 1) is dropped. The fixture carries
 * VERSION=2 on purpose: with VERSION unset the version-0 guard above fires
 * first and would hide this one, so the plan's `PREVIOUS=beta alone` fixture
 * could not redden on ruling 2. The negative check on `version 0` is what
 * proves the refusal reached is this one.
 */
export function runPreviousWithoutCurrentTests(): void {
  const err = thrownBy(
    () => resolveCredentialKeys(env({ previous: "beta", version: "2" }), decode),
    "PREVIOUS set with KEY unset",
  );
  assert(
    err.name === "CredentialKeyConfigError",
    `PREVIOUS without KEY throws CredentialKeyConfigError, got ${String(err.name)}`,
  );
  assert(
    !messageOf(err).includes("version 0"),
    `the refusal is ruling 2's, not decision 5's: ${messageOf(err)}`,
  );
  assert(
    messageOf(err).includes("CREDENTIAL_ENCRYPTION_KEY_PREVIOUS"),
    `the message names the previous variable: ${messageOf(err)}`,
  );
}

// ── loadedKeyVersions ───────────────────────────────────────────────────────

/**
 * Reddens when the list includes `v - 1` with no previous key — the version
 * error's `loaded:` clause would then lie about what can be read.
 */
export function runLoadedKeyVersionsTests(): void {
  const withPrevious = JSON.stringify(loadedKeyVersions(twoKeyWindow()));
  assert(withPrevious === "[3,2]", `a two-key window lists [3,2], got ${withPrevious}`);
  const withoutPrevious = JSON.stringify(
    loadedKeyVersions({ currentVersion: 3, current: decode("alpha"), previous: null }),
  );
  assert(withoutPrevious === "[3]", `no previous key lists [3] only, got ${withoutPrevious}`);
}

// ── keyForVersion ───────────────────────────────────────────────────────────

/** Reddens when the slots are swapped: the current version must return the current key. */
export function runKeyForCurrentVersionTests(): void {
  sameBytes(keyForVersion(twoKeyWindow(), 3), decode("alpha"), "version 3 selects the current key");
}

/** Reddens when the slots are swapped: `current - 1` must return the previous key. */
export function runKeyForPreviousVersionTests(): void {
  sameBytes(keyForVersion(twoKeyWindow(), 2), decode("beta"), "version 2 selects the previous key");
}

/**
 * Reddens when an unknown lower version falls through to the previous key —
 * decision 4's guess refusal. The message is pinned whole so the format
 * `credential key version <stored> is not loaded (loaded: <a, b>)` holds.
 */
export function runUnknownLowerVersionTests(): void {
  const err = thrownBy(() => keyForVersion(twoKeyWindow(), 1), "keyForVersion(window, 1)");
  assert(err.name === "CredentialKeyVersionError", `version 1 throws CredentialKeyVersionError, got ${String(err.name)}`);
  assert(err.storedVersion === 1, `storedVersion is the input 1, got ${String(err.storedVersion)}`);
  assert(
    JSON.stringify(err.loadedVersions) === "[3,2]",
    `loadedVersions is [3,2], got ${JSON.stringify(err.loadedVersions)}`,
  );
  assert(
    messageOf(err) === "credential key version 1 is not loaded (loaded: 3, 2)",
    `the message names the stored and loaded versions: ${messageOf(err)}`,
  );
}

/** Reddens when an unknown higher version falls through to the current key. */
export function runUnknownHigherVersionTests(): void {
  const err = thrownBy(() => keyForVersion(twoKeyWindow(), 4), "keyForVersion(window, 4)");
  assert(err.name === "CredentialKeyVersionError", `version 4 throws CredentialKeyVersionError, got ${String(err.name)}`);
  assert(err.storedVersion === 4, `storedVersion is the input 4, got ${String(err.storedVersion)}`);
  assert(
    JSON.stringify(err.loadedVersions) === "[3,2]",
    `loadedVersions is [3,2], got ${JSON.stringify(err.loadedVersions)}`,
  );
}

/**
 * Table. Reddens when a loose comparison or a `Number()` coercion lets a
 * non-integer through. NaN makes every `===` false, so a guard that looks
 * correct can still be reached by it — this row asserts it rather than
 * reasoning about it. The input is in every assertion message.
 */
export function runNonIntegerVersionTableTests(): void {
  const inputs: readonly unknown[] = [null, Number.NaN, "3"];
  for (const input of inputs) {
    const label = typeof input === "string" ? JSON.stringify(input) : String(input);
    const err = thrownBy(() => keyForVersion(twoKeyWindow(), input), `keyForVersion(window, ${label})`);
    assert(
      err.name === "CredentialKeyVersionError",
      `storedVersion ${label} throws CredentialKeyVersionError, got ${String(err.name)}`,
    );
    assert(
      Object.is(err.storedVersion, input),
      `storedVersion ${label} is carried uncoerced, got ${String(err.storedVersion)}`,
    );
  }
}

/** Reddens when an unconfigured current slot returns `null` instead of refusing. */
export function runUnconfiguredCurrentTests(): void {
  const err = thrownBy(
    () => keyForVersion({ currentVersion: 1, current: null, previous: null }, 1),
    "keyForVersion(unconfigured, 1)",
  );
  assert(
    err.name === "CredentialKeyConfigError",
    `an unconfigured current key throws CredentialKeyConfigError, got ${String(err.name)}`,
  );
  assert(messageOf(err).includes("is required"), `the message is today's: ${messageOf(err)}`);
}

/** Reddens when `previous === null` is not checked before the `v - 1` branch. */
export function runNoPreviousKeyTests(): void {
  const err = thrownBy(
    () => keyForVersion({ currentVersion: 3, current: decode("alpha"), previous: null }, 2),
    "keyForVersion(no previous, 2)",
  );
  assert(
    err.name === "CredentialKeyVersionError",
    `version 2 with no previous key throws CredentialKeyVersionError, got ${String(err.name)}`,
  );
  assert(
    JSON.stringify(err.loadedVersions) === "[3]",
    `loadedVersions is [3], got ${JSON.stringify(err.loadedVersions)}`,
  );
  assert(
    messageOf(err) === "credential key version 2 is not loaded (loaded: 3)",
    `the message does not claim version 2 is loaded: ${messageOf(err)}`,
  );
}
