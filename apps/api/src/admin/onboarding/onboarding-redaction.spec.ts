import type { OnboardingDraftRtu } from "@bms/shared";

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

/**
 * A complete `OnboardingDraftRtu`. `displayName` and `protocol` are required by
 * the type and irrelevant to every assertion here, so they are filled once
 * rather than repeated at each fixture.
 *
 * These fixtures previously omitted both. That compiled under `pnpm build`
 * (which type-checks `src` via nest/tsc but not `*.spec.ts`) while
 * `pnpm typecheck:tests` — a separate CI step covering the spec files — failed on
 * `main` for seven of them. E8.3 was verified with `build` and `test:coverage`,
 * neither of which runs that step, which is how it shipped red.
 */
function rtu(
  code: string,
  extra: Partial<OnboardingDraftRtu> = {},
): OnboardingDraftRtu {
  return {
    code,
    displayName: code,
    protocol: "mqtt",
    config: {},
    ...extra,
  };
}

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
    // Compound names, found by the fifth review. Amendment 4 matched the
    // normalised key EXACTLY, so every one of these still reached the client
    // and — because `redactDraftForLlm` composes the client redactor — the
    // model. `mqtt*` and `snmp*` are the spellings this product's own adapters
    // and the SNMP domain actually use.
    "mqttPassword",
    "mqtt_username",
    "snmpCommunity",
    "authPassword",
    "privPassword",
    "keystorePassword",
    "caCert",
    "caKey",
    "sasToken",
    "sharedAccessKey",
    "credential",
    // Found by the sixth review: Amendment 4 listed `clientKey` as an exact
    // entry, and no fragment in Amendment 5's substring list was a substring of
    // it — so widening the predicate silently NARROWED it on this one key,
    // leaving `clientCert` (public half of a mutual-TLS pair) redacted and
    // `clientKey` (private half) in clear. Asserted here so it cannot be
    // dropped again.
    "clientKey",
    "client_key",
    "CLIENT-KEY",
    "tlsKey",
    "sslKey",
    "keyPem",
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

  // Substring matching must not destroy the fields the UI needs. `credentialsSet`
  // contains "credential" and is a status flag, not a secret — the drawer renders
  // it as the "Set" badge.
  const keptFields = redactDraftForClient({
    location: { code: "SITE", name: "Site", province: "Odisha" },
    rtus: [
      {
        code: "R1",
        displayName: "RTU 1",
        protocol: "mqtt",
        credentialsSet: true,
        config: { host: "broker", port: 8883, tls: true, topic: "a/b" },
      },
    ],
    pointKeys: [{ code: "kw", name: "Active power", unit: "kW" }],
  });
  assert(keptFields.rtus?.[0]?.credentialsSet === true, "credentialsSet survives the scrub");
  assert(
    JSON.stringify(keptFields).includes("broker") &&
      JSON.stringify(keptFields).includes("Active power"),
    "ordinary draft fields are untouched",
  );
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
      rtu("R1"),
      rtu("R2"),
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
    { ...structuredClone(withSecret), rtus: [rtu("R1", { credentialsSet: true })] },
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
        rtu("R2"),
        rtu("R2"),
      ],
    },
    { deriveCredentialsSet: true },
  );
  assert(contested._secrets === undefined, "a contested code drops the secret rather than guess");

  // Codes that differ only by trimmable whitespace alias to ONE key. Found by
  // the fifth review: `reconcileSecrets` was the only place that checked for a
  // contested code, and it runs BEFORE `attachEncryptedCredentials` in
  // `mergeDraft` — while commit reads positionally with no merge in between. So
  // the invariant held where it was tested and nowhere it was needed, and RTU 1
  // (`config.host` attacker-chosen) received RTU 0's real broker password.
  // `draftRtuSchema.code` has no regex and no trim, and JS `.trim()` eats NBSP,
  // which is invisible in the preview drawer.
  const aliased = {
    rtus: [
      rtu("PHE-01"),
      rtu("PHE-01 "),
      rtu("PHE-01 "), // NBSP, not a space — JS .trim() eats it and the drawer cannot show it
    ],
  };
  assert(rtuSecretKey(aliased, 0) === null, "a contested code has no key, even for its first claimant");
  let aliasThrew = false;
  try {
    attachEncryptedCredentials(structuredClone(aliased), 0, CT, IV);
  } catch {
    aliasThrew = true;
  }
  assert(aliasThrew, "credentials cannot be attached under a contested code");
  const preAliased = {
    ...structuredClone(aliased),
    _secrets: { "PHE-01": { c: CT.toString("base64"), iv: IV.toString("base64") } },
  };
  for (const index of [0, 1, 2]) {
    assert(
      readEncryptedCredentials(preAliased, index) === null,
      `RTU ${index} must not read a credential stored under a contested code`,
    );
  }

  // An RTU code may name a member of Object.prototype — `draftRtuSchema.code`
  // has no charset regex, and a regex would not help anyway since `__proto__`
  // matches /^[A-Za-z0-9_-]+$/. A plain `_secrets[code]` lookup returns the
  // inherited member: truthy, with `c` undefined. Found by the sixth review.
  const PROTO_CODES = ["toString", "valueOf", "constructor", "hasOwnProperty", "__proto__"];
  for (const code of PROTO_CODES) {
    // Stored map came back from JSONB, so it has Object.prototype.
    const fromDb = JSON.parse(JSON.stringify({ rtus: [{ code, config: {} }], _secrets: {} }));

    // 1. It must not read as a held credential — `Buffer.from(undefined)` threw
    //    here, aborting the whole commit transaction.
    assert(
      readEncryptedCredentials(fromDb, 0) === null,
      `${code} must not read a credential off the prototype`,
    );

    // 2. It must not derive `credentialsSet: true` for an RTU that has none —
    //    the false success decision 1 exists to refuse.
    const derived = reconcileSecrets(fromDb, { deriveCredentialsSet: true });
    assert(
      derived.rtus?.[0]?.credentialsSet !== true,
      `${code} must not derive credentialsSet from a prototype member`,
    );

    // 3. Storing under it must round-trip. `_secrets["__proto__"] = blob`
    //    invoked the setter, so Object.keys was [] and the ciphertext was
    //    silently discarded while the endpoint returned 200.
    const attached = attachEncryptedCredentials(
      JSON.parse(JSON.stringify({ rtus: [{ code, config: {} }] })),
      0,
      CT,
      IV,
    );
    assert(
      Object.keys(attached._secrets ?? {}).includes(code),
      `${code} must be stored as an own property`,
    );
    const roundTripped = JSON.parse(JSON.stringify(attached));
    const read = readEncryptedCredentials(roundTripped, 0);
    assert(
      read?.ciphertext.equals(CT) === true,
      `${code} must survive the JSONB round-trip and read back`,
    );
  }

  // Malformed blobs are not trusted either — `entry.c` was read without a shape
  // check, which is what turned a bad row into a 500 at commit.
  for (const bad of [{ c: 1, iv: "aXY=" }, { iv: "aXY=" }, null, "nope"]) {
    const draftWithBad = { rtus: [{ code: "R1", config: {} }], _secrets: { R1: bad } };
    assert(
      readEncryptedCredentials(draftWithBad, 0) === null,
      `a malformed blob reads as absent, not as a crash: ${JSON.stringify(bad)}`,
    );
  }

  // Renaming is the same case as deleting: unrecoverable, and that is correct.
  const renamed = reconcileSecrets(
    { ...structuredClone(withSecret), rtus: [rtu("R2-renamed")] },
    { deriveCredentialsSet: true },
  );
  assert(renamed._secrets === undefined, "renaming an RTU drops its secret");

  // With no key configured the flag is left alone — no secret can exist, and
  // rewriting it there would silently change the path E8.4 owns.
  const unconfigured = reconcileSecrets(
    { rtus: [rtu("R9", { credentialsSet: true })] },
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
