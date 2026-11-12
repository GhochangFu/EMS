import { setCredentialsBodySchema } from "./onboarding.schema";
import { MQTT_CREDENTIAL_CONTROL_CHARS, OnboardingService } from "./onboarding.service";
import { CredentialCryptoService } from "../../security/credential-crypto.service";
import { CREDENTIALS_RTU_MOVED, CREDENTIALS_SET_ACTION } from "./onboarding-credentials-audit";
import { attachEncryptedCredentials, ownBlobAt, redactDraftForClient } from "./onboarding-redaction";
import { EMPTY_TEMPLATE_CONTEXT } from "./onboarding-template-refs";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** 32 zero bytes, base64 — enough for `CredentialCryptoService.isConfigured()`. */
const TEST_KEY = Buffer.alloc(32).toString("base64");

const JWT = { sub: "u-1", email: "someone@bms.local", role: "admin" } as never;

type Role = "admin" | "organization_admin" | "location_admin" | "operator";

/**
 * Minimal Drizzle stand-in. `select` and `update` each return a chainable whose
 * terminal call shifts the next queued result, so a test states exactly what
 * the database would answer and in what order. `transaction` just runs the
 * callback against this same object — `withTenant`'s `SET LOCAL` is real-RLS
 * plumbing this unit test has no policy to enforce, so `execute` is a no-op
 * that does not consume the queue.
 */
function fakeDb(results: unknown[][]) {
  const queue = [...results];
  const next = () => queue.shift() ?? [];
  // `F4.233`: the credential write locks the row (`.for("update")`) and answers
  // the row the load read, taking nothing from the queue.
  let loaded: unknown[] | undefined;
  const selectChain = {
    from: () => selectChain,
    where: () => selectChain,
    limit: () => {
      const rows = next();
      loaded ??= rows;
      return Promise.resolve(rows);
    },
    for: () => Promise.resolve(loaded ?? []),
  };
  const updateChain = {
    set: () => updateChain,
    where: () => updateChain,
    returning: () => Promise.resolve(next()),
  };
  const db = {
    select: () => selectChain,
    update: () => updateChain,
    insert: () => updateChain,
    execute: () => Promise.resolve(undefined),
    transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  };
  return db as never;
}

function fakeAccessControl(role: Role, canManage = true) {
  return {
    requireMasterDataUser: () => Promise.resolve({ id: "u-1", role }),
    canManageOrganization: () => Promise.resolve(canManage),
    isGlobalAdmin: () => Promise.resolve(true),
  } as never;
}

const SESSION_ROW = {
  id: "s-1",
  organizationId: "org-1",
  status: "draft",
  currentPhase: "rtu",
  draft: { rtus: [{ code: "R1", protocol: "mqtt", config: {} }] },
  messages: [],
  createdAt: new Date("2026-08-10T00:00:00Z"),
  updatedAt: new Date("2026-08-10T00:00:00Z"),
};

function buildService(opts: {
  role?: Role;
  canManage?: boolean;
  results?: unknown[][];
  mergeDraft?: (...args: unknown[]) => unknown;
}) {
  const calls: unknown[][] = [];
  const audits: unknown[] = [];
  const chatService = {
    mergeDraft: (...args: unknown[]) => {
      calls.push(args);
      return opts.mergeDraft ? opts.mergeDraft(...args) : SESSION_ROW.draft;
    },
  } as never;
  const db = fakeDb(opts.results ?? [[SESSION_ROW]]);
  const service = new OnboardingService(
    db,
    db,
    fakeAccessControl(opts.role ?? "admin", opts.canManage ?? true),
    chatService,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { context: async () => EMPTY_TEMPLATE_CONTEXT, pointKeyQuota: async () => "exempt" } as never,
    // F4.243: the parent candidates validate reads.
    { listParentCandidates: async () => [] } as never,
    // F4.333 (ADR 0129 Q5): records each audit input the credential write hands over.
    { write: async (input: unknown) => void audits.push(input) } as never,
  );
  return { service, calls, audits };
}

async function rejects(run: () => Promise<unknown>, expect: string): Promise<string> {
  try {
    await run();
  } catch (err) {
    return err instanceof Error ? `${err.constructor.name}: ${err.message}` : String(err);
  }
  throw new Error(`expected a rejection: ${expect}`);
}

/**
 * `POST :id/credentials` — ADR 0022 decision 1.
 *
 * Written after the compliance review pointed out that the *nudge*
 * (`looksLikeCredential`) had a 227-line spec while the **control** — this
 * endpoint, its schema, its gate and its fail-closed branch — had none, and
 * that neither Amendment 1 security fix had a regression test.
 */
export function runOnboardingCredentialsTests(): void {
  runSchemaTests();
}

function runSchemaTests(): void {
  // --- §4.3: the DTO is `.strict()` and bounded -----------------------------
  assert(
    setCredentialsBodySchema.safeParse({ rtuIndex: 0, credentials: { password: "x" } }).success,
    "a well-formed body is accepted",
  );
  const rejected: [string, unknown][] = [
    ["no credentials at all", { rtuIndex: 0 }],
    ["an empty credential map", { rtuIndex: 0, credentials: {} }],
    ["an empty credential value", { rtuIndex: 0, credentials: { password: "" } }],
    ["a value over 4096 chars", { rtuIndex: 0, credentials: { password: "x".repeat(4097) } }],
    ["a non-string value", { rtuIndex: 0, credentials: { password: 42 } }],
    ["a missing rtuIndex", { credentials: { password: "x" } }],
    ["a negative rtuIndex", { rtuIndex: -1, credentials: { password: "x" } }],
    ["a fractional rtuIndex", { rtuIndex: 1.5, credentials: { password: "x" } }],
    // `.strict()` is what stops an unknown field riding along into the service.
    ["an unknown top-level key", { rtuIndex: 0, credentials: { password: "x" }, admin: true }],
  ];
  for (const [label, body] of rejected) {
    assert(!setCredentialsBodySchema.safeParse(body).success, `the schema must reject ${label}`);
  }
}

/**
 * `F3.24b` (ADR 0103 Amendment 1; security review C1) — an MQTT RTU's
 * credential with a control character is refused before anything is stored:
 * the MQTT CONNECT packet carries it, and a CR LF there is a command line to
 * a plaintext protocol. The sentence is fixed; the value is never echoed.
 */
export async function assertMqttCredentialWithControlCharIsRefused(): Promise<void> {
  const previousKey = process.env.CREDENTIAL_ENCRYPTION_KEY;
  try {
    process.env.CREDENTIAL_ENCRYPTION_KEY = TEST_KEY;
    const { service, calls } = buildService({});
    const message = await rejects(
      () =>
        service.setCredentials(JWT, "s-1", {
          rtuIndex: 0,
          credentials: { username: "u", password: "pw\r\nCONFIG SET dir /tmp" },
        }),
      "a control character in an MQTT credential must be refused",
    );
    assert(
      message === `BadRequestException: ${MQTT_CREDENTIAL_CONTROL_CHARS}` && calls.length === 0,
      `expected the fixed 400 before any merge; got ${message}, merges=${calls.length}`,
    );
  } finally {
    if (previousKey === undefined) {
      delete process.env.CREDENTIAL_ENCRYPTION_KEY;
    } else {
      process.env.CREDENTIAL_ENCRYPTION_KEY = previousKey;
    }
  }
}

/** Async half — the gate, the fail-closed branch, and the no-echo guarantee. */
export async function runOnboardingCredentialsAsyncTests(): Promise<void> {
  const previousKey = process.env.CREDENTIAL_ENCRYPTION_KEY;
  try {
    // --- decision 3 + Amendment 1: the read gate matches the write gate -----
    // Amendment 1 moved this check into `loadSession`, so it covers every
    // onboarding entry point rather than `getSession` alone. Without a test,
    // re-narrowing it to `getSession` would be silent — which is how a
    // `location_admin` could once write credentials by Excel upload.
    process.env.CREDENTIAL_ENCRYPTION_KEY = TEST_KEY;
    for (const role of ["location_admin", "operator"] as Role[]) {
      const { service } = buildService({ role });
      const message = await rejects(
        () => service.setCredentials(JWT, "s-1", { rtuIndex: 0, credentials: { password: "x" } }),
        `${role} must not store credentials`,
      );
      assert(message.includes("Forbidden"), `${role} is refused, got: ${message}`);
      const onRead = await rejects(
        () => buildService({ role }).service.getSession(JWT, "s-1"),
        `${role} must not read a session`,
      );
      assert(onRead.includes("Forbidden"), `${role} is refused on read too, got: ${onRead}`);
    }

    // An in-role user outside the organization's scope is still refused — with
    // the missing-id 404 since F4.256, so the refusal does not confirm the id.
    const outOfScope = await rejects(
      () =>
        buildService({ role: "organization_admin", canManage: false }).service.setCredentials(
          JWT,
          "s-1",
          { rtuIndex: 0, credentials: { password: "x" } },
        ),
      "an out-of-scope organization must be refused",
    );
    assert(
      outOfScope === "NotFoundException: Onboarding session not found",
      `out-of-scope is the missing-id 404, got: ${outOfScope}`,
    );

    // --- decision 1: refuse rather than report a success that stored nothing -
    // E8.4's false-success is that `credentialsSet: true` is set without
    // encrypting when no key is configured. This endpoint must not become a
    // second instance of it.
    delete process.env.CREDENTIAL_ENCRYPTION_KEY;
    const unconfigured = await rejects(
      () =>
        buildService({}).service.setCredentials(JWT, "s-1", {
          rtuIndex: 0,
          credentials: { password: "x" },
        }),
      "an unset encryption key must fail closed",
    );
    assert(
      unconfigured.includes("ServiceUnavailable"),
      `an unset key fails closed with 503, got: ${unconfigured}`,
    );

    process.env.CREDENTIAL_ENCRYPTION_KEY = TEST_KEY;

    // --- input bounds checked against the draft, not just the schema --------
    const noSuchRtu = await rejects(
      () =>
        buildService({}).service.setCredentials(JWT, "s-1", {
          rtuIndex: 7,
          credentials: { password: "x" },
        }),
      "an rtuIndex past the draft must be refused",
    );
    assert(noSuchRtu.includes("BadRequest"), `an out-of-range index is 400, got: ${noSuchRtu}`);

    // --- M4: no identity, no credential ------------------------------------
    // `_secrets` is keyed by RTU code. An RTU with no code cannot be keyed, and
    // falling back to the array index is exactly the misdelivery defect.
    const codeless = await rejects(
      () =>
        buildService({
          results: [[{ ...SESSION_ROW, draft: { rtus: [{ protocol: "mqtt", config: {} }] } }]],
        }).service.setCredentials(JWT, "s-1", { rtuIndex: 0, credentials: { password: "x" } }),
      "a code-less RTU must be refused",
    );
    assert(codeless.includes("BadRequest"), `a code-less RTU is 400, got: ${codeless}`);
    assert(codeless.includes("code"), `the message says why, got: ${codeless}`);

    // --- decision 1: the plaintext is never echoed back ---------------------
    const stored = {
      rtus: [{ code: "R1", protocol: "mqtt", config: {}, credentialsSet: true }],
      _secrets: { R1: { c: "Y2lwaGVy", iv: "aXY=", v: 1 } },
    };
    const { service, calls, audits } = buildService({
      results: [
        [SESSION_ROW],
        [{ ...SESSION_ROW, draft: stored }],
        [{ code: "ORG", name: "Org" }],
      ],
      mergeDraft: () => stored,
    });
    const result = await service.setCredentials(JWT, "s-1", {
      rtuIndex: 0,
      credentials: { password: "hunter2", username: "pheadmin" },
    });
    const serialised = JSON.stringify(result);
    assert(!serialised.includes("hunter2"), "the response never echoes the plaintext password");
    assert(!serialised.includes("pheadmin"), "nor the plaintext username");
    assert(!serialised.includes("_secrets"), "nor the internal secret store");
    assert(!serialised.includes("Y2lwaGVy"), "nor the ciphertext");
    assert(
      result.draft.rtus?.[0]?.credentialsSet === true,
      "the client is told the credential is set, and nothing more",
    );
    assert(
      calls.length === 1 && (calls[0][2] as { rtuIndex: number }).rtuIndex === 0,
      "the credential is handed to mergeDraft for the requested RTU",
    );

    // --- F4.333 (ADR 0129 decision 1, Q5): one audit row, never a value ----
    assert(audits.length === 1, `one audit row per credential write, got ${audits.length}`);
    const firstAudit = audits[0] as { action: string; entityId: string; payload: Record<string, unknown> };
    assert(firstAudit.action === CREDENTIALS_SET_ACTION, `the action, got ${firstAudit.action}`);
    assert(firstAudit.entityId === "s-1", "the row names the session");
    assert(
      JSON.stringify(firstAudit.payload) ===
        JSON.stringify({ sessionId: "s-1", rtuCode: "R1", replaced: false, keyVersion: 1 }),
      `exactly the four fields, got ${JSON.stringify(firstAudit.payload)}`,
    );
    assert(!JSON.stringify(audits).includes("hunter2") && !JSON.stringify(audits).includes("pheadmin"), "no value in the audit row");

    // A second write over a stored blob is a replace, and says so.
    const before = { ...stored, _secrets: { R1: { c: "b2xk", iv: "aXY=", v: 1 } } };
    const after = { ...stored, _secrets: { R1: { c: "bmV3", iv: "aXYy", v: 2 } } };
    const replace = buildService({
      results: [[{ ...SESSION_ROW, draft: before }], [{ ...SESSION_ROW, draft: after }], [{ code: "ORG", name: "Org" }]],
      mergeDraft: () => after,
    });
    const replacedResult = JSON.stringify(
      await replace.service.setCredentials(JWT, "s-1", { rtuIndex: 0, credentials: { password: "new-pw", username: "u" } }),
    );
    assert(
      !replacedResult.includes("new-pw") && !replacedResult.includes("_secrets") && !replacedResult.includes("bmV3"),
      "the replace's response carries no plaintext, no store and no ciphertext",
    );
    const replaced = (replace.audits[0] as { payload: Record<string, unknown> }).payload;
    assert(replaced.replaced === true && replaced.keyVersion === 2, `a replace is audited as one, got ${JSON.stringify(replaced)}`);
    assert(!JSON.stringify(replace.audits).includes("new-pw"), "no value in the replace's audit row");

    // No row written, no audit row (the write that hit nothing is a 409).
    const missed = buildService({ results: [[SESSION_ROW], []], mergeDraft: () => stored });
    await rejects(() => missed.service.setCredentials(JWT, "s-1", { rtuIndex: 0, credentials: { password: "x" } }), "a write that hit nothing");
    assert(missed.audits.length === 0, "no audit row for a write that hit nothing");

    // --- F4.333 (security review M2): the write is bound to the code the form saw
    const moved = buildService({ mergeDraft: () => stored });
    const movedMessage = await rejects(
      () => moved.service.setCredentials(JWT, "s-1", { rtuIndex: 0, rtuCode: "R2", credentials: { password: "x" } }),
      "a code that is no longer at the index",
    );
    assert(movedMessage === `ConflictException: ${CREDENTIALS_RTU_MOVED}`, `a moved RTU is 409, got: ${movedMessage}`);
    assert(moved.calls.length === 0 && moved.audits.length === 0, "nothing is merged and nothing audited");
    const bound = buildService({
      results: [[SESSION_ROW], [{ ...SESSION_ROW, draft: stored }], [{ code: "ORG", name: "Org" }]],
      mergeDraft: () => stored,
    });
    await bound.service.setCredentials(JWT, "s-1", { rtuIndex: 0, rtuCode: "R1", credentials: { password: "x" } });
    assert(bound.calls.length === 1, "the matching code writes");
    assert(
      setCredentialsBodySchema.safeParse({ rtuIndex: 0, rtuCode: " R1 ", credentials: { password: "x" } }).data?.rtuCode === "R1",
      "the code is trimmed like the draft's",
    );
    assert(
      !setCredentialsBodySchema.safeParse({ rtuIndex: 0, rtuCode: "", credentials: { password: "x" } }).success,
      "an empty code is refused",
    );

    // --- F4.333 (ADR 0129 decision 1): the store overwrites, never "set once" -
    const crypto = new CredentialCryptoService();
    const draft = { rtus: [{ code: "R1", protocol: "mqtt", config: {} }] };
    const one = crypto.encrypt({ password: "old" });
    const first = attachEncryptedCredentials(draft as never, 0, one.ciphertext, one.iv, one.keyVersion);
    const two = crypto.encrypt({ password: "new" });
    const second = attachEncryptedCredentials(first, 0, two.ciphertext, two.iv, two.keyVersion);
    const blob = ownBlobAt(second, 0);
    assert(blob !== null && blob.c === two.ciphertext.toString("base64"), "a second write replaces the stored blob");
    assert(blob?.iv !== ownBlobAt(first, 0)?.iv, "with a fresh IV");
    assert(Object.keys((second as { _secrets: object })._secrets).length === 1, "and leaves one entry for the code");

    // --- Amendment 1 regression: the client view is not less redacted than
    // the LLM view. Nothing in the tree caught this being reintroduced.
    const leaky = redactDraftForClient({
      rtus: [{ code: "R1", config: { host: "broker", password: "hunter2" } }],
    });
    assert(
      !JSON.stringify(leaky).includes("hunter2"),
      "plaintext in rtus[].config never reaches the client",
    );
  } finally {
    if (previousKey === undefined) {
      delete process.env.CREDENTIAL_ENCRYPTION_KEY;
    } else {
      process.env.CREDENTIAL_ENCRYPTION_KEY = previousKey;
    }
  }
}
