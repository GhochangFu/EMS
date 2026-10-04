import { runProvision, type ProvisionDeps } from "./provision-cli";
import type { RealmUserSummary, UserProfileConfig, UserRowSummary } from "./provision-plan";

/**
 * `F3.78` U4 (ADR 0089 decision 5, plan U4) — `keycloak:provision` against a
 * stubbed Keycloak.
 *
 * The leak cases are the point. `GET /clients?clientId=` returns the client
 * **with its secret**, and a failing `PUT` echoes the request back, secret
 * and all — the logging rule is the client's (status codes and ids, never a
 * body), so neither the secret nor `KEYCLOAK_ADMIN_PASSWORD` may reach stdout,
 * stderr or a thrown message.
 *
 * Assertions live here; `provision-cli.test.ts` runs them (ADR 0014). One
 * claim per exported function.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const SECRET = "client-secret-SECRET-WORD-6d1f";
const ADMIN_PASSWORD = "master-password-PASS-WORD-93ab";
const BASE = "http://keycloak:8080";

const ENV: NodeJS.ProcessEnv = {
  KEYCLOAK_ADMIN_URL: BASE,
  KEYCLOAK_ADMIN_REALM: "bms",
  KEYCLOAK_ADMIN_CLIENT_ID: "bms-api-admin",
  KEYCLOAK_ADMIN_CLIENT_SECRET: SECRET,
  KEYCLOAK_ADMIN: "admin",
  KEYCLOAK_ADMIN_PASSWORD: ADMIN_PASSWORD,
};

const LIVE_PROFILE: UserProfileConfig = {
  attributes: [
    { name: "username", permissions: { view: ["admin", "user"], edit: ["admin", "user"] } },
    { name: "email", permissions: { view: ["admin", "user"], edit: ["admin", "user"] } },
    {
      name: "firstName",
      required: { roles: ["user"] },
      permissions: { view: ["admin", "user"], edit: ["admin", "user"] },
    },
    {
      name: "lastName",
      required: { roles: ["user"] },
      permissions: { view: ["admin", "user"], edit: ["admin", "user"] },
    },
  ],
  groups: [{ name: "user-metadata" }],
};

type Call = { method: string; path: string; body: string | undefined; signal: unknown };

type FakeOptions = {
  /** The client exists already (`GET` returns it, secret included) unless false. */
  clientExists?: boolean;
  realmUsers?: RealmUserSummary[];
  /** Fail the secret `PUT` with 500 and a body that echoes the request. */
  failSecretPut?: boolean;
  /** Network failures before the master token answers. */
  tokenNetworkFailures?: number;
  /** Token requests that never settle (and ignore their signal) before one answers. */
  tokenStalls?: number;
  /** The realm settings `PUT` never settles and ignores its signal (F4.188). */
  stallRealmPut?: boolean;
  /** The client secret `PUT` — the request whose body carries `SECRET` — never settles and ignores its signal. */
  stallSecretPut?: boolean;
  /**
   * The client secret `PUT` never answers but *obeys* its signal: on abort it rejects with an
   * error whose message quotes the URL and the request body (so `SECRET`).
   */
  abortableSecretPut?: boolean;
};

/** A response that never comes, from a transport that ignores its `AbortSignal`. */
const hanging = (): Promise<Response> => new Promise<Response>(() => undefined);

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

/** A Keycloak that answers the provisioning calls and records every one. */
function fakeKeycloak(opts: FakeOptions = {}): { fetch: typeof globalThis.fetch; calls: Call[] } {
  const calls: Call[] = [];
  let clientExists = opts.clientExists ?? true;
  let tokenFailures = opts.tokenNetworkFailures ?? 0;
  let tokenStalls = opts.tokenStalls ?? 0;

  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? init.body : undefined;
    const path = `${url.pathname}${url.search}`;
    calls.push({ method, path, body, signal: init?.signal });

    if (url.pathname === "/realms/master/protocol/openid-connect/token") {
      if (tokenFailures > 0) {
        tokenFailures -= 1;
        throw new TypeError(`fetch failed: connect ECONNREFUSED ${ADMIN_PASSWORD}`);
      }
      if (tokenStalls > 0) {
        tokenStalls -= 1;
        return hanging();
      }
      return json(200, { access_token: "master-token", expires_in: 60 });
    }

    const admin = "/admin/realms/bms";
    if (method === "PUT" && url.pathname === admin) {
      return opts.stallRealmPut ? hanging() : new Response(null, { status: 204 });
    }

    if (method === "GET" && url.pathname === `${admin}/clients`) {
      const clientId = url.searchParams.get("clientId");
      if (clientId === "realm-management") return json(200, [{ id: "rm-id", clientId }]);
      if (clientId === "bms-api-admin") {
        return json(200, clientExists ? [{ id: "client-id", clientId, secret: SECRET }] : []);
      }
      return json(200, []);
    }
    if (method === "POST" && url.pathname === `${admin}/clients`) {
      clientExists = true;
      return new Response(null, { status: 201, headers: { location: `${BASE}${admin}/clients/client-id` } });
    }
    if (method === "PUT" && url.pathname === `${admin}/clients/client-id`) {
      const isSecret = body !== undefined && body.includes(SECRET);
      if (isSecret && opts.stallSecretPut) {
        return hanging();
      }
      if (isSecret && opts.abortableSecretPut) {
        const signal = init?.signal;
        return new Promise<Response>((_, reject) => {
          signal?.addEventListener(
            "abort",
            () => reject(new Error(`This operation was aborted: PUT ${url.href} ${body}`)),
            { once: true },
          );
        });
      }
      if (isSecret && opts.failSecretPut) {
        return json(500, { error: "unknown_error", error_description: `echo: ${body} ${ADMIN_PASSWORD}` });
      }
      return new Response(null, { status: 204 });
    }
    if (method === "GET" && url.pathname === `${admin}/clients/client-id`) {
      return json(200, { id: "client-id", clientId: "bms-api-admin", secret: SECRET });
    }
    if (method === "GET" && url.pathname === `${admin}/clients/client-id/service-account-user`) {
      return json(200, { id: "sa-id", username: "service-account-bms-api-admin" });
    }
    if (url.pathname === `${admin}/users/sa-id/role-mappings/clients/rm-id`) {
      if (method === "GET") return json(200, [{ id: "role-view-realm", name: "view-realm" }]);
      return new Response(null, { status: 204 });
    }
    if (method === "GET" && url.pathname === `${admin}/users/sa-id/role-mappings/clients/rm-id/available`) {
      return json(200, [
        { id: "role-manage-users", name: "manage-users" },
        { id: "role-view-users", name: "view-users" },
        { id: "role-manage-realm", name: "manage-realm" },
      ]);
    }
    if (url.pathname === `${admin}/users/profile`) {
      if (method === "GET") return json(200, LIVE_PROFILE);
      return json(200, {});
    }
    if (method === "GET" && url.pathname === `${admin}/users`) {
      const first = Number(url.searchParams.get("first") ?? "0");
      const max = Number(url.searchParams.get("max") ?? "100");
      return json(200, (opts.realmUsers ?? []).slice(first, first + max));
    }
    return json(404, { error: "not found" });
  }) as typeof globalThis.fetch;

  return { fetch, calls };
}

type Run = { code: number | null; thrown: string; out: string; calls: Call[] };

async function run(
  opts: FakeOptions & {
    env?: NodeJS.ProcessEnv;
    rows?: UserRowSummary[];
    requestTimeoutMs?: number;
    /** What one fake `sleep` adds to the fake clock; defaults to the `ms` asked for. */
    sleepAdvancesMs?: number;
  } = {},
): Promise<Run> {
  const keycloak = fakeKeycloak(opts);
  const lines: string[] = [];
  let clock = 0;
  const deps: ProvisionDeps = {
    env: opts.env ?? ENV,
    fetch: keycloak.fetch,
    readUserRows: async () => opts.rows ?? [],
    out: (line) => lines.push(line),
    err: (line) => lines.push(line),
    sleep: async (ms) => {
      clock += opts.sleepAdvancesMs ?? ms;
    },
    now: () => clock,
    requestTimeoutMs: opts.requestTimeoutMs,
  };
  let code: number | null = null;
  let thrown = "";
  try {
    code = await runProvision(deps);
  } catch (err) {
    thrown = err instanceof Error ? `${err.name}: ${err.message} ${String(err.stack)}` : String(err);
  }
  return { code, thrown, out: lines.join("\n"), calls: keycloak.calls };
}

// --- refusals -------------------------------------------------------------------

export async function assertAnEmptySecretIsRefusedBeforeAnyCall(): Promise<void> {
  const r = await run({ env: { ...ENV, KEYCLOAK_ADMIN_CLIENT_SECRET: "" } });
  assert(
    r.code === 1 && r.calls.length === 0,
    `an empty KEYCLOAK_ADMIN_CLIENT_SECRET must exit 1 before any request; got code ${r.code}, ${r.calls.length} calls`,
  );
}

export async function assertAnUnsetAdminPasswordIsRefusedBeforeAnyCall(): Promise<void> {
  const r = await run({ env: { ...ENV, KEYCLOAK_ADMIN_PASSWORD: undefined } });
  assert(
    r.code === 1 && r.calls.length === 0,
    `an unset KEYCLOAK_ADMIN_PASSWORD must exit 1 before any request; got code ${r.code}, ${r.calls.length} calls`,
  );
}

export async function assertALocalhostUrlIsRefusedBeforeAnyCall(): Promise<void> {
  const r = await run({ env: { ...ENV, KEYCLOAK_ADMIN_URL: "http://localhost:8080" } });
  assert(
    r.code === 1 && r.calls.length === 0,
    `the CLI must apply decision 5's URL rule; got code ${r.code}, ${r.calls.length} calls`,
  );
}

// --- the happy path ------------------------------------------------------------------

export async function assertASuccessfulRunExitsZero(): Promise<void> {
  const r = await run();
  assert(r.code === 0, `a successful run with an empty report must exit 0; got ${r.code}: ${r.out}`);
}

export async function assertTheSecretIsSetFromTheEnvironment(): Promise<void> {
  const r = await run();
  const put = r.calls.find(
    (c) => c.method === "PUT" && c.path === "/admin/realms/bms/clients/client-id" && c.body?.includes(SECRET),
  );
  assert(put !== undefined, "the run must PUT KEYCLOAK_ADMIN_CLIENT_SECRET onto the client");
}

export async function assertAMissingClientIsCreatedWithoutASecret(): Promise<void> {
  const r = await run({ clientExists: false });
  const post = r.calls.find((c) => c.method === "POST" && c.path === "/admin/realms/bms/clients");
  const body = post?.body === undefined ? null : (JSON.parse(post.body) as Record<string, unknown>);
  assert(
    body !== null && body.clientId === "bms-api-admin" && !("secret" in body),
    `a missing client must be POSTed without a secret; got ${post?.body ?? "no POST"}`,
  );
}

export async function assertTheRealmSettingsCarryThePolicy(): Promise<void> {
  const r = await run();
  const put = r.calls.find((c) => c.method === "PUT" && c.path === "/admin/realms/bms");
  assert(
    put?.body?.includes("length(12)") === true && put.body.includes('"bruteForceProtected":true'),
    `the realm PUT must carry the policy and brute force; got ${put?.body ?? "no PUT"}`,
  );
}

export async function assertTheServiceAccountGetsExactlyTheTwoRoles(): Promise<void> {
  const r = await run();
  const path = "/admin/realms/bms/users/sa-id/role-mappings/clients/rm-id";
  const added = r.calls.find((c) => c.method === "POST" && c.path === path)?.body ?? "[]";
  const removed = r.calls.find((c) => c.method === "DELETE" && c.path === path)?.body ?? "[]";
  const names = (body: string) => (JSON.parse(body) as { name: string }[]).map((x) => x.name).sort();
  assert(
    JSON.stringify(names(added)) === JSON.stringify(["manage-users", "view-users"]) &&
      JSON.stringify(names(removed)) === JSON.stringify(["view-realm"]),
    `the service account must gain manage-users and view-users and lose view-realm; added ${added}, removed ${removed}`,
  );
}

export async function assertTheUserProfilePutKeepsTheOtherAttributes(): Promise<void> {
  const r = await run();
  const put = r.calls.find((c) => c.method === "PUT" && c.path === "/admin/realms/bms/users/profile");
  const body = put?.body === undefined ? null : (JSON.parse(put.body) as UserProfileConfig);
  const names = body?.attributes.map((a) => a.name) ?? [];
  const edit = body?.attributes.find((a) => a.name === "email")?.permissions?.edit;
  assert(
    JSON.stringify(names) === JSON.stringify(["username", "email", "firstName", "lastName"]) &&
      JSON.stringify(edit) === JSON.stringify(["admin"]),
    `the profile PUT must be the live config with email edit ["admin"]; got ${put?.body ?? "no PUT"}`,
  );
}

/** Owner ruling Q-D: the step's profile `PUT` leaves `firstName` and `lastName` optional. */
export async function assertTheUserProfilePutMakesTheNamesOptional(): Promise<void> {
  const r = await run();
  const put = r.calls.find((c) => c.method === "PUT" && c.path === "/admin/realms/bms/users/profile");
  const body = put?.body === undefined ? null : (JSON.parse(put.body) as UserProfileConfig);
  const names = (body?.attributes ?? []).filter((a) => a.name === "firstName" || a.name === "lastName");
  assert(
    names.length === 2 && names.every((a) => !Object.prototype.hasOwnProperty.call(a, "required")),
    `the profile PUT must carry firstName and lastName with no required block; got ${put?.body ?? "no PUT"}`,
  );
}

export async function assertTheFirstRequestIsRetried(): Promise<void> {
  const r = await run({ tokenNetworkFailures: 3 });
  assert(r.code === 0, `three refused connections before Keycloak answers must still exit 0; got ${r.code}`);
}

export async function assertTheFirstRequestGivesUpAfterTheWindow(): Promise<void> {
  const r = await run({ tokenNetworkFailures: 10_000 });
  const tokenCalls = r.calls.filter((c) => c.path === "/realms/master/protocol/openid-connect/token").length;
  assert(
    r.code === 1 && tokenCalls > 1 && tokenCalls < 10_000,
    `a Keycloak that never answers must exit 1 after the retry window; got code ${r.code}, ${tokenCalls} attempts`,
  );
}

// --- the report -----------------------------------------------------------------------

export async function assertANonEmptyReportExitsTwo(): Promise<void> {
  const r = await run({
    realmUsers: [{ id: "u-1", email: "pending@example.test", emailVerified: false }],
    rows: [{ email: "pending@example.test", subject: null }],
  });
  assert(
    r.code === 2 && r.out.includes("pending@example.test") && !r.out.includes("u-1"),
    `an unverified, unlinked user must be printed by email and exit 2; got code ${r.code}: ${r.out}`,
  );
}

export async function assertTheRealmUsersArePaged(): Promise<void> {
  const many: RealmUserSummary[] = Array.from({ length: 250 }, (_, i) => ({
    id: `u-${i}`,
    email: `user${i}@example.test`,
    emailVerified: true,
  }));
  many.push({ id: "u-last", email: "last@example.test", emailVerified: false });
  const r = await run({ realmUsers: many, rows: [{ email: "last@example.test", subject: null }] });
  assert(
    r.code === 2 && r.out.includes("last@example.test"),
    `a user past the first page must still be reported; got code ${r.code}`,
  );
}

// --- the logging rule ----------------------------------------------------------------

export async function assertAFailingPutLeaksNoSecret(): Promise<void> {
  const r = await run({ failSecretPut: true });
  assert(
    r.code === 1 && !r.out.includes(SECRET) && !r.thrown.includes(SECRET),
    `a failing secret PUT must exit 1 without the secret in any output; got code ${r.code}: ${r.out} ${r.thrown}`,
  );
}

export async function assertAFailingPutLeaksNoAdminPassword(): Promise<void> {
  const r = await run({ failSecretPut: true });
  assert(
    !r.out.includes(ADMIN_PASSWORD) && !r.thrown.includes(ADMIN_PASSWORD),
    `KEYCLOAK_ADMIN_PASSWORD must never be printed; got ${r.out} ${r.thrown}`,
  );
}

export async function assertAFailingPutNamesTheStatus(): Promise<void> {
  const r = await run({ failSecretPut: true });
  assert(
    r.out.includes("HTTP 500"),
    `a failure must be reported by its status (positive control for the leak cases); got ${r.out}`,
  );
}

export async function assertASuccessfulRunLeaksNoSecret(): Promise<void> {
  const r = await run();
  assert(
    r.code === 0 && !r.out.includes(SECRET) && !r.out.includes(ADMIN_PASSWORD),
    `the client GET returns the secret; it must not be printed; got ${r.out}`,
  );
}

export async function assertANetworkErrorMessageIsNotForwarded(): Promise<void> {
  const r = await run({ tokenNetworkFailures: 10_000 });
  assert(
    !r.out.includes(ADMIN_PASSWORD) && !r.out.includes("ECONNREFUSED"),
    `a network error's message must not be forwarded; got ${r.out}`,
  );
}

// --- the request bound (F4.188) -------------------------------------------------------

const STALL_LIMIT_MS = 50;
/** Generous over the limit, far under the 10 s default and vitest's 5 s. */
const STALL_MARGIN_MS = 2_000;
/**
 * What "within the limit" means: ten times the bound. Wide enough for timer slop on a loaded
 * Windows runner, narrow enough that a run waiting on anything but the bound fails it; the
 * margin above stays the hang detector.
 */
const STALL_WITHIN_MS = STALL_LIMIT_MS * 10;

/** Runs a stalled provisioning run, failing fast when it is still pending after the margin. */
async function stalledRun(opts: FakeOptions & { sleepAdvancesMs?: number }): Promise<Run & { elapsedMs: number }> {
  const started = Date.now();
  let timer: NodeJS.Timeout | undefined;
  const guard = new Promise<"hung">((resolve) => {
    timer = setTimeout(() => resolve("hung"), STALL_MARGIN_MS);
  });
  try {
    const outcome = await Promise.race([run({ ...opts, requestTimeoutMs: STALL_LIMIT_MS }), guard]);
    if (outcome === "hung") {
      throw new Error(`the run was still pending after ${STALL_MARGIN_MS} ms: no request timeout`);
    }
    return { ...outcome, elapsedMs: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

export async function assertAStalledAdminCallFailsWithinTheLimit(): Promise<void> {
  const r = await stalledRun({ stallRealmPut: true });
  assert(
    r.code === 1 && r.elapsedMs < STALL_WITHIN_MS,
    `a realm PUT that never answers must exit 1 within the bound; got code ${r.code} after ${r.elapsedMs} ms`,
  );
}

export async function assertAStalledAdminCallNamesTheStepAndTheLimit(): Promise<void> {
  const r = await stalledRun({ stallRealmPut: true });
  assert(
    r.out.includes(`realm settings failed: no response within ${STALL_LIMIT_MS} ms`),
    `the timeout must name the request and the limit; got ${r.out}`,
  );
}

export async function assertAStalledAdminCallLeaksNothing(): Promise<void> {
  const r = await stalledRun({ stallRealmPut: true });
  assert(
    !r.out.includes(SECRET) && !r.out.includes(ADMIN_PASSWORD) && !r.out.includes(BASE) && !/abort/i.test(r.out),
    `a timeout must print no secret, password, URL or abort reason; got ${r.out}`,
  );
}

export async function assertTheTokenRequestCarriesAnAbortSignal(): Promise<void> {
  const r = await run();
  const token = r.calls.filter((c) => c.path === "/realms/master/protocol/openid-connect/token");
  assert(
    token.length === 1 && token[0]?.signal instanceof AbortSignal,
    `the token request must carry an AbortSignal; got ${token.length} token calls`,
  );
}

export async function assertEveryAdminCallCarriesAnAbortSignal(): Promise<void> {
  const r = await run();
  const admin = r.calls.filter((c) => c.path.startsWith("/admin/realms/bms"));
  const bare = admin.filter((c) => !(c.signal instanceof AbortSignal));
  assert(
    admin.length > 5 && bare.length === 0,
    `every admin call must carry an AbortSignal; ${bare.length} of ${admin.length} had none`,
  );
}

export async function assertAStalledFirstTokenRequestIsRetried(): Promise<void> {
  const r = await stalledRun({ tokenStalls: 1 });
  const tokenCalls = r.calls.filter((c) => c.path === "/realms/master/protocol/openid-connect/token").length;
  assert(
    r.code === 0 && tokenCalls === 2,
    `a token request that times out once must be retried and the run exit 0; got code ${r.code}, ${tokenCalls} attempts: ${r.out}`,
  );
}

const TOKEN_PATH = "/realms/master/protocol/openid-connect/token";

/** Every token request stalls; one fake sleep spends the whole 120 s window, so two real attempts run. */
function everyTokenRequestStalls(): Promise<Run & { elapsedMs: number }> {
  return stalledRun({ tokenStalls: Number.POSITIVE_INFINITY, sleepAdvancesMs: 120_000 });
}

export async function assertAStalledTokenRequestGivesUpAfterTheWindow(): Promise<void> {
  const r = await everyTokenRequestStalls();
  const tokenCalls = r.calls.filter((c) => c.path === TOKEN_PATH).length;
  assert(
    r.code === 1 && tokenCalls === 2,
    `token requests that always time out must exit 1 once the window is spent; got code ${r.code}, ${tokenCalls} attempts: ${r.out}`,
  );
}

export async function assertAStalledTokenRequestNamesTheStepAndTheLimit(): Promise<void> {
  const r = await everyTokenRequestStalls();
  assert(
    r.out.includes(`master login failed: no response within ${STALL_LIMIT_MS} ms`),
    `the give-up must name the login and the per-request limit; got ${r.out}`,
  );
}

export async function assertAStalledTokenRequestLeaksNothing(): Promise<void> {
  const r = await everyTokenRequestStalls();
  assert(
    !r.out.includes(ADMIN_PASSWORD) && !r.out.includes(SECRET) && !r.out.includes(BASE) && !/abort/i.test(r.out),
    `a login timeout must print no password, secret, URL or abort reason; got ${r.out}`,
  );
}

export async function assertAStalledSecretPutNamesTheStepAndTheLimit(): Promise<void> {
  const r = await stalledRun({ stallSecretPut: true });
  assert(
    r.code === 1 && r.out.includes(`client secret failed: no response within ${STALL_LIMIT_MS} ms`),
    `a secret PUT that never answers must exit 1 naming the step and the limit; got code ${r.code}: ${r.out}`,
  );
}

/** The output of a run whose secret `PUT` timed out carries none of the request's values. */
function assertNoSecretPutLeak(r: Run, which: string): void {
  assert(
    r.thrown === "" &&
      !r.out.includes(SECRET) &&
      !r.out.includes(ADMIN_PASSWORD) &&
      !r.out.includes("master-token") &&
      !r.out.includes(BASE) &&
      !/abort/i.test(r.out),
    `${which}: a secret PUT timeout must print no secret, password, token, URL or abort reason, and not throw; ` +
      `got out ${r.out}, thrown ${r.thrown}`,
  );
}

export async function assertAStalledSecretPutLeaksNothing(): Promise<void> {
  assertNoSecretPutLeak(await stalledRun({ stallSecretPut: true }), "signal ignored");
}

export async function assertAnAbortedSecretPutLeaksNothing(): Promise<void> {
  const r = await stalledRun({ abortableSecretPut: true });
  // Positive control: the run reached the secret PUT and failed there, so the absences below
  // are about the aborted request's error and not about a run that stopped earlier.
  assert(
    r.code === 1 && r.out.includes(`client secret failed: no response within ${STALL_LIMIT_MS} ms`),
    `an aborted secret PUT must exit 1 naming the step and the limit; got code ${r.code}: ${r.out}`,
  );
  assertNoSecretPutLeak(r, "signal obeyed");
}
