import { randomUUID } from "node:crypto";

import { BMS_REALM_ROLES, KeycloakIdentityAdminClient } from "./identity-admin.client";
import type { IdentityAdminConfig } from "./identity-admin.config";

/**
 * `F3.78` U3 (ADR 0089 decision 5, plan D1/D6) — `KeycloakIdentityAdminClient`
 * against a real Keycloak 24 with the `bms` realm imported and provisioned
 * (U4's `keycloak:provision`).
 *
 * Gated by `requireKeycloak` in the `.test.ts`: skipped locally without
 * `KEYCLOAK_ADMIN_URL`, a hard failure in CI (owner ruling Q-A).
 *
 * The realm is shared, so every user this file creates has a unique
 * `f378-k*-<uuid>@bms.test` email and is deleted by
 * {@link cleanUpCreatedUsers}. The client has no read methods, so the reads
 * that check its writes go through {@link adminGet} under the same service
 * account — a read the service account cannot make is itself a finding (D1).
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const createdIds = new Set<string>();

function clientFor(config: IdentityAdminConfig): KeycloakIdentityAdminClient {
  return new KeycloakIdentityAdminClient({ config });
}

function uniqueEmail(tag: string): string {
  return `f378-${tag}-${randomUUID()}@bms.test`;
}

async function createTracked(
  client: KeycloakIdentityAdminClient,
  tag: string,
): Promise<{ id: string; email: string }> {
  const email = uniqueEmail(tag);
  const { id } = await client.createUser({ email, displayName: `F3.78 ${tag}` });
  createdIds.add(id);
  return { id, email };
}

async function serviceAccountToken(config: IdentityAdminConfig): Promise<string> {
  const res = await fetch(`${config.url}/realms/${config.realm}/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }).toString(),
  });
  assert(res.ok, `the service-account token request must succeed; got HTTP ${res.status}`);
  const body = (await res.json()) as { access_token: string };
  return body.access_token;
}

/** A GET under `/admin/realms/{realm}` with the service account. Status and parsed body. */
async function adminGet(
  config: IdentityAdminConfig,
  path: string,
): Promise<{ status: number; body: unknown }> {
  const token = await serviceAccountToken(config);
  const res = await fetch(`${config.url}/admin/realms/${config.realm}${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const body: unknown = res.ok ? await res.json() : null;
  return { status: res.status, body };
}

export async function cleanUpCreatedUsers(config: IdentityAdminConfig): Promise<void> {
  const client = clientFor(config);
  for (const id of createdIds) {
    await client.deleteUser(id).catch(() => undefined);
  }
  createdIds.clear();
}

/** K1 — D1: `available` is readable under `view-users`, so `view-realm` is not needed. */
export async function assertK1AvailableRealmRolesAreReadable(config: IdentityAdminConfig): Promise<void> {
  const { id } = await createTracked(clientFor(config), "k1");
  const { status } = await adminGet(config, `/users/${id}/role-mappings/realm/available`);
  assert(
    status === 200,
    `GET /users/{id}/role-mappings/realm/available must be 200 under the service account; got ${status} — ` +
      "if 403, add view-realm in the provisioning step (plan D1)",
  );
}

export async function assertK2ACreatedUserIsDisabled(config: IdentityAdminConfig): Promise<void> {
  const { id } = await createTracked(clientFor(config), "k2a");
  const { body } = await adminGet(config, `/users/${id}`);
  assert(
    (body as { enabled?: unknown } | null)?.enabled === false,
    `a created user must be disabled; got enabled=${String((body as { enabled?: unknown } | null)?.enabled)}`,
  );
}

/** Create → password → role → role again → enable, then exactly one BMS role. */
async function runTheK2Flow(config: IdentityAdminConfig): Promise<string> {
  const client = clientFor(config);
  const { id } = await createTracked(client, "k2");
  await client.setTemporaryPassword(id, `F3.78-${randomUUID()}`);
  await client.setRealmRole(id, "viewer");
  await client.setRealmRole(id, "operator");
  await client.setEnabled(id, true);
  return id;
}

export async function assertK2TheFlowLeavesOneBmsRealmRole(config: IdentityAdminConfig): Promise<void> {
  const id = await runTheK2Flow(config);
  const { body } = await adminGet(config, `/users/${id}/role-mappings/realm`);
  const bmsNames: readonly string[] = BMS_REALM_ROLES;
  const names = ((body as { name: string }[] | null) ?? []).map((r) => r.name);
  const bms = names.filter((n) => bmsNames.includes(n));
  assert(
    JSON.stringify(bms) === JSON.stringify(["operator"]),
    `after viewer then operator, exactly one BMS realm role (operator) must be mapped; got ${JSON.stringify(names)}`,
  );
}

export async function assertK2TheFlowLeavesTheDefaultRolesMapped(config: IdentityAdminConfig): Promise<void> {
  const id = await runTheK2Flow(config);
  const { body } = await adminGet(config, `/users/${id}/role-mappings/realm`);
  const names = ((body as { name: string }[] | null) ?? []).map((r) => r.name);
  assert(
    names.includes("default-roles-bms"),
    `setRealmRole must leave default-roles-bms mapped; got ${JSON.stringify(names)}`,
  );
}

export async function assertK2TheFlowEnablesTheUser(config: IdentityAdminConfig): Promise<void> {
  const id = await runTheK2Flow(config);
  const { body } = await adminGet(config, `/users/${id}`);
  assert(
    (body as { enabled?: unknown } | null)?.enabled === true,
    "after setEnabled(true) the user must be enabled",
  );
}

export async function assertK2TheFlowSetsATemporaryPassword(config: IdentityAdminConfig): Promise<void> {
  const id = await runTheK2Flow(config);
  const { body } = await adminGet(config, `/users/${id}`);
  const actions = (body as { requiredActions?: unknown } | null)?.requiredActions;
  assert(
    Array.isArray(actions) && actions.includes("UPDATE_PASSWORD"),
    `a temporary password must leave UPDATE_PASSWORD required; got ${JSON.stringify(actions)}`,
  );
}

export async function assertK3ADuplicateEmailIsConflict(config: IdentityAdminConfig): Promise<void> {
  const client = clientFor(config);
  const { email } = await createTracked(client, "k3");
  let reason: unknown;
  try {
    const { id } = await client.createUser({ email: email.toUpperCase(), displayName: "F3.78 k3 dup" });
    createdIds.add(id);
  } catch (err) {
    reason = (err as { reason?: unknown }).reason;
  }
  assert(reason === "conflict", `a duplicate email must be reason conflict; got ${String(reason)}`);
}

export async function assertK4DeleteUserRemovesTheUser(config: IdentityAdminConfig): Promise<void> {
  const client = clientFor(config);
  const { id } = await createTracked(client, "k4");
  await client.deleteUser(id);
  createdIds.delete(id);
  const { status } = await adminGet(config, `/users/${id}`);
  assert(status === 404, `a deleted user must be 404; got ${status}`);
}

/** K5 — decision 3: only an admin edits a user's email in Keycloak. */
export async function assertK5OnlyAnAdminEditsTheEmail(config: IdentityAdminConfig): Promise<void> {
  const { status, body } = await adminGet(config, "/users/profile");
  const attributes = (body as { attributes?: { name: string; permissions?: { edit?: unknown } }[] } | null)
    ?.attributes;
  const edit = attributes?.find((a) => a.name === "email")?.permissions?.edit;
  assert(
    JSON.stringify(edit) === JSON.stringify(["admin"]),
    `the user profile's email.permissions.edit must be ["admin"]; got HTTP ${status}, ${JSON.stringify(edit)}`,
  );
}

/**
 * K5 — owner ruling Q-D: `firstName` and `lastName` carry no `required` block,
 * so a user created with `firstName` only (D1) meets no "update profile" page.
 */
export async function assertK5TheNamesAreOptional(config: IdentityAdminConfig): Promise<void> {
  const { status, body } = await adminGet(config, "/users/profile");
  const attributes = (body as { attributes?: { name: string }[] } | null)?.attributes ?? [];
  const names = attributes.filter((a) => a.name === "firstName" || a.name === "lastName");
  assert(
    names.length === 2 && names.every((a) => !Object.prototype.hasOwnProperty.call(a, "required")),
    `firstName and lastName must carry no required block; got HTTP ${status}, ${JSON.stringify(names)}`,
  );
}

/**
 * Owner ruling Q-C: the service account (`manage-users`, `view-users`) gets a
 * reduced realm representation with neither `passwordPolicy` nor
 * `bruteForceProtected`, and it does not gain `view-realm`. K6 therefore reads
 * the realm as the bootstrap master admin on `admin-cli` — the identity
 * `keycloak:provision` writes it with. The two variables are the ones the
 * provisioning step reads; unset, K6 fails rather than skipping, because a set
 * `KEYCLOAK_ADMIN_URL` is a claim that Keycloak is there to be read.
 */
async function realmAsMasterAdmin(config: IdentityAdminConfig): Promise<{ status: number; body: unknown }> {
  const username = process.env.KEYCLOAK_ADMIN?.trim();
  const password = process.env.KEYCLOAK_ADMIN_PASSWORD;
  assert(
    !!username && !!password,
    "K6 reads the realm as the master admin: KEYCLOAK_ADMIN and KEYCLOAK_ADMIN_PASSWORD must be set (ruling Q-C)",
  );
  const tokenRes = await fetch(`${config.url}/realms/master/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "password",
      client_id: "admin-cli",
      username: username!,
      password: password!,
    }).toString(),
  });
  assert(tokenRes.ok, `the master-admin token request must succeed; got HTTP ${tokenRes.status}`);
  const { access_token } = (await tokenRes.json()) as { access_token: string };
  const res = await fetch(`${config.url}/admin/realms/${config.realm}`, {
    headers: { authorization: `Bearer ${access_token}` },
  });
  const body: unknown = res.ok ? await res.json() : null;
  return { status: res.status, body };
}

export async function assertK6ThePasswordPolicyIsProvisioned(config: IdentityAdminConfig): Promise<void> {
  const { status, body } = await realmAsMasterAdmin(config);
  const policy = (body as { passwordPolicy?: unknown } | null)?.passwordPolicy;
  assert(
    typeof policy === "string" && policy.includes("length(12)"),
    `after provisioning, passwordPolicy must contain length(12); got HTTP ${status}, ${JSON.stringify(policy)}`,
  );
}

export async function assertK6BruteForceProtectionIsOn(config: IdentityAdminConfig): Promise<void> {
  const { status, body } = await realmAsMasterAdmin(config);
  const on = (body as { bruteForceProtected?: unknown } | null)?.bruteForceProtected;
  assert(on === true, `bruteForceProtected must be true; got HTTP ${status}, ${String(on)}`);
}
