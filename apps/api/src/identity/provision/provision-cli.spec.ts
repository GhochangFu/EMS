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
    { name: "firstName", permissions: { view: ["admin", "user"], edit: ["admin", "user"] } },
    { name: "lastName", permissions: { view: ["admin", "user"], edit: ["admin", "user"] } },
  ],
  groups: [{ name: "user-metadata" }],
};

type Call = { method: string; path: string; body: string | undefined };

type FakeOptions = {
  /** The client exists already (`GET` returns it, secret included) unless false. */
  clientExists?: boolean;
  realmUsers?: RealmUserSummary[];
  /** Fail the secret `PUT` with 500 and a body that echoes the request. */
  failSecretPut?: boolean;
  /** Network failures before the master token answers. */
  tokenNetworkFailures?: number;
};

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

  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? init.body : undefined;
    const path = `${url.pathname}${url.search}`;
    calls.push({ method, path, body });

    if (url.pathname === "/realms/master/protocol/openid-connect/token") {
      if (tokenFailures > 0) {
        tokenFailures -= 1;
        throw new TypeError(`fetch failed: connect ECONNREFUSED ${ADMIN_PASSWORD}`);
      }
      return json(200, { access_token: "master-token", expires_in: 60 });
    }

    const admin = "/admin/realms/bms";
    if (method === "PUT" && url.pathname === admin) return new Response(null, { status: 204 });

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
  opts: FakeOptions & { env?: NodeJS.ProcessEnv; rows?: UserRowSummary[] } = {},
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
      clock += ms;
    },
    now: () => clock,
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
    rows: [{ email: "pending@example.test", oidcSubject: null }],
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
  const r = await run({ realmUsers: many, rows: [{ email: "last@example.test", oidcSubject: null }] });
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
