import type { OnboardingDraft } from "@bms/shared";

const SECRET_KEYS = new Set([
  "password",
  "username",
  "apiKey",
  "clientCert",
  "clientKey",
  "community",
  "authKey",
  "privKey",
]);

type DraftWithSecrets = OnboardingDraft & {
  _secrets?: Record<string, { c: string; iv: string }>;
};

/** Removes internal secret blobs before sending draft to client or LLM. */
export function redactDraftForClient(draft: unknown): OnboardingDraft {
  if (typeof draft !== "object" || draft === null) {
    return {};
  }
  const copy = structuredClone(draft) as DraftWithSecrets;
  delete copy._secrets;
  if (Array.isArray(copy.rtus)) {
    copy.rtus = copy.rtus.map((rtu) => {
      const { ...rest } = rtu;
      return { ...rest, credentialsSet: Boolean(rtu.credentialsSet) };
    });
  }
  return copy;
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
      if (SECRET_KEYS.has(key)) {
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
  next._secrets = next._secrets ?? {};
  next._secrets[String(rtuIndex)] = {
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
  const secrets = (draft as DraftWithSecrets)._secrets;
  const entry = secrets?.[String(rtuIndex)];
  if (!entry) {
    return null;
  }
  return {
    ciphertext: Buffer.from(entry.c, "base64"),
    iv: Buffer.from(entry.iv, "base64"),
  };
}
