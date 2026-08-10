import {
  attachEncryptedCredentials,
  readEncryptedCredentials,
  reconcileSecrets,
  redactDraftForClient,
  redactDraftForLlm,
  rtuSecretKey,
} from "./onboarding-redaction";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const CT = Buffer.from("ciphertext-a");
const IV = Buffer.from("iv-a-1234567");

/** Ensures secrets are stripped from client and LLM views. */
export function runOnboardingRedactionTests(): void {
  const draft = {
    location: { name: "Test" },
    rtus: [{ code: "R1", credentialsSet: true }],
    _secrets: { R1: { c: "abc", iv: "def" } },
  };
  const client = redactDraftForClient(draft) as { _secrets?: unknown };
  assert(client._secrets === undefined, "client draft strips _secrets");
  const llm = JSON.stringify(redactDraftForLlm({ password: "secret", name: "x" }));
  assert(!llm.includes("secret"), "llm redacts password key");

  // --- M3: key matching is normalised, not exact-case -----------------------
  // `SECRET_KEYS.has(key)` was an exact, case-sensitive lookup, so every one of
  // these reached both the client response AND the LLM prompt — `scrubSecrets`
  // is the only filter between `rtus[].config` and `redactDraftForLlm`, which
  // makes it an ADR 0011 decision 4 gap rather than a cosmetic one.
  for (const key of [
    "Password",
    "PASSWORD",
    "pwd",
    "passwd",
    "passphrase",
    "api_key",
    "API-KEY",
    "apiKey",
    "client_secret",
    "clientSecret",
    "accessToken",
    "access_token",
    "privateKey",
    "priv_key",
    "community_string",
    "Username",
    "token",
    "secret",
  ]) {
    const config = { [key]: "hunter2", host: "broker.example.com" };
    const asClient = JSON.stringify(redactDraftForClient({ rtus: [{ code: "R1", config }] }));
    const asLlm = JSON.stringify(redactDraftForLlm({ rtus: [{ code: "R1", config }] }));
    assert(!asClient.includes("hunter2"), `client must redact config key ${key}`);
    assert(!asLlm.includes("hunter2"), `llm must redact config key ${key}`);
    assert(asClient.includes("broker.example.com"), `non-secret keys survive beside ${key}`);
  }

  // --- M2: `meta` is scrubbed on the client path too ------------------------
  // `meta` is z.record(z.unknown()) exactly like `config`. Scrubbing only
  // `config` for clients while `redactDraftForLlm` scrubbed the whole draft
  // meant the CLIENT saw plaintext the model did not — the inversion Amendment
  // 1 claimed to have closed.
  const metaDraft = {
    location: { name: "Site", meta: { password: "loc-secret" } },
    rtus: [{ code: "R1", config: {}, meta: { password: "rtu-secret" } }],
    assets: [{ code: "A1", meta: { apiKey: "asset-secret" } }],
  };
  const metaClient = JSON.stringify(redactDraftForClient(metaDraft));
  for (const leaked of ["loc-secret", "rtu-secret", "asset-secret"]) {
    assert(!metaClient.includes(leaked), `client must redact meta secret ${leaked}`);
  }
  assert(metaClient.includes("Site"), "scrubbing meta leaves the rest of the entry intact");
  assert(
    JSON.stringify(redactDraftForClient({ rtus: [{ code: "R1", config: {} }] })).length > 0,
    "an absent meta is not an error",
  );

  // --- M4: `_secrets` is keyed by RTU identity, not array position ----------
  // The defect: PATCH :id/draft accepts a full `rtus` array and `mergeDraft`
  // replaces it wholesale while `_secrets` is untouched. Delete or reorder an
  // entry and index `i` decrypted one broker's password into a DIFFERENT
  // broker's rtu_connection_configs row at commit.
  const twoRtus = {
    rtus: [
      { code: "R1", config: {} },
      { code: "R2", config: {} },
    ],
  };
  assert(rtuSecretKey(twoRtus, 0) === "R1", "the secret key is the RTU code");
  assert(rtuSecretKey(twoRtus, 5) === null, "an out-of-range index has no key");
  assert(rtuSecretKey({ rtus: [{ config: {} }] }, 0) === null, "a code-less RTU has no key");

  const withSecret = attachEncryptedCredentials(structuredClone(twoRtus), 1, CT, IV);
  assert(
    Object.keys(withSecret._secrets ?? {})[0] === "R2",
    "the blob is stored under the RTU code, not the index",
  );
  assert(withSecret.rtus?.[1]?.credentialsSet === true, "the owning RTU is flagged");

  // Reorder: R2 moves from index 1 to index 0. Positional lookup would now
  // return R2's password when asked for R1's.
  const reordered = structuredClone(withSecret);
  reordered.rtus = [reordered.rtus![1], reordered.rtus![0]];
  const forR2 = readEncryptedCredentials(reordered, 0);
  const forR1 = readEncryptedCredentials(reordered, 1);
  assert(forR2?.ciphertext.equals(CT) === true, "R2 keeps its own credential after a reorder");
  assert(forR1 === null, "R1, which never had one, does not inherit R2's");

  // Deletion orphans the entry; it must be dropped rather than silently kept.
  // `credentialsSet: true` here is the client asserting it — `draftRtuSchema`
  // lets any caller send that flag, so it is derived from the store, not
  // trusted, or the UI would show a "Set" badge over nothing.
  const afterDelete = reconcileSecrets(
    { ...structuredClone(withSecret), rtus: [{ code: "R1", config: {}, credentialsSet: true }] },
    { deriveCredentialsSet: true },
  );
  assert(afterDelete._secrets === undefined, "an orphaned secret is dropped");
  assert(
    afterDelete.rtus?.[0]?.credentialsSet === false,
    "credentialsSet is derived from the store, not trusted from input",
  );

  // A duplicated code has two claimants, so neither may have it.
  const contested = reconcileSecrets(
    {
      ...structuredClone(withSecret),
      rtus: [
        { code: "R2", config: {} },
        { code: "R2", config: {} },
      ],
    },
    { deriveCredentialsSet: true },
  );
  assert(contested._secrets === undefined, "a contested code drops the secret rather than guess");

  // Renaming is the same case as deleting: unrecoverable, and that is correct.
  const renamed = reconcileSecrets(
    { ...structuredClone(withSecret), rtus: [{ code: "R2-renamed", config: {} }] },
    { deriveCredentialsSet: true },
  );
  assert(renamed._secrets === undefined, "renaming an RTU drops its secret");

  // With no key configured the flag is left alone — no secret can exist, and
  // rewriting it there would silently change the path E8.4 owns.
  const unconfigured = reconcileSecrets(
    { rtus: [{ code: "R9", config: {}, credentialsSet: true }] },
    { deriveCredentialsSet: false },
  );
  assert(
    unconfigured.rtus?.[0]?.credentialsSet === true,
    "the unconfigured path keeps its existing behaviour",
  );

  // Storing under a positional key is what M4 was, so it must not be reachable.
  let threw = false;
  try {
    attachEncryptedCredentials({ rtus: [{ config: {} } as never] }, 0, CT, IV);
  } catch {
    threw = true;
  }
  assert(threw, "a code-less RTU cannot have credentials attached");
}
