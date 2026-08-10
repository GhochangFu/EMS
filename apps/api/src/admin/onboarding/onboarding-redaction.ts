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
 * Key names whose values are secrets. Compared **normalised** — lowercased with
 * separators removed — so `Password`, `pwd`, `API_KEY` and `client-secret` are
 * all caught by one entry each.
 */
const SECRET_KEYS = new Set(
  [
    "password",
    "passwd",
    "pwd",
    "passphrase",
    "username",
    "login",
    "apiKey",
    "apiSecret",
    "accessToken",
    "refreshToken",
    "token",
    "secret",
    "clientSecret",
    "clientCert",
    "clientCertificate",
    "clientKey",
    "community",
    "communityString",
    "authKey",
    "privKey",
    "privateKey",
    "credentials",
  ].map(normaliseKey),
);

/** Lowercase and drop separators, so one entry covers every spelling. */
function normaliseKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

type EncryptedBlob = { c: string; iv: string };

type DraftWithSecrets = OnboardingDraft & {
  _secrets?: Record<string, EncryptedBlob>;
};

/**
 * Identity used to key `_secrets`. `code` is required by `draftRtuSchema` and is
 * what `onboarding-commit.service.ts` writes to `bms.rtus`, so it is the same
 * identity the credential ultimately belongs to.
 */
function rtuCodeAt(draft: unknown, rtuIndex: number): string | null {
  if (typeof draft !== "object" || draft === null) {
    return null;
  }
  const rtus = (draft as OnboardingDraft).rtus;
  if (!Array.isArray(rtus)) {
    return null;
  }
  const code = rtus[rtuIndex]?.code;
  return typeof code === "string" && code.trim().length > 0 ? code.trim() : null;
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
      if (SECRET_KEYS.has(normaliseKey(key))) {
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
      `Cannot store credentials for RTU ${rtuIndex}: the draft RTU has no code to key them by`,
    );
  }
  next._secrets = next._secrets ?? {};
  next._secrets[key] = {
    c: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
  };
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
  const entry = (draft as DraftWithSecrets)._secrets?.[key];
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
    const code = typeof rtu?.code === "string" ? rtu.code.trim() : "";
    if (code.length > 0) {
      seen.set(code, (seen.get(code) ?? 0) + 1);
    }
  }

  const kept: Record<string, EncryptedBlob> = {};
  for (const [code, blob] of Object.entries(next._secrets ?? {})) {
    if (seen.get(code) === 1) {
      kept[code] = blob;
    }
  }
  if (Object.keys(kept).length > 0) {
    next._secrets = kept;
  } else {
    delete next._secrets;
  }

  if (options.deriveCredentialsSet) {
    next.rtus = next.rtus.map((rtu) => {
      const code = typeof rtu?.code === "string" ? rtu.code.trim() : "";
      const held = code.length > 0 && kept[code] !== undefined;
      return held === Boolean(rtu.credentialsSet) ? rtu : { ...rtu, credentialsSet: held };
    });
  }

  return next;
}
