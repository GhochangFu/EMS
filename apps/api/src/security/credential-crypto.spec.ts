import { randomBytes } from "node:crypto";

import { CredentialCryptoService } from "./credential-crypto.service";

/**
 * `E8.4` / ADR 0062 decisions 3, 4 and 5 (with Amendment 1) —
 * `CredentialCryptoService` stamps the configured version, selects a key by the
 * stored version, and refuses to construct on a dead key window.
 *
 * Assertions live here; `credential-crypto.test.ts` is the vitest entry point
 * (ADR 0014), one `it()` per exported function — `assert` throws, so two claims
 * in one `it()` would let only the first redden.
 *
 * **Every function generates its own keys and constructs the service after it
 * has set the environment.** A module-scope service, or a ciphertext shared
 * between functions, would hide the whole read-at-construction-versus-per-call
 * mutation class: the resolver is called on *every* `encrypt`/`decrypt`/
 * `isConfigured`/`currentKeyVersion`, because specs elsewhere in this repo
 * mutate `process.env` after they have constructed the service
 * (`channels.service.spec.ts:247-292` is one).
 *
 * **Measured, not reasoned about.** Mutating the service to cache the window in
 * the constructor and read it from `this` in `encrypt`/`decrypt` reddens
 * `runPreviousKeyRoundTripTests` only on its *last* assertion — the same
 * instance re-encrypting at the new current version — and reddens
 * `runWrongVersionLabelRefusedTests` on the whole-message pin, because a stale
 * window reports `(loaded: 2)` where a fresh one reports `(loaded: 3, 2)`. The
 * previous-key round trip alone does **not** catch it: version 2 is the cached
 * window's current version and selects the same key.
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
] as const;

type CredentialEnv = { readonly [name in (typeof ENV_NAMES)[number]]?: string };

/** Sets exactly the named variables and unsets the three that are absent. */
function applyEnv(env: CredentialEnv): void {
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
 * Saves all three variables, applies `env`, and restores them in a `finally` —
 * so a function may call `applyEnv` again inside `body` to move the window
 * mid-test without leaking either window into the next `it()`.
 */
function withEnv(env: CredentialEnv, body: () => void): void {
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
    if (typeof err === "object" && err !== null) return err as ThrownShape;
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

function freshKey(): string {
  return randomBytes(32).toString("base64");
}

const SECRET = { username: "u", password: "p" };

function assertRoundTrip(actual: Record<string, unknown>, what: string): void {
  assert(actual.username === "u", `${what} — username round-trip`);
  assert(actual.password === "p", `${what} — password round-trip`);
}

/**
 * The original ADR 0012 round trip, updated for decision 4's third argument:
 * the payload's own `keyVersion` is what reads it back.
 */
export function runCredentialCryptoTests(): void {
  withEnv({ CREDENTIAL_ENCRYPTION_KEY: freshKey() }, () => {
    const svc = new CredentialCryptoService();
    const enc = svc.encrypt(SECRET);
    assertRoundTrip(svc.decrypt(enc.ciphertext, enc.iv, enc.keyVersion), "round trip");
    assert(CredentialCryptoService.isConfigured(), "isConfigured true");
    delete process.env.CREDENTIAL_ENCRYPTION_KEY;
    assert(!CredentialCryptoService.isConfigured(), "isConfigured false when unset");
  });
}

/**
 * Decision 3: the version is configuration, never a literal. Reddens when the
 * deleted `private readonly keyVersion = 1` pin comes back.
 */
export function runEncryptStampsConfiguredVersionTests(): void {
  withEnv({ CREDENTIAL_ENCRYPTION_KEY: freshKey(), CREDENTIAL_ENCRYPTION_KEY_VERSION: "3" }, () => {
    const svc = new CredentialCryptoService();
    const enc = svc.encrypt(SECRET);
    assert(enc.keyVersion === 3, `encrypt stamps VERSION=3, got ${enc.keyVersion}`);
    assertRoundTrip(svc.decrypt(enc.ciphertext, enc.iv, 3), "version 3");
  });
}

/** Reddens when the static reads a literal instead of the resolver. */
export function runCurrentKeyVersionFromEnvTests(): void {
  withEnv({ CREDENTIAL_ENCRYPTION_KEY: freshKey(), CREDENTIAL_ENCRYPTION_KEY_VERSION: "5" }, () => {
    const actual = CredentialCryptoService.currentKeyVersion();
    assert(actual === 5, `currentKeyVersion with VERSION=5, got ${actual}`);
  });
}

/**
 * The default the whole installed base is at: no `CREDENTIAL_ENCRYPTION_KEY_VERSION`
 * means version 1, and `currentKeyVersion()` answers it without a key loaded —
 * `onboarding-commit.service.ts` calls it on the branch that stores no ciphertext.
 */
export function runCurrentKeyVersionDefaultTests(): void {
  withEnv({}, () => {
    const actual = CredentialCryptoService.currentKeyVersion();
    assert(actual === 1, `currentKeyVersion with VERSION unset, got ${actual}`);
  });
}

/**
 * Decision 4's read half, and the **positive control** for the two functions
 * below: a blob written under the old key is genuinely decryptable once that
 * key is loaded as `PREVIOUS`, so when they assert a throw the throw is about
 * the label and not about an undecryptable blob.
 *
 * Its **last** assertion is the direct gate on the per-call resolver read: the
 * instance was constructed under the version-2 window and must nonetheless
 * encrypt at version 3 once the window has moved. The `decrypt` above it does
 * not gate that — a cached window still selects key A for version 2 — so
 * without the re-encrypt the per-call claim would rest only on the message
 * format pinned two functions down.
 */
export function runPreviousKeyRoundTripTests(): void {
  const keyA = freshKey();
  const keyB = freshKey();
  withEnv({ CREDENTIAL_ENCRYPTION_KEY: keyA, CREDENTIAL_ENCRYPTION_KEY_VERSION: "2" }, () => {
    const svc = new CredentialCryptoService();
    const enc = svc.encrypt(SECRET);
    assert(enc.keyVersion === 2, `encrypt stamps VERSION=2, got ${enc.keyVersion}`);
    applyEnv({
      CREDENTIAL_ENCRYPTION_KEY: keyB,
      CREDENTIAL_ENCRYPTION_KEY_PREVIOUS: keyA,
      CREDENTIAL_ENCRYPTION_KEY_VERSION: "3",
    });
    assertRoundTrip(svc.decrypt(enc.ciphertext, enc.iv, 2), "previous key, same instance");
    const rotated = svc.encrypt(SECRET);
    assert(
      rotated.keyVersion === 3,
      `the instance built under version 2 must encrypt at the new version 3, got ${rotated.keyVersion}`,
    );
  });
}

/**
 * **Decision 4's guess refusal, and the most load-bearing assertion in this
 * file.** The blob was written under key A, which is loaded as the previous
 * key — so an implementation that *tries both keys* succeeds here, because A's
 * GCM tag verifies. Only a version-first selection throws.
 *
 * The in-function control runs first: version 2 must round-trip before version
 * 1 is asserted to throw, or the throw could be about a corrupt blob.
 *
 * The whole message is pinned, not a substring — Task 1 fixed this format.
 */
export function runWrongVersionLabelRefusedTests(): void {
  const keyA = freshKey();
  const keyB = freshKey();
  withEnv({ CREDENTIAL_ENCRYPTION_KEY: keyA, CREDENTIAL_ENCRYPTION_KEY_VERSION: "2" }, () => {
    const svc = new CredentialCryptoService();
    const enc = svc.encrypt(SECRET);
    applyEnv({
      CREDENTIAL_ENCRYPTION_KEY: keyB,
      CREDENTIAL_ENCRYPTION_KEY_PREVIOUS: keyA,
      CREDENTIAL_ENCRYPTION_KEY_VERSION: "3",
    });
    assertRoundTrip(svc.decrypt(enc.ciphertext, enc.iv, 2), "control: the blob reads at version 2");
    const err = thrownBy(() => svc.decrypt(enc.ciphertext, enc.iv, 1), "decrypt at version 1");
    assert(nameOf(err) === "CredentialKeyVersionError", `version 1 error name, got ${nameOf(err)}`);
    assert(
      messageOf(err) === "credential key version 1 is not loaded (loaded: 3, 2)",
      `version 1 message, got ${JSON.stringify(messageOf(err))}`,
    );
  });
}

/**
 * The mirror of the row above: a blob written under the **current** key,
 * labelled with the previous version. Decrypt must reach the previous key and
 * fail its tag — not fall back to the current one, and not guess. The
 * in-function control proves the blob itself reads at version 3.
 */
export function runCurrentCiphertextLabelledPreviousTests(): void {
  const keyA = freshKey();
  const keyB = freshKey();
  withEnv(
    {
      CREDENTIAL_ENCRYPTION_KEY: keyB,
      CREDENTIAL_ENCRYPTION_KEY_PREVIOUS: keyA,
      CREDENTIAL_ENCRYPTION_KEY_VERSION: "3",
    },
    () => {
      const svc = new CredentialCryptoService();
      const enc = svc.encrypt(SECRET);
      assertRoundTrip(svc.decrypt(enc.ciphertext, enc.iv, 3), "control: the blob reads at version 3");
      const err = thrownBy(() => svc.decrypt(enc.ciphertext, enc.iv, 2), "decrypt at version 2");
      assert(
        nameOf(err) !== "CredentialKeyVersionError",
        "version 2 is loaded, so the refusal must come from the cipher, not the version map",
      );
    },
  );
}

/**
 * `notification_channels.secret_key_version` is nullable, so a null reaches
 * `decrypt` from Task 4's call site and must be refused. Reddens the moment a
 * `?? 1` is added anywhere on the path: the window here **is** version 1 and
 * the blob **is** readable at 1, so a defaulted null would succeed.
 */
export function runNullVersionRefusedTests(): void {
  withEnv({ CREDENTIAL_ENCRYPTION_KEY: freshKey() }, () => {
    const svc = new CredentialCryptoService();
    const enc = svc.encrypt(SECRET);
    assertRoundTrip(svc.decrypt(enc.ciphertext, enc.iv, 1), "control: the blob reads at version 1");
    const err = thrownBy(() => svc.decrypt(enc.ciphertext, enc.iv, null), "decrypt at a null version");
    assert(nameOf(err) === "CredentialKeyVersionError", `null version error name, got ${nameOf(err)}`);
    assert(
      messageOf(err) === "credential key version null is not loaded (loaded: 1)",
      `null version message, got ${JSON.stringify(messageOf(err))}`,
    );
  });
}

/**
 * Decision 5, at the API layer: the constructor calls the resolver so a dead
 * window is a refused boot. Reddens when the constructor stops calling it.
 */
export function runConstructorRefusesVersionZeroWindowTests(): void {
  withEnv({ CREDENTIAL_ENCRYPTION_KEY: freshKey(), CREDENTIAL_ENCRYPTION_KEY_PREVIOUS: freshKey() }, () => {
    const err = thrownBy(() => new CredentialCryptoService(), "the constructor on a version-0 window");
    assert(nameOf(err) === "CredentialKeyConfigError", `version-0 error name, got ${nameOf(err)}`);
    assert(messageOf(err).includes("version 0"), `version-0 message, got ${JSON.stringify(messageOf(err))}`);
  });
}

/** The positive control for the two refusals above and below: a live rotation
 * window constructs, and both statics answer through the same resolver. */
export function runConstructorAcceptsOpenWindowTests(): void {
  withEnv(
    {
      CREDENTIAL_ENCRYPTION_KEY: freshKey(),
      CREDENTIAL_ENCRYPTION_KEY_PREVIOUS: freshKey(),
      CREDENTIAL_ENCRYPTION_KEY_VERSION: "2",
    },
    () => {
      const svc = new CredentialCryptoService();
      assert(svc.encrypt(SECRET).keyVersion === 2, "an open window encrypts at its current version");
      assert(CredentialCryptoService.isConfigured(), "an open window is configured");
      assert(CredentialCryptoService.currentKeyVersion() === 2, "an open window reports version 2");
    },
  );
}

/**
 * Decision 5's length rule, at the API layer.
 *
 * **`CREDENTIAL_ENCRYPTION_KEY_VERSION` is `2` here on purpose.** The resolver
 * decodes `PREVIOUS` before it checks for version 0, so with the version unset
 * — which is how the plan wrote this row — deleting the length rule would still
 * throw, on the version-0 refusal, and the assertion would go green against a
 * missing guard. The message assertions are what say which refusal was reached:
 * this is Task 1's correction 1 repeating one task later.
 */
export function runConstructorRefusesShortPreviousKeyTests(): void {
  withEnv(
    {
      CREDENTIAL_ENCRYPTION_KEY: freshKey(),
      CREDENTIAL_ENCRYPTION_KEY_PREVIOUS: randomBytes(16).toString("base64"),
      CREDENTIAL_ENCRYPTION_KEY_VERSION: "2",
    },
    () => {
      const err = thrownBy(() => new CredentialCryptoService(), "the constructor on a 16-byte previous key");
      assert(nameOf(err) === "CredentialKeyConfigError", `short-key error name, got ${nameOf(err)}`);
      assert(messageOf(err).includes("32 bytes"), `short-key message, got ${JSON.stringify(messageOf(err))}`);
      assert(
        !messageOf(err).includes("version 0"),
        `the length refusal must be the one reached, got ${JSON.stringify(messageOf(err))}`,
      );
    },
  );
}

/**
 * An unset key is unconfigured, not dead: the service must still construct.
 * `onboarding-chat-caps.spec.ts:176` builds one with no key at all, and every
 * fail-closed caller already branches on `isConfigured()`.
 */
export function runUnconfiguredKeyConstructsTests(): void {
  withEnv({}, () => {
    const svc = new CredentialCryptoService();
    assert(!CredentialCryptoService.isConfigured(), "an unset key is not configured");
    const err = thrownBy(() => svc.encrypt(SECRET), "encrypt with no key");
    assert(nameOf(err) === "CredentialKeyConfigError", `unconfigured encrypt error name, got ${nameOf(err)}`);
    assert(
      messageOf(err) === "CREDENTIAL_ENCRYPTION_KEY is required",
      `unconfigured encrypt message, got ${JSON.stringify(messageOf(err))}`,
    );
  });
}
