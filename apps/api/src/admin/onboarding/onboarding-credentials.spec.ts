import { setCredentialsBodySchema } from "./onboarding.schema";
import { OnboardingService } from "./onboarding.service";
import { redactDraftForClient } from "./onboarding-redaction";

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
  const selectChain = {
    from: () => selectChain,
    where: () => selectChain,
    limit: () => Promise.resolve(next()),
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
  );
  return { service, calls };
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

    // An in-role user outside the organization's scope is still refused.
    const outOfScope = await rejects(
      () =>
        buildService({ role: "organization_admin", canManage: false }).service.setCredentials(
          JWT,
          "s-1",
          { rtuIndex: 0, credentials: { password: "x" } },
        ),
      "an out-of-scope organization must be refused",
    );
    assert(outOfScope.includes("Forbidden"), `out-of-scope is refused, got: ${outOfScope}`);

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
      _secrets: { R1: { c: "Y2lwaGVy", iv: "aXY=" } },
    };
    const { service, calls } = buildService({
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
