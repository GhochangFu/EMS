import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * `F3.78` U4 (ADR 0089 decisions 4–6, plan U4) — the static half of the realm
 * file, `infra/keycloak/bms-realm.json`, which every fresh host and CI's
 * `--import-realm` step load.
 *
 * - **No `secret` key anywhere.** A secret in the repository would be live on
 *   the first boot of every new host, with Keycloak published on `8080`
 *   (decision 5). Each host's secret comes from `keycloak:provision`.
 * - **No `passwordPolicy` key anywhere.** The seven demo users carry short
 *   plaintext credentials; whether Keycloak 24 applies the realm policy on the
 *   import path was not proved, and a failed import leaves nobody able to sign
 *   in. The policy lands in the provisioning step instead, and K6 proves it
 *   live (plan U4).
 * - **`bms-api-admin`** is confidential and service-account only, and its
 *   service account holds exactly `manage-users` and `view-users`.
 * - **Only an admin edits a user's email** (decision 4): the declarative user
 *   profile component's inner JSON sets `email.permissions.edit` to `["admin"]`.
 *
 * Every absence claim has a positive control that the walk saw the file: a
 * walker that read nothing would pass an absence claim vacuously.
 */

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const REALM_PATH = join(ROOT, "infra", "keycloak", "bms-realm.json");

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Obj = { [key: string]: Json };

function readRealm(): Obj {
  return JSON.parse(readFileSync(REALM_PATH, "utf8")) as Obj;
}

/** Every object key in the document, at any depth. */
function allKeys(node: Json, into: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const item of node) allKeys(item, into);
  } else if (node !== null && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      into.push(key);
      allKeys(value, into);
    }
  }
  return into;
}

function clientNamed(realm: Obj, clientId: string): Obj | undefined {
  return (realm.clients as Obj[]).find((c) => c.clientId === clientId);
}

function userProfileConfig(realm: Obj): { attributes: Obj[] } {
  const components = realm.components as Obj;
  const providers = components["org.keycloak.userprofile.UserProfileProvider"] as Obj[];
  const declarative = providers.find((p) => p.providerId === "declarative-user-profile")!;
  const raw = ((declarative.config as Obj)["kc.user.profile.config"] as string[])[0]!;
  return JSON.parse(raw) as { attributes: Obj[] };
}

describe("F3.78 U4 — the bms realm file (ADR 0089 decisions 4–6)", () => {
  it("parses as JSON and is realm bms", () => {
    expect(readRealm().realm).toBe("bms");
  });

  it("the walk sees the bms-web client's keys (positive control for the absence cases)", () => {
    expect(allKeys(readRealm())).toContain("publicClient");
  });

  it("carries no secret key anywhere", () => {
    expect(allKeys(readRealm())).not.toContain("secret");
  });

  it("carries no passwordPolicy key anywhere — the policy is provisioned", () => {
    expect(allKeys(readRealm())).not.toContain("passwordPolicy");
  });

  it("turns brute-force protection on", () => {
    expect(readRealm().bruteForceProtected).toBe(true);
  });

  it("locks out temporarily, never permanently", () => {
    expect(readRealm().permanentLockout).toBe(false);
  });

  it("does not let a username be edited", () => {
    expect(readRealm().editUsernameAllowed).toBe(false);
  });

  it("bms-api-admin is a confidential, service-account-only client", () => {
    const client = clientNamed(readRealm(), "bms-api-admin");
    expect({
      publicClient: client?.publicClient,
      serviceAccountsEnabled: client?.serviceAccountsEnabled,
      standardFlowEnabled: client?.standardFlowEnabled,
      directAccessGrantsEnabled: client?.directAccessGrantsEnabled,
      implicitFlowEnabled: client?.implicitFlowEnabled,
    }).toEqual({
      publicClient: false,
      serviceAccountsEnabled: true,
      standardFlowEnabled: false,
      directAccessGrantsEnabled: false,
      implicitFlowEnabled: false,
    });
  });

  it("the service account holds exactly manage-users and view-users", () => {
    const user = (readRealm().users as Obj[]).find((u) => u.username === "service-account-bms-api-admin");
    expect(user?.serviceAccountClientId).toBe("bms-api-admin");
    const roles = ((user?.clientRoles as Obj | undefined)?.["realm-management"] as string[] | undefined) ?? [];
    expect([...roles].sort()).toEqual(["manage-users", "view-users"]);
  });

  it('the user profile\'s email.permissions.edit is ["admin"]', () => {
    const email = userProfileConfig(readRealm()).attributes.find((a) => a.name === "email");
    expect((email?.permissions as Obj | undefined)?.edit).toEqual(["admin"]);
  });

  it("the user profile keeps username, firstName and lastName", () => {
    const names = userProfileConfig(readRealm()).attributes.map((a) => a.name);
    expect(names).toEqual(["username", "email", "firstName", "lastName"]);
  });

  /**
   * Decision 4 makes `oidc_subject` the only join from a token to a row, and a
   * pool role cannot re-point a set subject. The subject is the Keycloak user
   * id, and `start-dev` keeps the realm in the container: every re-import of
   * this file on a recreated container would mint new ids, and every linked
   * row would then miss its user (the admin refused, every other role scoped
   * to nothing). A pinned `id` per user keeps the subject stable across a
   * re-import.
   */
  it("pins a unique uuid id on every user, the service account included", () => {
    const realmUsers = readRealm().users as Obj[];
    expect(realmUsers.map((u) => u.username), "positive control: the walk saw the service account").toContain(
      "service-account-bms-api-admin",
    );
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    for (const u of realmUsers) {
      expect(typeof u.id === "string" && UUID.test(u.id), `${String(u.username)} must pin a uuid id`).toBe(true);
    }
    const ids = realmUsers.map((u) => u.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
