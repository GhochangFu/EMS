import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * `F4.17` / ADR 0125 decisions 10 and 17, plan U8 and U9 — the text of
 * migration `0145` and the human-only filters. What Postgres enforces is
 * `tests/f4.17-service-accounts-schema.integration.test.ts`; this pins the
 * statements and the call sites so a later edit cannot drop one quietly.
 * Comment-stripped reads throughout.
 */

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");
const sqlCode = (rel: string): string => read(rel).replace(/^\s*--.*$/gm, "");
const tsCode = (rel: string): string =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

const MIGRATION = "packages/db/drizzle/0145_service_accounts.sql";
const FOLLOW_UP = "packages/db/drizzle/0146_service_account_token_guard.sql";
const created = sqlCode(MIGRATION);
const followUp = sqlCode(FOLLOW_UP);
/**
 * Both files, in apply order. 0146 replaces 0145's guard, policies and
 * service-row CHECK (the PR 3 review findings, forward-only); the integration
 * test is what proves the effective state, so these text checks only pin that
 * each statement exists.
 */
const migration = `${created}\n${followUp}`;

describe("F4.17 — migration 0145 (service accounts)", () => {
  it("is in the journal, after 0143", () => {
    const journal = JSON.parse(read("packages/db/drizzle/meta/_journal.json")) as {
      entries: Array<{ tag: string; idx: number }>;
    };
    const tags = journal.entries.map((e) => e.tag);
    expect(tags).toContain("0145_service_accounts");
    expect(tags.indexOf("0145_service_accounts")).toBe(tags.indexOf("0144_work_order_events") + 1);
    expect(tags.indexOf("0146_service_account_token_guard")).toBe(tags.indexOf("0145_service_accounts") + 1);
  });

  it("creates the table as bms_owner and forces row level security", () => {
    expect(migration).toMatch(/SET ROLE bms_owner;[\s\S]*CREATE TABLE IF NOT EXISTS bms\.service_account_tokens[\s\S]*RESET ROLE;/);
    expect(migration).toMatch(/ALTER TABLE bms\.service_account_tokens ENABLE ROW LEVEL SECURITY;/);
    expect(migration).toMatch(/ALTER TABLE bms\.service_account_tokens FORCE ROW LEVEL SECURITY;/);
  });

  it("adds users.kind with both CHECKs and the composite-key target", () => {
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS kind varchar\(16\) NOT NULL DEFAULT 'human'/);
    expect(migration).toMatch(/users_kind_check CHECK \(kind IN \('human', 'service'\)\)/);
    expect(migration).toMatch(
      /users_service_account_check CHECK \(\s*kind <> 'service'\s*OR \(\s*password_hash IS NULL\s*AND oidc_subject IS NULL\s*AND email LIKE 'svc-%@service-account\.invalid'\s*AND organization_id IS NOT NULL\s*AND role IN \('viewer', 'operator'\)/,
    );
    expect(migration).toMatch(/users_id_organization_id_key UNIQUE \(id, organization_id\)/);
  });

  it("holds a token to its organization's account by a composite key and a kind trigger", () => {
    expect(migration).toMatch(
      /FOREIGN KEY \(service_account_id, organization_id\)\s*REFERENCES bms\.users \(id, organization_id\)/,
    );
    expect(migration).toMatch(/BEFORE INSERT OR UPDATE ON bms\.service_account_tokens/);
    expect(migration).toMatch(/u\.kind = 'service'\s*AND u\.disabled_at IS NULL/);
  });

  it("0146 replaces the guard, the bms_auth policies and the service-row CHECK", () => {
    expect(followUp).toMatch(/CREATE OR REPLACE FUNCTION bms\.service_account_tokens_guard_kind\(\)/);
    expect(followUp).toMatch(/DROP TRIGGER IF EXISTS service_account_tokens_guard_kind/);
    expect(followUp).toMatch(/DROP POLICY IF EXISTS auth_token_lookup/);
    expect(followUp).toMatch(/DROP CONSTRAINT IF EXISTS users_service_account_check/);
    expect(followUp).toMatch(/RAISE EXCEPTION 'migration 0146: the guard trigger does not fire on both INSERT and UPDATE'/);
  });

  it("the guard stamps created_at and makes revocation final (review M1, M2)", () => {
    expect(migration).toMatch(/NEW\.created_at := now\(\);/);
    expect(migration).toMatch(/NEW\.revoked_at := NULL;/);
    expect(migration).toMatch(/OLD\.revoked_at IS NOT NULL\s*AND \(NEW\.revoked_at IS DISTINCT FROM OLD\.revoked_at OR NEW\.revoked_by IS DISTINCT FROM OLD\.revoked_by\)/);
  });

  it("grants no pool role DELETE and keeps token_hash from bms_tenant and bms_fleet", () => {
    expect(migration).toMatch(/REVOKE DELETE ON bms\.service_account_tokens FROM bms_tenant, bms_fleet;/);
    expect(migration).not.toMatch(/GRANT[^;]*DELETE[^;]*service_account_tokens/);
    expect(migration).toMatch(/REVOKE SELECT ON bms\.service_account_tokens FROM bms_tenant, bms_fleet;/);
    const tenantSelect = /GRANT SELECT \(([^)]*)\) ON bms\.service_account_tokens TO bms_tenant, bms_fleet;/.exec(migration);
    expect(tenantSelect, "the tenant/fleet column SELECT grant").not.toBeNull();
    expect(tenantSelect?.[1]).not.toMatch(/token_hash/);
    expect(migration).toMatch(/GRANT UPDATE \(revoked_at, revoked_by\) ON bms\.service_account_tokens TO bms_tenant, bms_fleet;/);
  });

  it("gives bms_auth the verifier's read and last_used_at only, through role-scoped policies", () => {
    // Scoped to live tokens, so a verifier that forgot a test still finds nothing.
    expect(migration).toMatch(
      /CREATE POLICY auth_token_lookup ON bms\.service_account_tokens\s*FOR SELECT TO bms_auth USING \(revoked_at IS NULL AND expires_at > now\(\)\);/,
    );
    expect(migration).toMatch(/CREATE POLICY auth_token_touch ON bms\.service_account_tokens\s*FOR UPDATE TO bms_auth/);
    expect(migration).toMatch(/GRANT UPDATE \(last_used_at\) ON bms\.service_account_tokens TO bms_auth;/);
    const authSelect = /GRANT SELECT \(([^)]*)\) ON bms\.service_account_tokens TO bms_auth;/.exec(migration);
    expect(authSelect?.[1]).toMatch(/token_hash/);
  });

  it("names users.kind for the pools and never for UPDATE", () => {
    expect(migration).toMatch(/GRANT SELECT \(kind\) ON bms\.users TO bms_tenant, bms_fleet, bms_auth;/);
    expect(migration).toMatch(/GRANT INSERT \(kind\) ON bms\.users TO bms_tenant, bms_fleet;/);
    expect(migration).not.toMatch(/GRANT UPDATE \([^)]*kind[^)]*\) ON bms\.users/);
  });

  it("proves its own policies and grants (the 0141 idiom)", () => {
    expect(migration).toMatch(/RAISE EXCEPTION 'migration 0145: row level security/);
    expect(migration).toMatch(/has_column_privilege\('bms_tenant', 'bms\.service_account_tokens', 'token_hash', 'SELECT'\)/);
  });
});

/** Plan U9 — each human-only users query names `kind = 'human'`. */
const HUMAN_ONLY_SITES: ReadonlyArray<readonly [string, number]> = [
  ["apps/api/src/admin/users/users.service.ts", 4], // list (two branches), readUser, requireManageableTarget
  ["apps/api/src/auth/auth.service.ts", 1], // local login
  ["apps/api/src/auth/identity-resolver.ts", 1], // the subject link
  ["apps/api/src/work-orders/assignee.ts", 1], // a work-order assignee
  ["apps/api/src/copilot/copilot-access.service.ts", 1], // a copilot override target
];

describe("F4.17 — human-only users queries (plan U9)", () => {
  it.each(HUMAN_ONLY_SITES)("%s filters kind = human (%i site(s))", (rel, count) => {
    // Exact, so a new occurrence elsewhere in the file cannot hide a removed
    // one (code review, false green 4). The behaviour is in the DB-backed
    // apps/api/src/auth/service-account-identity.integration.spec.ts.
    const matches = tsCode(rel).match(/eq\(users\.kind, "human"\)/g) ?? [];
    expect(matches.length).toBe(count);
  });

  it("the guard refuses a JWT whose row is a service account", () => {
    expect(tsCode("apps/api/src/auth/jwt-auth.guard.ts")).toMatch(
      /if \(identity\?\.kind === "service"\) \{\s*throw new UnauthorizedException/,
    );
  });
});
