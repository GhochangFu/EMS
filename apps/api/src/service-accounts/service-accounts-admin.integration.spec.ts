import { ConflictException, ForbiddenException, NotFoundException, BadRequestException } from "@nestjs/common";
import type pg from "pg";
import { expect } from "vitest";

import { createDb } from "@bms/db";
import type { BmsDb } from "@bms/db";
import { createServiceTokenResponseSchema, serviceAccountsListResponseSchema, type JwtPayload } from "@bms/shared";

import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { AccessControlService } from "../auth/access-control.service";
import { ServiceAccountsAdminService } from "./service-accounts-admin.service";
import { ServiceTokenVerifier } from "./service-token-verifier.service";

/**
 * `F4.17` / ADR 0125 decisions 10–15 — `ServiceAccountsAdminService` on the
 * real pools (fleet reads, tenant writes under RLS, the 0145 guard trigger,
 * audit rows), with the seeded `admin@bms.local` (global admin),
 * `phe-admin@bms.local` (organization admin of PHEWB) and `wc-admin@bms.local`
 * (location admin of ESKOM). Local `AUTH_MODE`, so a principal resolves by
 * `users.id = sub`. Everything the suite creates is removed in `closeAdminSuite`.
 */

export type AdminSuite = {
  superPool: pg.Pool;
  service: ServiceAccountsAdminService;
  verifier: ServiceTokenVerifier;
  admin: JwtPayload;
  pheAdmin: JwtPayload;
  locationAdmin: JwtPayload;
  phewb: string;
  eskom: string;
  pheLocation: string;
  created: string[];
  savedAuthMode: string | undefined;
  savedIssuer: string | undefined;
};

async function principal(superPool: pg.Pool, email: string): Promise<JwtPayload> {
  const r = await superPool.query<{ id: string; role: JwtPayload["role"]; display_name: string }>(
    `SELECT id, role, display_name FROM bms.users WHERE email = $1`,
    [email],
  );
  const row = r.rows[0];
  if (!row) throw new Error(`F4.17: needs the seeded ${email} — run pnpm db:seed.`);
  return { sub: row.id, email, name: row.display_name, role: row.role };
}

export async function openAdminSuite(
  superPool: pg.Pool,
  fleetPool: pg.Pool,
  tenantPool: pg.Pool,
  authPool: pg.Pool,
): Promise<AdminSuite> {
  const savedAuthMode = process.env.AUTH_MODE;
  const savedIssuer = process.env.OIDC_ISSUER;
  process.env.AUTH_MODE = "local";
  delete process.env.OIDC_ISSUER;
  const fleetDb: BmsDb = createDb(fleetPool);
  const tenantDb: BmsDb = createDb(tenantPool);
  const authDb: BmsDb = createDb(authPool);
  const access = new AccessControlService(authDb, fleetDb);
  const service = new ServiceAccountsAdminService(fleetDb, tenantDb, access, new MasterDataAuditService(tenantDb, fleetDb));
  const orgs = await superPool.query<{ id: string; code: string }>(
    `SELECT id, code FROM bms.organizations WHERE code IN ('ESKOM', 'PHEWB')`,
  );
  const phewb = orgs.rows.find((r) => r.code === "PHEWB")?.id as string;
  const eskom = orgs.rows.find((r) => r.code === "ESKOM")?.id as string;
  const loc = await superPool.query<{ id: string }>(
    `SELECT id FROM bms.locations WHERE organization_id = $1 ORDER BY created_at, id LIMIT 1`,
    [phewb],
  );
  return {
    superPool,
    service,
    verifier: new ServiceTokenVerifier(authDb),
    admin: await principal(superPool, "admin@bms.local"),
    pheAdmin: await principal(superPool, "phe-admin@bms.local"),
    locationAdmin: await principal(superPool, "wc-admin@bms.local"),
    phewb,
    eskom,
    pheLocation: loc.rows[0]?.id as string,
    created: [],
    savedAuthMode,
    savedIssuer,
  };
}

export async function closeAdminSuite(suite: AdminSuite): Promise<void> {
  const ids = suite.created;
  if (ids.length > 0) {
    await suite.superPool.query(`DELETE FROM bms.audit_log WHERE entity_id = ANY($1::uuid[]) OR (payload->>'serviceAccountId') = ANY($1::text[])`, [ids]);
    await suite.superPool.query(`DELETE FROM bms.service_account_tokens WHERE service_account_id = ANY($1::uuid[])`, [ids]);
    await suite.superPool.query(`DELETE FROM bms.user_location_access WHERE user_id = ANY($1::uuid[])`, [ids]);
    await suite.superPool.query(`DELETE FROM bms.user_asset_group_access WHERE user_id = ANY($1::uuid[])`, [ids]);
    await suite.superPool.query(`DELETE FROM bms.users WHERE id = ANY($1::uuid[])`, [ids]);
  }
  if (suite.savedAuthMode === undefined) delete process.env.AUTH_MODE;
  else process.env.AUTH_MODE = suite.savedAuthMode;
  if (suite.savedIssuer !== undefined) process.env.OIDC_ISSUER = suite.savedIssuer;
}

async function createAccount(suite: AdminSuite, actor: JwtPayload, organizationId: string, name = "F4.17 integration") {
  const { item } = await suite.service.create(actor, { organizationId, name, role: "operator" });
  suite.created.push(item.id);
  return item;
}

export async function assertAnOrganizationAdminCreatesAnAccountInItsOwnOrganizationOnly(suite: AdminSuite): Promise<void> {
  const item = await createAccount(suite, suite.pheAdmin, suite.phewb);
  expect(item).toEqual(expect.objectContaining({ organizationId: suite.phewb, role: "operator", disabledAt: null, tokens: [], grants: [] }));
  const row = await suite.superPool.query(`SELECT kind, email, password_hash, oidc_subject FROM bms.users WHERE id = $1`, [item.id]);
  expect(row.rows[0]).toEqual({ kind: "service", email: `svc-${item.id}@service-account.invalid`, password_hash: null, oidc_subject: null });
  await expect(suite.service.create(suite.pheAdmin, { organizationId: suite.eskom, name: "x", role: "viewer" })).rejects.toBeInstanceOf(ForbiddenException);
  // Another organization's account is a 404, never a 403: it does not exist for this caller.
  const eskomAccount = await createAccount(suite, suite.admin, suite.eskom);
  await expect(suite.service.get(suite.pheAdmin, eskomAccount.id)).rejects.toBeInstanceOf(NotFoundException);
  const list = serviceAccountsListResponseSchema.parse(await suite.service.list(suite.pheAdmin));
  expect(list.items.every((a) => a.organizationId === suite.phewb)).toBe(true);
  expect(list.items.map((a) => a.id)).toContain(item.id);
}

export async function assertABelowOrganizationAdminIsRefused(suite: AdminSuite): Promise<void> {
  await expect(suite.service.list(suite.locationAdmin)).rejects.toBeInstanceOf(ForbiddenException);
  await expect(suite.service.create(suite.locationAdmin, { organizationId: suite.eskom, name: "x", role: "viewer" })).rejects.toBeInstanceOf(ForbiddenException);
  await expect(suite.service.create(suite.admin, { organizationId: suite.eskom, name: "x", role: "organization_admin" })).rejects.toBeInstanceOf(BadRequestException);
}

export async function assertATokenIsShownOnceVerifiesAndIsCappedAtTwoLive(suite: AdminSuite): Promise<void> {
  const account = await createAccount(suite, suite.pheAdmin, suite.phewb);
  const first = createServiceTokenResponseSchema.parse(
    await suite.service.createToken(suite.pheAdmin, account.id, { name: "primary", expiresInDays: 30, readOnly: true }),
  );
  expect(first.item).toEqual(expect.objectContaining({ status: "active", readOnly: true, revokedAt: null }));
  const principal = await suite.verifier.verify(first.token);
  expect(principal?.payload.sub).toBe(account.id);
  await suite.service.createToken(suite.pheAdmin, account.id, { name: "rotation" });
  await expect(suite.service.createToken(suite.pheAdmin, account.id, { name: "third" })).rejects.toBeInstanceOf(ConflictException);
  await expect(suite.service.createToken(suite.pheAdmin, account.id, { name: "too long", expiresInDays: 366 })).rejects.toBeInstanceOf(BadRequestException);
  // The list never carries the secret or its hash.
  const { item } = await suite.service.get(suite.pheAdmin, account.id);
  const text = JSON.stringify(item);
  expect(text).not.toContain(first.token);
  expect(text).not.toContain(first.token.slice(-43));
  expect(text).not.toMatch(/token_?hash/i);
  // Nor does the audit trail.
  const audit = await suite.superPool.query(`SELECT action, payload::text AS payload FROM bms.audit_log WHERE payload->>'serviceAccountId' = $1`, [account.id]);
  expect(audit.rows.map((r) => r.action)).toEqual(["service_token.issued", "service_token.issued"]);
  for (const row of audit.rows) {
    expect(row.payload).not.toContain(first.token.slice(-43));
  }
}

export async function assertARevokeIsFinalAndStopsTheToken(suite: AdminSuite): Promise<void> {
  const account = await createAccount(suite, suite.pheAdmin, suite.phewb);
  const issued = await suite.service.createToken(suite.pheAdmin, account.id, { name: "to revoke" });
  expect(await suite.verifier.verify(issued.token)).not.toBeNull();
  const after = await suite.service.revokeToken(suite.pheAdmin, account.id, issued.item.id);
  expect(after.item.tokens[0]).toEqual(expect.objectContaining({ status: "revoked" }));
  suite.verifier.forget(issued.item.tokenId); // what the NOTIFY does in each process
  expect(await suite.verifier.verify(issued.token)).toBeNull();
  // Idempotent: a second revoke changes nothing and audits nothing.
  await suite.service.revokeToken(suite.pheAdmin, account.id, issued.item.id);
  const audit = await suite.superPool.query(`SELECT count(*)::int AS n FROM bms.audit_log WHERE action = 'service_token.revoked' AND entity_id = $1`, [issued.item.id]);
  expect(audit.rows[0]?.n).toBe(1);
  // A revoked token frees its slot.
  await suite.service.createToken(suite.pheAdmin, account.id, { name: "a" });
  await suite.service.createToken(suite.pheAdmin, account.id, { name: "b" });
}

export async function assertDisablingAnAccountRevokesEveryToken(suite: AdminSuite): Promise<void> {
  const account = await createAccount(suite, suite.pheAdmin, suite.phewb);
  const a = await suite.service.createToken(suite.pheAdmin, account.id, { name: "a" });
  const b = await suite.service.createToken(suite.pheAdmin, account.id, { name: "b" });
  const after = await suite.service.update(suite.pheAdmin, account.id, { disabled: true });
  expect(after.item.disabledAt).not.toBeNull();
  expect(after.item.tokens.map((t) => t.status).sort()).toEqual(["revoked", "revoked"]);
  suite.verifier.forgetAll();
  expect(await suite.verifier.verify(a.token)).toBeNull();
  expect(await suite.verifier.verify(b.token)).toBeNull();
  await expect(suite.service.createToken(suite.pheAdmin, account.id, { name: "c" })).rejects.toBeInstanceOf(ConflictException);
  // Re-enabling does not resurrect a revoked token.
  const enabled = await suite.service.update(suite.pheAdmin, account.id, { disabled: false });
  expect(enabled.item.tokens.every((t) => t.status === "revoked")).toBe(true);
}

export async function assertGrantsAreHeldToTheAccountsOrganization(suite: AdminSuite): Promise<void> {
  const account = await createAccount(suite, suite.pheAdmin, suite.phewb);
  const added = await suite.service.addGrant(suite.pheAdmin, account.id, { kind: "location", targetId: suite.pheLocation });
  expect(added.item.grants).toEqual([expect.objectContaining({ kind: "location", targetId: suite.pheLocation })]);
  await expect(suite.service.addGrant(suite.pheAdmin, account.id, { kind: "location", targetId: suite.pheLocation })).rejects.toBeInstanceOf(ConflictException);
  const eskomLocation = await suite.superPool.query<{ id: string }>(
    `SELECT id FROM bms.locations WHERE organization_id = $1 ORDER BY created_at, id LIMIT 1`,
    [suite.eskom],
  );
  await expect(
    suite.service.addGrant(suite.pheAdmin, account.id, { kind: "location", targetId: eskomLocation.rows[0]?.id }),
  ).rejects.toBeInstanceOf(NotFoundException);
  const grantId = added.item.grants[0]?.id as string;
  const removed = await suite.service.removeGrant(suite.pheAdmin, account.id, "location", grantId);
  expect(removed.item.grants).toEqual([]);
  await expect(suite.service.removeGrant(suite.pheAdmin, account.id, "location", grantId)).rejects.toBeInstanceOf(NotFoundException);
}

export async function assertAServiceAccountCannotManageServiceAccounts(suite: AdminSuite): Promise<void> {
  const account = await createAccount(suite, suite.pheAdmin, suite.phewb);
  const issued = await suite.service.createToken(suite.pheAdmin, account.id, { name: "self" });
  const principal = await suite.verifier.verify(issued.token);
  await expect(suite.service.list(principal?.payload as JwtPayload)).rejects.toBeInstanceOf(ForbiddenException);
}

/**
 * The global admin issues and revokes a token in a tenant organization (the
 * live check's 500): the columns stay NULL, and the audit rows name the admin.
 */
export async function assertTheGlobalAdminIssuesAndRevokesInAnyOrganization(suite: AdminSuite): Promise<void> {
  const account = await createAccount(suite, suite.admin, suite.phewb);
  const issued = await suite.service.createToken(suite.admin, account.id, { name: "by admin" });
  await suite.service.revokeToken(suite.admin, account.id, issued.item.id);
  const row = await suite.superPool.query(
    `SELECT created_by, revoked_by, revoked_at IS NOT NULL AS revoked FROM bms.service_account_tokens WHERE id = $1`,
    [issued.item.id],
  );
  expect(row.rows[0]).toEqual({ created_by: null, revoked_by: null, revoked: true });
  const audit = await suite.superPool.query(
    `SELECT action, actor_id FROM bms.audit_log WHERE entity_id = $1 ORDER BY created_at`,
    [issued.item.id],
  );
  expect(audit.rows).toEqual([
    { action: "service_token.issued", actor_id: suite.admin.sub },
    { action: "service_token.revoked", actor_id: suite.admin.sub },
  ]);
  // And an organization's own admin is named on the row.
  const own = await suite.service.createToken(suite.pheAdmin, account.id, { name: "by org admin" });
  const ownRow = await suite.superPool.query(`SELECT created_by FROM bms.service_account_tokens WHERE id = $1`, [own.item.id]);
  expect(ownRow.rows[0]?.created_by).toBe(suite.pheAdmin.sub);
}
