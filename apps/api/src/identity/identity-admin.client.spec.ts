import type { UserRole } from "@bms/shared";

import {
  BMS_REALM_ROLES,
  IdentityAdminError,
  KeycloakIdentityAdminClient,
  mapKeycloakFailure,
  type IdentityAdminFailureReason,
} from "./identity-admin.client";
import type { IdentityAdminConfig } from "./identity-admin.config";
import { createIdentityAdmin, NotConfiguredIdentityAdmin } from "./identity-admin.module";
import { FakeIdentityAdmin } from "./testing/fake-identity-admin";

/**
 * `F3.78` U3 (ADR 0089 decision 5) — `KeycloakIdentityAdminClient` over a
 * stubbed `fetch`.
 *
 * Assertions live here; `identity-admin.client.test.ts` runs them (ADR 0014).
 * One claim per exported function.
 *
 * The client secret is equivalent to global admin (decision 5), and Keycloak
 * echoes request detail in `error_description`. So the leak cases plant a
 * sentinel in a response body and read both the thrown message and every
 * captured log line for it — each beside a positive check that the log did
 * record the status, because an absence check alone passes on a silent logger.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const CLIENT_SECRET = "client-secret-4d1e88";
const SENTINEL = "SECRET-WORD";
const BASE = "http://keycloak:8080";
const ADMIN = `${BASE}/admin/realms/bms`;
const TOKEN_URL = `${BASE}/realms/bms/protocol/openid-connect/token`;

const CONFIG: IdentityAdminConfig = {
  url: BASE,
  realm: "bms",
  clientId: "bms-api-admin",
  clientSecret: CLIENT_SECRET,
};

type RecordedCall = {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | undefined;
};

type Route = (call: RecordedCall) => Response | undefined;

function tokenResponse(token = "tok-1", expiresIn = 300): Response {
  return Response.json({ access_token: token, expires_in: expiresIn, token_type: "Bearer" });
}

/**
 * A `fetch` that answers the token endpoint with a fresh token per request
 * (`tok-1`, `tok-2`, …) unless a route claims it first, and every other
 * request from `route`. An unrouted request is a 599 so a test never passes on
 * an accidental default.
 */
function stubFetch(route: Route = () => undefined): {
  fetch: typeof globalThis.fetch;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  let tokens = 0;
  const fetchStub = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    const call: RecordedCall = {
      method: init?.method ?? "GET",
      url: String(input),
      headers,
      body: typeof init?.body === "string" ? init.body : init?.body?.toString(),
    };
    calls.push(call);
    const routed = route(call);
    if (routed) {
      return routed;
    }
    if (call.url === TOKEN_URL) {
      tokens += 1;
      return tokenResponse(`tok-${tokens}`);
    }
    return new Response(null, { status: 599 });
  }) as typeof globalThis.fetch;
  return { fetch: fetchStub, calls };
}

function capturingLogger(): { logger: { log(m: string): void; warn(m: string): void }; lines: string[] } {
  const lines: string[] = [];
  return {
    logger: {
      log: (m: string) => lines.push(m),
      warn: (m: string) => lines.push(m),
    },
    lines,
  };
}

function clientWith(
  route: Route = () => undefined,
  opts: { now?: () => number } = {},
): {
  client: KeycloakIdentityAdminClient;
  calls: RecordedCall[];
  lines: string[];
} {
  const { fetch, calls } = stubFetch(route);
  const { logger, lines } = capturingLogger();
  const client = new KeycloakIdentityAdminClient({ config: CONFIG, fetch, logger, now: opts.now });
  return { client, calls, lines };
}

async function captureRejection(run: () => Promise<unknown>): Promise<unknown> {
  let returned = false;
  let thrown: unknown;
  try {
    await run();
    returned = true;
  } catch (err) {
    thrown = err;
  }
  if (returned) {
    throw new Error("expected the call to reject, but it resolved");
  }
  return thrown;
}

function reasonOf(err: unknown): string | undefined {
  return typeof err === "object" && err !== null
    ? String((err as { reason?: unknown }).reason)
    : undefined;
}

function messageOf(err: unknown): string {
  return typeof err === "object" && err !== null
    ? String((err as { message?: unknown }).message)
    : String(err);
}

const created = (id: string): Response =>
  new Response(null, { status: 201, headers: { Location: `${ADMIN}/users/${id}` } });

function adminCalls(calls: RecordedCall[]): RecordedCall[] {
  return calls.filter((c) => c.url !== TOKEN_URL);
}

// --- the token -------------------------------------------------------------

export async function assertTheTokenRequestIsClientCredentials(): Promise<void> {
  const { client, calls } = clientWith((c) =>
    c.url === `${ADMIN}/users/u-1` ? new Response(null, { status: 204 }) : undefined,
  );
  await client.setEnabled("u-1", true);
  const token = calls[0];
  const form = new URLSearchParams(token?.body ?? "");
  assert(
    token?.method === "POST" &&
      token.url === TOKEN_URL &&
      token.headers["content-type"] === "application/x-www-form-urlencoded" &&
      form.get("grant_type") === "client_credentials" &&
      form.get("client_id") === "bms-api-admin" &&
      form.get("client_secret") === CLIENT_SECRET,
    `the first request must be a client-credentials POST to the realm's token endpoint; got ${JSON.stringify(
      { method: token?.method, url: token?.url, type: token?.headers["content-type"], grant: form.get("grant_type") },
    )}`,
  );
}

export async function assertTheAdminCallCarriesTheBearerToken(): Promise<void> {
  const { client, calls } = clientWith((c) =>
    c.url === `${ADMIN}/users/u-1` ? new Response(null, { status: 204 }) : undefined,
  );
  await client.setEnabled("u-1", true);
  const call = adminCalls(calls)[0];
  assert(
    call?.headers["authorization"] === "Bearer tok-1",
    `the admin call must carry the client-credentials token; got ${String(call?.headers["authorization"])}`,
  );
}

export async function assertTheTokenIsReusedInsideItsLifetime(): Promise<void> {
  let clock = 1_000_000;
  const { client, calls } = clientWith(
    (c) => (c.url === `${ADMIN}/users/u-1` ? new Response(null, { status: 204 }) : undefined),
    { now: () => clock },
  );
  await client.setEnabled("u-1", true);
  clock += (300 - 31) * 1000;
  await client.setEnabled("u-1", false);
  const tokenRequests = calls.filter((c) => c.url === TOKEN_URL).length;
  assert(
    tokenRequests === 1,
    `a token 31 s short of expiry must be reused; ${tokenRequests} token requests were made`,
  );
}

export async function assertTheTokenIsRefreshedThirtySecondsBeforeExpiry(): Promise<void> {
  let clock = 1_000_000;
  const { client, calls } = clientWith(
    (c) => (c.url === `${ADMIN}/users/u-1` ? new Response(null, { status: 204 }) : undefined),
    { now: () => clock },
  );
  await client.setEnabled("u-1", true);
  clock += (300 - 30) * 1000;
  await client.setEnabled("u-1", false);
  const last = adminCalls(calls).at(-1);
  assert(
    calls.filter((c) => c.url === TOKEN_URL).length === 2 &&
      last?.headers["authorization"] === "Bearer tok-2",
    "at expires_in − 30 s the client must fetch a new token and use it",
  );
}

export async function assertATokenEndpoint401IsUnauthorizedClient(): Promise<void> {
  const { client } = clientWith((c) =>
    c.url === TOKEN_URL ? Response.json({ error: "unauthorized_client" }, { status: 401 }) : undefined,
  );
  const err = await captureRejection(() => client.setEnabled("u-1", true));
  assert(
    reasonOf(err) === "unauthorized_client",
    `a 401 from the token endpoint must be reason unauthorized_client; got ${String(reasonOf(err))}`,
  );
}

/** Node's `SyntaxError` quotes the input it failed on, so a raw parse leaks the body. */
export async function assertAMalformedTokenBodyDoesNotLeak(): Promise<void> {
  const { client } = clientWith((c) =>
    c.url === TOKEN_URL ? new Response(`not json ${SENTINEL}`, { status: 200 }) : undefined,
  );
  const err = await captureRejection(() => client.setEnabled("u-1", true));
  assert(
    reasonOf(err) === "unexpected_response" && !messageOf(err).includes(SENTINEL),
    `a non-JSON token body must be reason unexpected_response without echoing it; got ${reasonOf(err)}: ${messageOf(err)}`,
  );
}

// --- createUser ------------------------------------------------------------

async function createAndCaptureBody(): Promise<Record<string, unknown>> {
  const { client, calls } = clientWith((c) =>
    c.method === "POST" && c.url === `${ADMIN}/users` ? created("kc-1") : undefined,
  );
  await client.createUser({ email: "New.User@Example.COM", displayName: "New User" });
  const post = adminCalls(calls)[0];
  return JSON.parse(post?.body ?? "{}") as Record<string, unknown>;
}

export async function assertCreatePostsADisabledUser(): Promise<void> {
  const body = await createAndCaptureBody();
  assert(body.enabled === false, `createUser must post enabled: false; got ${String(body.enabled)}`);
}

export async function assertCreatePostsAVerifiedEmail(): Promise<void> {
  const body = await createAndCaptureBody();
  assert(
    body.emailVerified === true,
    `createUser must post emailVerified: true; got ${String(body.emailVerified)}`,
  );
}

export async function assertCreateLowerCasesTheUsernameAndEmail(): Promise<void> {
  const body = await createAndCaptureBody();
  assert(
    body.username === "new.user@example.com" && body.email === body.username,
    `username must be the lower-cased email and equal email; got ${String(body.username)} / ${String(body.email)}`,
  );
}

/** ADR 0089 D1: the full-name mapper emits `first` alone only when `last` is null, not `""`. */
export async function assertCreateWritesTheDisplayNameToFirstNameOnly(): Promise<void> {
  const body = await createAndCaptureBody();
  assert(
    body.firstName === "New User" && !("lastName" in body),
    `firstName must be the display name and lastName absent; got ${JSON.stringify(body)}`,
  );
}

export async function assertCreateReadsTheIdFromLocation(): Promise<void> {
  const { client, calls } = clientWith((c) =>
    c.method === "POST" && c.url === `${ADMIN}/users` ? created("kc-from-location") : undefined,
  );
  const result = await client.createUser({ email: "a@example.com", displayName: "A" });
  assert(
    result.id === "kc-from-location" && adminCalls(calls).length === 1,
    `the id must come from Location with no request after the POST; got ${result.id} after ${adminCalls(calls).length} admin calls`,
  );
}

/**
 * The fallback this refuses: a search by username or email when `Location` is
 * missing. The stub would answer that search with a different id, so a
 * mutant that falls back returns it instead of throwing.
 */
export async function assertCreateWithoutLocationThrowsAndNeverSearches(): Promise<void> {
  const { client, calls } = clientWith((c) => {
    if (c.method === "POST" && c.url === `${ADMIN}/users`) {
      return new Response(null, { status: 201 });
    }
    if (c.method === "GET" && c.url.startsWith(`${ADMIN}/users?`)) {
      return Response.json([{ id: "kc-from-search", username: "a@example.com" }]);
    }
    return undefined;
  });
  const err = await captureRejection(() =>
    client.createUser({ email: "a@example.com", displayName: "A" }),
  );
  assert(
    reasonOf(err) === "unexpected_response" &&
      !calls.some((c) => c.method === "GET" && c.url.startsWith(`${ADMIN}/users?`)),
    `a 201 without Location must throw unexpected_response and never search; got ${String(reasonOf(err))}, calls ${JSON.stringify(calls.map((c) => `${c.method} ${c.url}`))}`,
  );
}

export async function assertCreateConflictIsConflict(): Promise<void> {
  const { client } = clientWith((c) =>
    c.method === "POST" && c.url === `${ADMIN}/users`
      ? Response.json({ errorMessage: "User exists with same username" }, { status: 409 })
      : undefined,
  );
  const err = await captureRejection(() =>
    client.createUser({ email: "a@example.com", displayName: "A" }),
  );
  assert(reasonOf(err) === "conflict", `a 409 must be reason conflict; got ${String(reasonOf(err))}`);
}

function sentinelError(c: RecordedCall): Response | undefined {
  return c.method === "POST" && c.url === `${ADMIN}/users`
    ? Response.json({ error: "invalid", error_description: SENTINEL }, { status: 400 })
    : undefined;
}

export async function assertTheErrorDescriptionNeverReachesTheMessage(): Promise<void> {
  const { client } = clientWith(sentinelError);
  const err = await captureRejection(() =>
    client.createUser({ email: "leak@example.com", displayName: "Leak" }),
  );
  const message = messageOf(err);
  assert(
    reasonOf(err) === "bad_request" &&
      !message.includes(SENTINEL) &&
      !message.includes(CLIENT_SECRET) &&
      !message.includes("leak@example.com"),
    `the thrown error must carry the reason only — no error_description, secret or email; got ${message}`,
  );
}

export async function assertTheErrorDescriptionNeverReachesTheLog(): Promise<void> {
  const { client, lines } = clientWith(sentinelError);
  await captureRejection(() => client.createUser({ email: "leak@example.com", displayName: "Leak" }));
  const text = lines.join("\n");
  assert(
    text.includes("400") && !text.includes(SENTINEL) && !text.includes(CLIENT_SECRET),
    `the log must record the status and never the body or the secret; got ${JSON.stringify(lines)}`,
  );
}

// --- the other writes ------------------------------------------------------

export async function assertSetTemporaryPasswordSendsTemporaryTrue(): Promise<void> {
  const { client, calls } = clientWith((c) =>
    c.method === "PUT" && c.url === `${ADMIN}/users/u-1/reset-password`
      ? new Response(null, { status: 204 })
      : undefined,
  );
  await client.setTemporaryPassword("u-1", "correct-horse-battery");
  const body = JSON.parse(adminCalls(calls)[0]?.body ?? "{}") as Record<string, unknown>;
  assert(
    body.type === "password" && body.value === "correct-horse-battery" && body.temporary === true,
    `reset-password must send type password, the value and temporary: true; got keys ${Object.keys(body).join(",")}`,
  );
}

export async function assertSetEnabledPutsTheFlag(): Promise<void> {
  const { client, calls } = clientWith((c) =>
    c.method === "PUT" && c.url === `${ADMIN}/users/u-1` ? new Response(null, { status: 204 }) : undefined,
  );
  await client.setEnabled("u-1", false);
  const call = adminCalls(calls)[0];
  assert(
    call?.body === JSON.stringify({ enabled: false }),
    `setEnabled must PUT { enabled } to /users/{id}; got ${String(call?.method)} ${String(call?.body)}`,
  );
}

export async function assertLogoutSessionsPostsLogout(): Promise<void> {
  const { client, calls } = clientWith((c) =>
    c.method === "POST" && c.url === `${ADMIN}/users/u-1/logout`
      ? new Response(null, { status: 204 })
      : undefined,
  );
  await client.logoutSessions("u-1");
  assert(
    adminCalls(calls).length === 1,
    `logoutSessions must POST /users/{id}/logout once; got ${JSON.stringify(adminCalls(calls).map((c) => `${c.method} ${c.url}`))}`,
  );
}

export async function assertDeleteUserIsDeleteUsersId(): Promise<void> {
  const { client, calls } = clientWith((c) =>
    c.method === "DELETE" && c.url === `${ADMIN}/users/u-1`
      ? new Response(null, { status: 204 })
      : undefined,
  );
  await client.deleteUser("u-1");
  const call = adminCalls(calls)[0];
  assert(
    call?.method === "DELETE" && call.url === `${ADMIN}/users/u-1`,
    `deleteUser must be DELETE /users/{id}; got ${String(call?.method)} ${String(call?.url)}`,
  );
}

export async function assertTheIdIsEscapedInThePath(): Promise<void> {
  const { client, calls } = clientWith((c) =>
    c.url === TOKEN_URL ? undefined : new Response(null, { status: 204 }),
  );
  await client.deleteUser("../roles");
  const call = adminCalls(calls)[0];
  assert(
    call?.url === `${ADMIN}/users/..%2Froles`,
    `the id must be URI-encoded into the path; got ${String(call?.url)}`,
  );
}

export async function assertANetworkFailureIsUnavailable(): Promise<void> {
  const fetchStub = (async () => {
    throw new TypeError(`fetch failed ${SENTINEL}`);
  }) as typeof globalThis.fetch;
  const client = new KeycloakIdentityAdminClient({
    config: CONFIG,
    fetch: fetchStub,
    logger: capturingLogger().logger,
  });
  const err = await captureRejection(() => client.deleteUser("u-1"));
  assert(
    reasonOf(err) === "unavailable" && !messageOf(err).includes(SENTINEL),
    `a fetch that throws must be reason unavailable with a fixed message; got ${String(reasonOf(err))}: ${messageOf(err)}`,
  );
}

/** U5 matches by `name`, never `instanceof` (F4.108). */
export async function assertTheErrorIsNamedIdentityAdminError(): Promise<void> {
  const { client } = clientWith();
  const err = await captureRejection(() => client.deleteUser("u-1"));
  assert(
    typeof err === "object" && err !== null && (err as { name?: unknown }).name === "IdentityAdminError",
    `a failure must throw an error named IdentityAdminError; got ${String((err as { name?: unknown })?.name)}`,
  );
}

// --- setRealmRole ----------------------------------------------------------

const ROLE_REPS: Record<string, { id: string; name: string; composite: boolean }> = Object.fromEntries(
  [...BMS_REALM_ROLES, "default-roles-bms", "offline_access", "uma_authorization"].map((name) => [
    name,
    { id: `role-${name}`, name, composite: false },
  ]),
);

function roleRoute(mapped: string[], available: string[]): Route {
  return (c) => {
    const base = `${ADMIN}/users/u-1/role-mappings/realm`;
    if (c.method === "GET" && c.url === base) {
      return Response.json(mapped.map((n) => ROLE_REPS[n]));
    }
    if (c.method === "GET" && c.url === `${base}/available`) {
      return Response.json(available.map((n) => ROLE_REPS[n]));
    }
    if ((c.method === "POST" || c.method === "DELETE") && c.url === base) {
      return new Response(null, { status: 204 });
    }
    return undefined;
  };
}

function namesSent(calls: RecordedCall[], method: string): string[] | undefined {
  const call = adminCalls(calls).find(
    (c) => c.method === method && c.url === `${ADMIN}/users/u-1/role-mappings/realm`,
  );
  if (!call) {
    return undefined;
  }
  return (JSON.parse(call.body ?? "[]") as { name: string }[]).map((r) => r.name).sort();
}

async function setViewerOverEveryOtherRole(): Promise<RecordedCall[]> {
  const others = BMS_REALM_ROLES.filter((r) => r !== "viewer");
  const { client, calls } = clientWith(
    roleRoute([...others, "default-roles-bms", "offline_access"], ["viewer", "uma_authorization"]),
  );
  await client.setRealmRole("u-1", "viewer");
  return calls;
}

export async function assertSetRealmRoleRemovesTheOtherFive(): Promise<void> {
  const calls = await setViewerOverEveryOtherRole();
  const removed = namesSent(calls, "DELETE");
  const expected = BMS_REALM_ROLES.filter((r) => r !== "viewer").sort();
  assert(
    JSON.stringify(removed) === JSON.stringify(expected),
    `setRealmRole must remove exactly the other five BMS roles; got ${JSON.stringify(removed)}`,
  );
}

export async function assertSetRealmRoleAddsTheOne(): Promise<void> {
  const calls = await setViewerOverEveryOtherRole();
  const added = namesSent(calls, "POST");
  assert(
    JSON.stringify(added) === JSON.stringify(["viewer"]),
    `setRealmRole must add exactly the target role; got ${JSON.stringify(added)}`,
  );
}

export async function assertSetRealmRoleLeavesTheDefaultRolesMapped(): Promise<void> {
  const calls = await setViewerOverEveryOtherRole();
  const removed = namesSent(calls, "DELETE") ?? [];
  assert(
    removed.length > 0 && !removed.includes("default-roles-bms") && !removed.includes("offline_access"),
    `setRealmRole must leave default-roles-bms and offline_access mapped; removed ${JSON.stringify(removed)}`,
  );
}

/** The DELETE must carry Keycloak's own role id — the endpoint matches on it. */
export async function assertSetRealmRoleSendsTheRoleIds(): Promise<void> {
  const calls = await setViewerOverEveryOtherRole();
  const post = adminCalls(calls).find((c) => c.method === "POST");
  const sent = JSON.parse(post?.body ?? "[]") as { id?: string; name?: string }[];
  assert(
    sent.length === 1 && sent[0]?.id === "role-viewer" && sent[0]?.name === "viewer",
    `the role representation must carry Keycloak's id and name; got ${post?.body}`,
  );
}

export async function assertSetRealmRoleDoesNotReAddAMappedRole(): Promise<void> {
  const { client, calls } = clientWith(roleRoute(["viewer", "operator", "default-roles-bms"], []));
  await client.setRealmRole("u-1", "viewer");
  assert(
    namesSent(calls, "POST") === undefined &&
      JSON.stringify(namesSent(calls, "DELETE")) === JSON.stringify(["operator"]),
    "an already-mapped target must not be POSTed again, and the other BMS role must still go",
  );
}

/** Fail before mutating: a role that cannot be added must not cost the user the one it has. */
export async function assertSetRealmRoleRefusesAnUnavailableRoleBeforeRemovingAnything(): Promise<void> {
  const { client, calls } = clientWith(roleRoute(["operator", "default-roles-bms"], ["uma_authorization"]));
  const err = await captureRejection(() => client.setRealmRole("u-1", "viewer"));
  assert(
    reasonOf(err) === "not_found" && namesSent(calls, "DELETE") === undefined,
    `a target neither mapped nor available must throw not_found before any DELETE; got ${String(reasonOf(err))}`,
  );
}

// --- mapKeycloakFailure ----------------------------------------------------

export function assertMapKeycloakFailureIsAFixedTable(): void {
  const table: [number, IdentityAdminFailureReason][] = [
    [400, "bad_request"],
    [401, "unauthorized_client"],
    [403, "forbidden"],
    [404, "not_found"],
    [409, "conflict"],
    [500, "unavailable"],
    [503, "unavailable"],
    [302, "unexpected_response"],
    [418, "unexpected_response"],
  ];
  const wrong = table.filter(([status, reason]) => mapKeycloakFailure(status) !== reason);
  assert(
    wrong.length === 0,
    `mapKeycloakFailure must map status to a fixed reason; wrong for ${JSON.stringify(
      wrong.map(([s, r]) => ({ status: s, expected: r, got: mapKeycloakFailure(s) })),
    )}`,
  );
}

// --- the module and the fake -----------------------------------------------

export async function assertNotConfiguredRejectsEveryMethod(): Promise<void> {
  const admin = new NotConfiguredIdentityAdmin();
  const runs: (() => Promise<unknown>)[] = [
    () => admin.createUser({ email: "a@example.com", displayName: "A" }),
    () => admin.setTemporaryPassword("u-1", "x".repeat(12)),
    () => admin.setEnabled("u-1", true),
    () => admin.setRealmRole("u-1", "viewer"),
    () => admin.logoutSessions("u-1"),
    () => admin.deleteUser("u-1"),
  ];
  const reasons: (string | undefined)[] = [];
  for (const run of runs) {
    reasons.push(reasonOf(await captureRejection(run)));
  }
  assert(
    reasons.length === 6 && reasons.every((r) => r === "not_configured"),
    `every NotConfiguredIdentityAdmin method must reject with not_configured; got ${JSON.stringify(reasons)}`,
  );
}

export function assertCreateIdentityAdminPicksTheStandInWhenUnconfigured(): void {
  const admin = createIdentityAdmin({}, () => undefined);
  assert(
    admin instanceof NotConfiguredIdentityAdmin,
    "an unconfigured environment must provide NotConfiguredIdentityAdmin",
  );
}

export function assertCreateIdentityAdminPicksTheClientWhenConfigured(): void {
  const admin = createIdentityAdmin(
    {
      KEYCLOAK_ADMIN_URL: "https://id.example",
      KEYCLOAK_ADMIN_REALM: "bms",
      KEYCLOAK_ADMIN_CLIENT_ID: "bms-api-admin",
      KEYCLOAK_ADMIN_CLIENT_SECRET: CLIENT_SECRET,
    },
    () => undefined,
  );
  assert(
    admin instanceof KeycloakIdentityAdminClient,
    "a configured environment must provide KeycloakIdentityAdminClient",
  );
}

export async function assertTheFakeRecordsCallsAndFailsOnce(): Promise<void> {
  const fake = new FakeIdentityAdmin();
  fake.failNext("setEnabled", "unavailable");
  const first = reasonOf(await captureRejection(() => fake.setEnabled("u-1", true)));
  await fake.setEnabled("u-1", true);
  const role: UserRole = "viewer";
  await fake.setRealmRole("u-1", role);
  assert(
    first === "unavailable" &&
      JSON.stringify(fake.calls.map((c) => c.method)) ===
        JSON.stringify(["setEnabled", "setEnabled", "setRealmRole"]),
    `the fake must fail once with the queued reason and record every call; got ${String(first)}, ${JSON.stringify(fake.calls)}`,
  );
}

export async function assertTheFakeReturnsDistinctIds(): Promise<void> {
  const fake = new FakeIdentityAdmin();
  const a = await fake.createUser({ email: "a@example.com", displayName: "A" });
  const b = await fake.createUser({ email: "b@example.com", displayName: "B" });
  assert(a.id !== b.id, `the fake must return a distinct id per created user; got ${a.id} twice`);
}

export function assertTheErrorClassCarriesAReason(): void {
  const err = new IdentityAdminError("conflict", 409);
  assert(
    err.reason === "conflict" && err.status === 409 && err.message.includes("conflict"),
    `IdentityAdminError must carry its reason and status; got ${err.reason}/${String(err.status)}: ${err.message}`,
  );
}
