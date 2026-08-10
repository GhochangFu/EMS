import { looksLikeCredential, scrubMessages } from "./onboarding-credential-detect";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** ADR 0022 decision 2 — detection refuses, it does not parse. */
export function runCredentialDetectTests(): void {
  // --- must be caught: the shapes the old parser accepted ------------------
  // `extractCredentials` matched these and wrote them into the transcript.
  // Anything it could parse, this must refuse.
  const caught = [
    "username: admin password: hunter2",
    "username=svc_mqtt",
    "password=s3cr3t",
    "the password is hunter2",
    "my username is operator1",
    "apiKey: abc123",
    "auth key: 0xdeadbeef",
    "privKey: MIIEpAIB",
    "client cert: /etc/ssl/x.pem",
    "community: public",
    "token: eyJhbGciOi",
    "secret is swordfish",
    // Casing and padding must not be an escape.
    "PASSWORD:   Hunter2",
    "  Username : admin  ",
    // --- added after the 2026-08-10 security review ------------------------
    // The exhibit that matters: this is a broker-configuration wizard whose
    // own default host is phe.thinkiot.co.in:8883, so pasting a URL with
    // embedded credentials is the *expected* user error, not a contrived one.
    "mqtt://pheadmin:hunter2@phe.thinkiot.co.in:8883",
    "mqtts://user:p%40ss@broker.example.com:8883/topic",
    "auth: Basic cGhlYWRtaW46aHVudGVyMg==",
    "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc",
    // Terms the first pass simply did not list.
    "login: admin, pw: hunter2",
    "creds: admin/hunter2",
    "passphrase: hunter2",
    "pwd=hunter2",
    // Unicode evasion: zero-width joiner inside the keyword, and a Cyrillic
    // homoglyph for the leading `p`.
    "username​: admin password​: hunter2",
    "рassword: hunter2",
  ];
  for (const message of caught) {
    assert(looksLikeCredential(message), `must refuse: ${JSON.stringify(message)}`);
  }

  // --- must NOT be caught: ordinary wizard traffic -------------------------
  // A false positive costs a retyped message; a false positive on a *suggested
  // reply* costs the user a flow they cannot complete. These are the strings
  // the wizard itself offers, so they must pass.
  const allowed = [
    "Add point key kw",
    "View draft",
    "Add another RTU",
    "skip credentials",
    "Skip credentials for now",
    "no credentials yet",
    "Add a location in Berhampur",
    "the RO plant has a flow meter",
    // "key" alone is core wizard vocabulary — point keys. Only qualified
    // forms (api/auth/priv/client) may trigger.
    "add the key kw to this asset",
    "point key: kw",
    "point keys are kw and kva",
    // L1 from the 2026-08-10 review: `community` and `user` are ordinary
    // English as well as credential terms. A site called "Community Hall" must
    // be enterable, so those terms require an explicit `:`/`=` separator.
    "Community Hall",
    "Community Centre substation",
    "New user portal for the RO plant",
    "the user asked for a second meter",
    // Amendment 2 (H2 from the second review): the detector matched the
    // product's OWN copy, and compose never sets OPENAI_API_KEY, so on the
    // default rule-based path every MQTT RTU addition replaced the one message
    // telling users where the Credentials field is with "[REDACTED]".
    "MQTT RTU added. Add its credentials with the **Credentials** field on the RTU step — never in this chat — or carry on without them for now.",
    "Set each RTU's credentials with the **Credentials** field on the RTU step — never in this chat. The topic can be completed here:",
    "Credentials are encrypted before storage and never sent to the assistant.",
    "[REDACTED] — withheld by ADR 0022",
    "the token bus is down",
  ];
  for (const message of allowed) {
    assert(!looksLikeCredential(message), `must allow: ${JSON.stringify(message)}`);
  }

  // --- documented misses (Amendment 2) --------------------------------------
  // Recorded as tests so the trade is visible and cannot be mistaken for
  // coverage. Each needs the detector to GROW, which is what kept regressing.
  // They are acceptable because decision 1 gives credentials a real home.
  for (const missed of [
    "hunter2",
    "api key abc123",
    "user admin pass hunter2",
    "pheadmin:hunter2@phe.thinkiot.co.in:8883",
    "MQTT_PASSWORD=hunter2",
  ]) {
    assert(
      !looksLikeCredential(missed),
      `documented miss changed behaviour — update the ADR, not just this list: ${JSON.stringify(missed)}`,
    );
  }

  // --- bounded cost (the ReDoS this replaced) --------------------------------
  const started = Date.now();
  looksLikeCredential(`${"a".repeat(200000)}`);
  const elapsed = Date.now() - started;
  assert(elapsed < 250, `detection must stay cheap on hostile input, took ${elapsed}ms`);

  // --- the escape hatch specifically ---------------------------------------
  // "skip credentials" names a credential but supplies no value. Requiring a
  // value after the term is what keeps this usable.
  assert(!looksLikeCredential("skip credentials"), "the documented escape hatch still works");
  assert(
    looksLikeCredential("skip credentials, password is hunter2"),
    "but a secret later in the same turn is still caught",
  );

  // --- scrubMessages: defence in depth (decision 4) ------------------------
  const scrubbed = scrubMessages([
    { role: "user", content: "password: hunter2" },
    { role: "assistant", content: "MQTT RTU added." },
    { role: "user", content: "Add point key kw" },
  ]);
  assert(scrubbed.length === 3, "scrubbing preserves the turn count");
  assert(
    !JSON.stringify(scrubbed).includes("hunter2"),
    "a stored secret never reaches the client, even if decision 2 let it through",
  );
  assert(
    scrubbed[1].content === "MQTT RTU added.",
    "innocent turns are returned unchanged",
  );
  assert(
    scrubbed[2].content === "Add point key kw",
    "and so are point-key turns",
  );
  assert(
    scrubbed[0].content.includes("[REDACTED]"),
    "a redacted turn says so rather than vanishing",
  );

  // Shape tolerance: these rows come from jsonb written by older code.
  const odd = scrubMessages([
    { role: "user" } as never,
    null as never,
    { role: "user", content: 42 } as never,
  ]);
  assert(odd.length === 3, "malformed stored turns are not dropped silently");
}
