import type { OnboardingDraft } from "@bms/shared";

/**
 * Draft redaction and the internal encrypted-credential store (ADR 0022).
 *
 * Three defects from the 2026-08-10 review rounds are fixed here, recorded
 * because each was described in the ADR before it was true:
 *
 * - **M4** — `_secrets` was keyed by **array index** while `mergeDraft` replaces
 *   `rtus` wholesale, so deleting or reordering an RTU made index `i` decrypt
 *   one broker's password into a *different* broker's `rtu_connection_configs`
 *   row. That is credential misdelivery to a third-party endpoint, not an
 *   internal mix-up. Now keyed by RTU `code`, with orphans and duplicate-code
 *   collisions dropped on every merge.
 * - **M3** — `SECRET_KEYS` was matched exactly and case-sensitively, so
 *   `Password`, `pwd` and `api_key` all survived. Since `redactDraftForLlm`
 *   composes this, it was also the only filter between `rtus[].config` and the
 *   LLM prompt — an ADR 0011 decision 4 gap, not just a client-response one.
 * - **M2** — only `config` was scrubbed for clients, while the LLM path scrubbed
 *   the whole draft. `meta` is `z.record(z.unknown())` exactly like `config`, so
 *   the client was *less* redacted than the model.
 */

/**
 * Fragments that mark a value as a secret, matched as a **normalised substring**
 * — lowercased with separators dropped. Amendment 4 required an exact
 * normalised match, which the fifth review showed still leaked every compound
 * name: `mqttPassword`, `mqtt_username`, `snmpCommunity`, `authPassword`,
 * `privPassword`, `keystorePassword`, `caCert`, `sasToken`, `sharedAccessKey`.
 * `rtus[].config` is free-form and `redactDraftForLlm` composes the client
 * redactor, so those reached the model as well as the client.
 *
 * Substring matching is safe **here** in a way it was not for the chat
 * detector: this runs over structured key names from a known schema, not free
 * English. Checked against every field in `draftLocationSchema`,
 * `draftRtuSchema`, `draftAssetSchema`, `draftPointKeySchema` and
 * `draftAssetPointSchema` — none contains one of these as a normalised
 * substring except `credentialsSet`, which is a status flag the UI needs and is
 * excluded by name below.
 */
const SECRET_FRAGMENTS = [
  "password",
  "passwd",
  "pwd",
  "passphrase",
  "secret",
  "token",
  "credential",
  "apikey",
  "authkey",
  "privkey",
  "privatekey",
  "sharedaccesskey",
  "accesskey",
  // Private-key spellings, enumerated rather than matching a bare "key", which
  // would swallow `pointKey`, `sourceDataKey` and `assetPoints[].pointKey` —
  // point keys are core wizard vocabulary, and the chat detector's history is
  // that over-matching destroys the product's own data.
  //
  // `clientkey` is here because Amendment 5 **dropped it**: Amendment 4 listed
  // `clientKey` as an exact entry, and no fragment in the substring list was a
  // substring of it, so widening the predicate silently narrowed it on exactly
  // one key — leaving `clientCert` (the public half of a mutual-TLS pair)
  // redacted and `clientKey` (the private half) in clear. Checked: none of
  // these is a substring of `pointkey` or `sourcedatakey`.
  "clientkey",
  "cakey",
  "tlskey",
  "sslkey",
  "keypem",
  "signingkey",
  "encryptionkey",
  "community",
  "cert",
  "username",
  "login",
].map(normaliseKey);

/**
 * Keys that contain a fragment but carry no secret. `credentialsSet` is a
 * boolean the drawer renders as the "Set" badge — redacting it would break the
 * UI while protecting nothing.
 */
const NON_SECRET_KEYS = new Set(["credentialsSet", "credentialsset"].map(normaliseKey));

/** Lowercase and drop separators, so one entry covers every spelling. */
function normaliseKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isSecretKey(key: string): boolean {
  const normalised = normaliseKey(key);
  if (NON_SECRET_KEYS.has(normalised)) {
    return false;
  }
  return SECRET_FRAGMENTS.some((fragment) => normalised.includes(fragment));
}

type EncryptedBlob = { c: string; iv: string };

/**
 * Reads one blob from the `_secrets` map by **own** property only.
 *
 * `draftRtuSchema.code` has no charset regex, so `toString`, `valueOf`,
 * `constructor` and `__proto__` are all valid RTU codes. A plain `secrets[code]`
 * lookup returns the inherited prototype member for each of them — truthy, with
 * `c` undefined. The sixth review found three consequences: `credentialsSet`
 * derived `true` for an RTU that never had a credential (the false-success
 * decision 1 exists to refuse), `Buffer.from(undefined, "base64")` throwing at
 * commit and aborting the whole transaction, and `_secrets["__proto__"] = blob`
 * invoking the setter so the ciphertext vanished while the endpoint returned
 * 200. The `hasOwnProperty` guard plus the shape check closes all three.
 *
 * A charset regex on `code` would not have: `__proto__` matches
 * `/^[A-Za-z0-9_-]+$/`.
 */
function ownBlob(secrets: unknown, key: string): EncryptedBlob | null {
  if (typeof secrets !== "object" || secrets === null) {
    return null;
  }
  if (!Object.prototype.hasOwnProperty.call(secrets, key)) {
    return null;
  }
  const entry = (secrets as Record<string, unknown>)[key];
  if (typeof entry !== "object" || entry === null) {
    return null;
  }
  const { c, iv } = entry as { c?: unknown; iv?: unknown };
  return typeof c === "string" && typeof iv === "string" ? { c, iv } : null;
}

/**
 * Assigns without invoking a setter — `store.__proto__ = blob` would otherwise
 * be swallowed by `Object.prototype`'s accessor rather than stored.
 */
function setBlob(store: Record<string, EncryptedBlob>, key: string, blob: EncryptedBlob): void {
  Object.defineProperty(store, key, {
    value: blob,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

type DraftWithSecrets = OnboardingDraft & {
  _secrets?: Record<string, EncryptedBlob>;
};

/**
 * Identity used to key `_secrets`. `code` is required by `draftRtuSchema` and is
 * what `onboarding-commit.service.ts` writes to `bms.rtus`, so it is the same
 * identity the credential ultimately belongs to.
 *
 * **Returns `null` unless exactly one RTU claims the code.** Amendment 4 put
 * that check in `reconcileSecrets` alone, which the fifth review showed is the
 * one place it is not needed: `mergeDraft` reconciles *before* attaching, and
 * commit reads positionally with no merge in between. Two codes differing only
 * by trimmable whitespace — `draftRtuSchema.code` has no regex, and JS `.trim()`
 * eats NBSP, invisible in the preview drawer — aliased to one key, so a second,
 * attacker-chosen RTU was handed the first one's real broker password at commit
 * with `credentialsSet` still showing unset. Enforcing it here makes every
 * caller fail closed: 400 from the endpoint, a throw on attach, `null` on read.
 */
function rtuCodeAt(draft: unknown, rtuIndex: number): string | null {
  if (typeof draft !== "object" || draft === null) {
    return null;
  }
  const rtus = (draft as OnboardingDraft).rtus;
  if (!Array.isArray(rtus)) {
    return null;
  }
  const code = normaliseCode(rtus[rtuIndex]?.code);
  if (code === null) {
    return null;
  }
  const claimants = rtus.filter((rtu) => normaliseCode(rtu?.code) === code).length;
  return claimants === 1 ? code : null;
}

function normaliseCode(code: unknown): string | null {
  if (typeof code !== "string") {
    return null;
  }
  const trimmed = code.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * The secret key for an RTU position, or `null` when the draft cannot name it.
 * Callers **must** fail closed on `null` rather than falling back to the index —
 * that fallback is the M4 defect.
 */
export function rtuSecretKey(draft: unknown, rtuIndex: number): string | null {
  return rtuCodeAt(draft, rtuIndex);
}

/** Removes internal secret blobs before sending draft to client or LLM. */
export function redactDraftForClient(draft: unknown): OnboardingDraft {
  if (typeof draft !== "object" || draft === null) {
    return {};
  }
  const copy = structuredClone(draft) as DraftWithSecrets;
  delete copy._secrets;
  if (copy.location) {
    copy.location = scrubMeta(copy.location);
  }
  if (Array.isArray(copy.assets)) {
    copy.assets = copy.assets.map(scrubMeta);
  }
  if (Array.isArray(copy.rtus)) {
    copy.rtus = copy.rtus.map((rtu) => ({
      ...scrubMeta(rtu),
      // M2 from the 2026-08-10 security review: this used to delete `_secrets`
      // and nothing else, so the CLIENT response was less redacted than the LLM
      // context — anything plaintext in `config` (which the model can write via
      // `draftPatch`) was returned by `GET /sessions/:id` and by `validate`.
      config: scrubSecrets(rtu.config) as typeof rtu.config,
      credentialsSet: Boolean(rtu.credentialsSet),
    }));
  }
  return copy;
}

/**
 * `meta` is `z.record(z.unknown())` like `config`, so it takes the same scrub.
 * Without this the client path was less redacted than the LLM path — the
 * inversion ADR 0022 Amendment 1 claimed to have closed and had not.
 */
function scrubMeta<T extends { meta?: unknown }>(entry: T): T {
  if (entry.meta === undefined || entry.meta === null) {
    return entry;
  }
  return { ...entry, meta: scrubSecrets(entry.meta) as T["meta"] };
}

/** Strips credential values from objects recursively for LLM context. */
export function redactDraftForLlm(draft: unknown): OnboardingDraft {
  const client = redactDraftForClient(draft);
  return scrubSecrets(client) as OnboardingDraft;
}

function scrubSecrets(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(scrubSecrets);
  }
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      if (isSecretKey(key)) {
        out[key] = "[REDACTED]";
      } else {
        out[key] = scrubSecrets(val);
      }
    }
    return out;
  }
  return value;
}

/** Merges pending credentials into internal _secrets store. */
export function attachEncryptedCredentials(
  draft: DraftWithSecrets,
  rtuIndex: number,
  ciphertext: Buffer,
  iv: Buffer,
): DraftWithSecrets {
  const next = structuredClone(draft) as DraftWithSecrets;
  const key = rtuCodeAt(next, rtuIndex);
  if (key === null) {
    // Fail closed: storing under a positional key is what M4 was.
    throw new Error(
      `Cannot store credentials for RTU ${rtuIndex}: the draft RTU has no code to key them by, ` +
        "or another RTU claims the same code",
    );
  }
  // Rebuild from own, well-shaped entries so a prototype-member key cannot be
  // carried forward, then assign through `setBlob` so `__proto__` is stored
  // rather than swallowed by the setter.
  const store: Record<string, EncryptedBlob> = {};
  for (const existing of Object.keys(next._secrets ?? {})) {
    const blob = ownBlob(next._secrets, existing);
    if (blob) {
      setBlob(store, existing, blob);
    }
  }
  setBlob(store, key, {
    c: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
  });
  next._secrets = store;
  if (Array.isArray(next.rtus) && next.rtus[rtuIndex]) {
    next.rtus[rtuIndex] = { ...next.rtus[rtuIndex], credentialsSet: true };
  }
  return next;
}

/** Reads encrypted credential blobs from draft internal store. */
export function readEncryptedCredentials(
  draft: unknown,
  rtuIndex: number,
): { ciphertext: Buffer; iv: Buffer } | null {
  if (typeof draft !== "object" || draft === null) {
    return null;
  }
  const key = rtuCodeAt(draft, rtuIndex);
  if (key === null) {
    return null;
  }
  const entry = ownBlob((draft as DraftWithSecrets)._secrets, key);
  if (!entry) {
    return null;
  }
  return {
    ciphertext: Buffer.from(entry.c, "base64"),
    iv: Buffer.from(entry.iv, "base64"),
  };
}

/**
 * Re-establishes the `_secrets` invariant after a draft merge.
 *
 * `mergeDraft` replaces `rtus` wholesale from client or model input, so an RTU
 * carrying a secret can vanish, be renamed, or collide with another. Without
 * this the store silently keeps entries no RTU owns.
 *
 * - Entries whose code no longer appears are **dropped**. The credential is
 *   unrecoverable, which is the correct outcome: re-entering it is cheap,
 *   shipping it to the wrong broker is not.
 * - A code appearing on **more than one** RTU drops that entry too — with two
 *   claimants there is no safe answer, so neither gets it.
 * - `credentialsSet` is derived from the store rather than trusted from input,
 *   since `draftRtuSchema` lets a client assert `credentialsSet: true` freely.
 *   Only done when encryption is configured: with no key no secret can exist,
 *   and rewriting the flag there would silently change the unconfigured path
 *   that E8.4 owns.
 */
export function reconcileSecrets(
  draft: DraftWithSecrets,
  options: { deriveCredentialsSet: boolean },
): DraftWithSecrets {
  const next = draft;
  if (!Array.isArray(next.rtus)) {
    if (next._secrets && Object.keys(next._secrets).length > 0) {
      delete next._secrets;
    }
    return next;
  }

  const seen = new Map<string, number>();
  for (const rtu of next.rtus) {
    const code = normaliseCode(rtu?.code) ?? "";
    if (code.length > 0) {
      seen.set(code, (seen.get(code) ?? 0) + 1);
    }
  }

  const kept: Record<string, EncryptedBlob> = {};
  for (const code of Object.keys(next._secrets ?? {})) {
    const blob = ownBlob(next._secrets, code);
    if (blob && seen.get(code) === 1) {
      setBlob(kept, code, blob);
    }
  }
  if (Object.keys(kept).length > 0) {
    next._secrets = kept;
  } else {
    delete next._secrets;
  }

  if (options.deriveCredentialsSet) {
    next.rtus = next.rtus.map((rtu) => {
      const code = normaliseCode(rtu?.code) ?? "";
      const held = code.length > 0 && ownBlob(kept, code) !== null;
      return held === Boolean(rtu.credentialsSet) ? rtu : { ...rtu, credentialsSet: held };
    });
  }

  return next;
}
