import { CredentialCryptoService } from "../../security/credential-crypto.service";
import { OnboardingChatService } from "./onboarding-chat.service";
import { OnboardingValidateService } from "./onboarding-validate.service";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * ADR 0062 decisions 3 and 8 — `mergeDraft`'s credential-attaching branch.
 *
 * Constructed exactly as `onboarding-chat-caps.spec.ts:171-176` does:
 * `protocolService` and `catalogService` are `{} as never` because neither
 * case here reaches a protocol question or the existing-keys phrase.
 */
function buildChatService(): OnboardingChatService {
  return new OnboardingChatService(
    new OnboardingValidateService(),
    new CredentialCryptoService(),
    {} as never,
    {} as never,
  );
}

/**
 * The input RTU carries **no** `credentialsSet` field. `reconcileSecrets(…, {
 * deriveCredentialsSet: false })` — the branch taken when no key is configured
 * — leaves an input flag alone rather than overwriting it, so a fixture
 * carrying `credentialsSet: true` would make the unconfigured case (below)
 * pass vacuously: the assertion would read `true` because the fixture already
 * said so, not because anything set it.
 */
function draftWithOneRtu(): { rtus: { code: string; config: Record<string, unknown> }[] } {
  return { rtus: [{ code: "R1", config: {} }] };
}

/**
 * Saves and restores the three key-window env vars, matching the pattern
 * `credential-crypto.service.spec.ts` uses.
 */
function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T): T {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    previous[key] = process.env[key];
    const value = vars[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    return fn();
  } finally {
    for (const key of Object.keys(previous)) {
      const value = previous[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

const KEY_A = Buffer.alloc(32, 0x01).toString("base64");

/**
 * `enc.keyVersion` is forwarded into `attachEncryptedCredentials` — the blob
 * carries the version the key that just encrypted it actually writes.
 */
export function assertMergeDraftForwardsTheKeyVersionOntoTheBlob(): void {
  withEnv(
    { CREDENTIAL_ENCRYPTION_KEY: KEY_A, CREDENTIAL_ENCRYPTION_KEY_VERSION: "2" },
    () => {
      const service = buildChatService();
      const next = service.mergeDraft(draftWithOneRtu(), {}, {
        rtuIndex: 0,
        credentials: { password: "x" },
      }) as { _secrets?: Record<string, { v?: unknown }> };
      assert(next._secrets?.R1?.v === 2, "the stored blob carries the loaded key version");
    },
  );
}

/**
 * Positive control for the row below: with a key configured, attaching a
 * credential does flag the owning RTU.
 */
export function assertMergeDraftFlagsTheRtuWhenAKeyIsConfigured(): void {
  withEnv(
    { CREDENTIAL_ENCRYPTION_KEY: KEY_A, CREDENTIAL_ENCRYPTION_KEY_VERSION: "2" },
    () => {
      const service = buildChatService();
      const next = service.mergeDraft(draftWithOneRtu(), {}, {
        rtuIndex: 0,
        credentials: { password: "x" },
      }) as { rtus?: { credentialsSet?: unknown }[] };
      assert(next.rtus?.[0]?.credentialsSet === true, "the owning RTU is flagged");
    },
  );
}

/**
 * ADR 0062 decision 8 — with no key configured, the deleted `else if` branch
 * must not be reachable by any other means: the credential is dropped, and the
 * draft must not claim `credentialsSet: true` for a credential it never
 * stored.
 */
export function assertMergeDraftDoesNotClaimACredentialWhenNoKeyIsConfigured(): void {
  withEnv(
    {
      CREDENTIAL_ENCRYPTION_KEY: undefined,
      CREDENTIAL_ENCRYPTION_KEY_PREVIOUS: undefined,
      CREDENTIAL_ENCRYPTION_KEY_VERSION: undefined,
    },
    () => {
      const service = buildChatService();
      const next = service.mergeDraft(draftWithOneRtu(), {}, {
        rtuIndex: 0,
        credentials: { password: "x" },
      }) as { rtus?: { credentialsSet?: unknown }[]; _secrets?: unknown };
      assert(
        next.rtus?.[0]?.credentialsSet !== true,
        "an unconfigured key must not report a stored credential",
      );
      assert(next._secrets === undefined, "no blob is stored when no key is configured");
    },
  );
}
