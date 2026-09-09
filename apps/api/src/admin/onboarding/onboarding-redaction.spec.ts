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

/* -------------------------------------------------------------------------- */
/* F4.115 — a stored draft that is already too deep must still be readable     */
/* -------------------------------------------------------------------------- */

/**
 * The depth of the `rtus[0].config` chain in the fixtures below.
 *
 * **20,000, and the number was measured rather than chosen.** The obvious 5,000
 * — the depth at which both `structuredClone` and a recursive `scrubSecrets`
 * throw a `RangeError` in a plain `node` process — is *not* enough here: run
 * under vitest, whose worker threads get a larger stack than the main thread,
 * a recursive `scrubSecrets` walks 5,000 levels without overflowing. So the
 * mutation "put the recursion back" left this suite green at 5,000 while the
 * defect it exists to catch was fully present. It reddens at 20,000.
 *
 * `structuredClone` throws at both depths, so only the scrub needed the raise.
 * **This is not a claim about where any stack limit is** — that number moves
 * with the platform, the flags and the frame size, which is exactly why it is
 * set an order of magnitude past the point where the recursion was seen to
 * fail rather than at it.
 *
 * Ruling 2b's subject is a session that is **already** stored this deep.
 * `onboarding.schema.ts` refuses a new one and cannot reach back.
 */
const DEEP_CONFIG_LEVELS = 20_000;

/**
 * A `config` value nested `DEEP_CONFIG_LEVELS` deep with a `password` at the
 * bottom.
 *
 * Built with a loop, never recursively: a recursive builder would throw before
 * the function under test does, and the spec would be measuring itself.
 */
function deepConfig(): Record<string, unknown> {
  let node: Record<string, unknown> = { password: "hunter2" };
  for (let level = 0; level < DEEP_CONFIG_LEVELS; level += 1) {
    node = { next: node };
  }
  return node;
}

/**
 * Follows the `next` links of a `deepConfig` chain and returns the bottom
 * object — iteratively, for the same reason.
 *
 * The step ceiling is a runaway guard: a copy that somehow became cyclic would
 * otherwise hang the suite instead of failing it.
 *
 * **The runaway answer is a sentinel string, not `null`**, matching `leafOf` in
 * `stack-safe-json.spec.ts`. It returned `null` until `F4.115`'s review sweep,
 * and `assert(bottom !== null)` then passed on a `config` that was missing
 * altogether: `bottomOf(undefined)` returns `undefined`, which is not `null`.
 * The caller now checks the two conditions separately — that the config is
 * there at all, and that the walk down it terminated.
 */
function bottomOf(value: unknown): unknown {
  let node = value;
  for (let steps = 0; steps <= DEEP_CONFIG_LEVELS + 1; steps += 1) {
    if (typeof node !== "object" || node === null || !("next" in node)) {
      return node;
    }
    node = (node as { next: unknown }).next;
  }
  return "RUNAWAY";
}

/**
 * `GET /sessions/:id`, `validate`, `chat` and `mapSession` all answer through
 * `redactDraftForClient`, so a stored draft it cannot read is a session that
 * answers 500 on every route — including the `PATCH` that would repair it.
 *
 * Two recursive walks stood between this draft and a response:
 * `structuredClone` at the top of the function, and `scrubSecrets` over
 * `rtus[].config`. Both are exercised here, and the `[REDACTED]` assertion is
 * what makes the second one's *result* observable rather than only its absence
 * of a throw.
 *
 * **Every message below is a string literal.** Interpolating any of these
 * values calls `JSON.stringify`, which would throw while constructing the
 * failure message and report the wrong defect.
 */
export function assertRedactDraftForClientReadsADeepDraft(): void {
  // `credentialsSet` is deliberately **absent** from the stored RTU. The
  // function spreads `scrubMeta(rtu)` and then writes
  // `credentialsSet: Boolean(rtu.credentialsSet)`, so a fixture carrying `true`
  // makes the derivation unobservable — the spread already supplies `true` and
  // deleting the line changes nothing. Absent, the spread supplies nothing and
  // the derived value is `false`, so deleting the line leaves `undefined` and
  // the assertion below reddens. (The `typeof … === "boolean"` this replaced
  // could not fail at all while `rtus[0]` existed.)
  const stored = {
    location: { name: "Deep site" },
    rtus: [rtu("R1", { config: deepConfig() })],
    _secrets: { R1: { c: "abc", iv: "def" } },
  };

  const client = redactDraftForClient(stored) as {
    _secrets?: unknown;
    rtus?: { config?: unknown; credentialsSet?: unknown }[];
  };

  assert(client._secrets === undefined, "a deep draft's client view still strips _secrets");
  assert(
    client.rtus?.[0]?.credentialsSet === false,
    "a deep draft's client view still derives credentialsSet, and derives false for an RTU that carries no flag",
  );

  const config = client.rtus?.[0]?.config;
  assert(
    config !== undefined,
    "the client view must still carry rtus[0].config — without this the walk below is handed undefined and every assertion after it passes vacuously",
  );

  const bottom: unknown = bottomOf(config);
  assert(
    bottom !== "RUNAWAY",
    "the walk down the cloned config must terminate, not run away",
  );
  assert(
    (bottom as { password?: unknown } | null)?.password === "[REDACTED]",
    "the scrub must reach the bottom of the chain and redact the password there",
  );
}

/**
 * Site 3 of three, and **the only assertion that reaches it**.
 *
 * `mergeDraft` clones before it ever calls this function, so on a deep stored
 * draft `POST :id/credentials` used to die inside `mergeDraft` first. Fix the
 * other two sites and leave this one recursive and every route ruling 2b names
 * answers 200 while this one still answers 500 — a green two-site fix. Counting
 * the sites from the source, and giving the masked one its own assertion, is
 * `F4.102`'s lesson applied here.
 */
export function assertAttachEncryptedCredentialsReadsADeepDraft(): void {
  const stored = { rtus: [rtu("R1", { config: deepConfig() })] };

  const next = attachEncryptedCredentials(stored, 0, CT, IV);

  const found = readEncryptedCredentials(next, 0);
  assert(found !== null, "a credential attached to a deep draft must be readable back");
  assert(
    found?.ciphertext.toString() === CT.toString(),
    "the blob read back must be the one that was attached",
  );
  assert(
    next.rtus?.[0]?.credentialsSet === true,
    "attaching a credential to a deep draft still sets the flag",
  );
}

/**
 * The scrub rebuilds every object it copies, so it owns key order and
 * `__proto__` exactly as the clone does.
 *
 * Key order because `onboarding-redaction.spec.ts` asserts over
 * `JSON.stringify` of this output and the jsonb text is the same serialisation.
 *
 * `__proto__` is a **behaviour change here and is stated rather than hidden**:
 * the previous `out[key] = scrubSecrets(val)` invoked `Object.prototype`'s
 * accessor, so an own `__proto__` inside a scrubbed subtree vanished into the
 * copy's prototype. The iterative rewrite keeps it as data. That is safe — the
 * output is `JSON.stringify`d to the wire and the web's own `z.record` parse
 * drops the key again on arrival — and strictly better than silently reparenting
 * the API-side copy onto a caller-shaped object.
 *
 * Reached through `redactDraftForClient` because `scrubSecrets` is file-private;
 * `rtus[].config` is the subtree it scrubs.
 */
export function assertScrubSecretsKeepsKeyOrderAndProtoKey(): void {
  // `JSON.parse`, not an object literal: `{ __proto__: … }` in source sets the
  // prototype, while the parser defines an own data property — and the parser
  // is how a stored draft actually arrives.
  const config = JSON.parse(
    '{"topic":"site/1","host":"broker.example","password":"hunter2","port":8883,' +
      '"nested":{"__proto__":{"polluted":true},"zeta":1,"alpha":2}}',
  ) as Record<string, unknown>;
  assert(
    Object.prototype.hasOwnProperty.call(config.nested, "__proto__"),
    "the fixture itself must carry an own __proto__, or this proves nothing",
  );

  const client = redactDraftForClient({ rtus: [rtu("R1", { config })] }) as {
    rtus?: { config?: Record<string, unknown> }[];
  };
  const scrubbed = client.rtus?.[0]?.config ?? {};

  assert(
    Object.keys(scrubbed).join(",") === "topic,host,password,port,nested",
    `the scrub must reproduce the source key order, got: ${Object.keys(scrubbed).join(",")}`,
  );
  assert(scrubbed.password === "[REDACTED]", "the secret key is still redacted");

  const nested = scrubbed.nested as Record<string, unknown>;
  assert(
    Object.prototype.hasOwnProperty.call(nested, "__proto__"),
    "an own __proto__ inside a scrubbed subtree survives as an own data property",
  );
  assert(
    Object.getPrototypeOf(nested) === Object.prototype,
    "the scrubbed copy must not be reparented by its own __proto__ key",
  );
  assert(
    Object.keys(nested).join(",") === "__proto__,zeta,alpha",
    `the nested subtree keeps its own key order too, got: ${Object.keys(nested).join(",")}`,
  );
}

/**
 * **The half of the shared walk that the scrub owns: which values it descends
 * into.**
 *
 * `scrubSecrets` and `cloneJson` are one traversal parameterised by a container
 * predicate, and the predicates are deliberately different. The scrub's is "any
 * non-null object", so a `Date` or a `Map` under a non-secret key is **descended
 * into and rebuilt** — and since neither has own enumerable keys, both come back
 * as `{}`. That is exactly what the recursive `Object.entries` form did, and
 * keeping it is why the walk takes a predicate rather than hard-coding
 * `isJsonContainer`.
 *
 * Nothing asserted it until `F4.115`'s review sweep. Once the traversal was
 * shared, passing the clone's narrower predicate here compiled and left every
 * other assertion in both suites green while silently changing what a client
 * receives. `assertCloneJsonReturnsANonJsonObjectByReference` pins the other
 * side of the same pair.
 *
 * **What this does and does not claim.** It does not claim a shipped producer
 * ever puts a `Date` in a draft — every one of them writes JSON that arrived
 * through `JSON.parse`, so none does. It claims only that the observable
 * behaviour on such a value is the one that shipped, which is what makes
 * "deliberately not the narrower predicate" in `isContainer`'s docblock a
 * checked sentence instead of a hope.
 */
export function assertScrubSecretsRebuildsANonJsonObject(): void {
  const when = new Date("2026-09-09T00:00:00.000Z");
  const seen = new Map<string, number>([["a", 1]]);

  const client = redactDraftForClient({
    rtus: [rtu("R1", { config: { installedAt: when, counts: seen, password: "hunter2" } })],
  }) as { rtus?: { config?: Record<string, unknown> }[] };
  const scrubbed = client.rtus?.[0]?.config ?? {};

  assert(
    scrubbed.installedAt !== when,
    "the scrub must descend into a Date rather than carry the same object across",
  );
  assert(
    Object.getPrototypeOf(scrubbed.installedAt) === Object.prototype &&
      Object.keys(scrubbed.installedAt as object).length === 0,
    "a Date has no own enumerable keys, so the scrub rebuilds it as a plain {}",
  );
  assert(
    scrubbed.counts !== seen && Object.keys(scrubbed.counts as object).length === 0,
    "a Map is rebuilt as {} the same way — its entries are not own properties",
  );
  assert(scrubbed.password === "[REDACTED]", "and the secret beside them is still redacted");
}
