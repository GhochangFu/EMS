import type pg from "pg";
import { expect } from "vitest";

import type { JwtPayload } from "@bms/shared";

import { CredentialCryptoService } from "../../security/credential-crypto.service";
import { RTU_CREDENTIALS_REPLACE_ACTION, RTU_CREDENTIALS_SHARED_BROKER, RtusCredentialsService } from "./rtus-credentials.service";

/**
 * `F4.333` (ADR 0129 decision 2, plan T3.3) — the credential replace against a
 * real Postgres with FORCE ROW LEVEL SECURITY: the write lands under the
 * tenant GUC, another organization's row is untouched, the stored blob
 * decrypts to the sent values (decrypted here, in the test, only), and one
 * audit row per RTU carries no value.
 */
export type CredentialsCtx = {
  svc: RtusCredentialsService;
  fixturePool: pg.Pool;
  organizationId: string;
  locationId: string;
  otherOrganizationId: string;
  otherLocationId: string;
  createdRtuIds: string[];
};

const PASSWORD = "f4333-new-password";
const USERNAME = "f4333-user";

function tag(): string {
  return `F4333-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

/** One MQTT RTU with a connection row and an old blob, inserted as fixture. */
export async function seedRtu(ctx: CredentialsCtx, org: "own" | "other", host: string): Promise<string> {
  const crypto = new CredentialCryptoService();
  const code = tag();
  const [organizationId, locationId] =
    org === "own" ? [ctx.organizationId, ctx.locationId] : [ctx.otherOrganizationId, ctx.otherLocationId];
  const rtu = await ctx.fixturePool.query<{ id: string }>(
    `INSERT INTO bms.rtus (organization_id, location_id, code, display_name, source_type)
     VALUES ($1, $2, $3, $4, 'mqtt') RETURNING id`,
    [organizationId, locationId, code, `F4.333 ${code}`],
  );
  const id = rtu.rows[0]!.id;
  ctx.createdRtuIds.push(id);
  const old = crypto.encrypt({ username: "old-user", password: "old-password" });
  await ctx.fixturePool.query(
    `INSERT INTO bms.rtu_connection_configs (organization_id, rtu_id, protocol, config, credentials_ciphertext, credentials_iv, key_version)
     VALUES ($1, $2, 'mqtt', $3, $4, $5, $6)`,
    [organizationId, id, JSON.stringify({ host, port: 1883, tls: false, topic: `t/${code}` }), old.ciphertext, old.iv, old.keyVersion],
  );
  return id;
}

async function stored(ctx: CredentialsCtx, id: string): Promise<{ c: Buffer; iv: Buffer; v: number; config: unknown }> {
  const row = await ctx.fixturePool.query<{ c: Buffer; iv: Buffer; v: number; config: unknown }>(
    `SELECT credentials_ciphertext AS c, credentials_iv AS iv, key_version AS v, config FROM bms.rtu_connection_configs WHERE rtu_id = $1`,
    [id],
  );
  return row.rows[0]!;
}

/** I1 — the target and its sibling get one new blob; config is untouched; one audit row each, no value. */
export async function assertReplaceWritesUnderRls(ctx: CredentialsCtx, jwt: JwtPayload): Promise<void> {
  const host = `${tag().toLowerCase()}.broker.test`;
  const a = await seedRtu(ctx, "own", host);
  const b = await seedRtu(ctx, "own", host);
  const before = await stored(ctx, a);

  const dto = await ctx.svc.replace(jwt, a, { username: USERNAME, password: PASSWORD, alsoApplyTo: [b] });
  expect(dto.credentialsSet).toBe(true);
  expect(JSON.stringify(dto)).not.toContain(PASSWORD);

  const [after, sibling] = [await stored(ctx, a), await stored(ctx, b)];
  expect(after.iv.equals(before.iv)).toBe(false);
  expect(sibling.c.equals(after.c) && sibling.iv.equals(after.iv)).toBe(true);
  expect(after.config).toEqual(before.config);
  const crypto = new CredentialCryptoService();
  expect(crypto.decrypt(after.c, after.iv, after.v)).toEqual({ username: USERNAME, password: PASSWORD });
  expect(after.v).toBe(CredentialCryptoService.currentKeyVersion());

  const audits = await ctx.fixturePool.query<{ entity_id: string; organization_id: string; payload: unknown }>(
    `SELECT entity_id, organization_id, payload FROM bms.audit_log WHERE action = $1 AND entity_id = ANY($2)`,
    [RTU_CREDENTIALS_REPLACE_ACTION, [a, b]],
  );
  expect(audits.rows.map((row) => row.entity_id).sort()).toEqual([a, b].sort());
  for (const row of audits.rows) {
    expect(row.organization_id).toBe(ctx.organizationId);
    expect(JSON.stringify(row.payload)).not.toContain(PASSWORD);
    expect(JSON.stringify(row.payload)).not.toContain(USERNAME);
  }
}

/** I2 — another organization's RTU on the same broker blocks an organization admin and keeps its own blob. */
export async function assertSharedBrokerIsRefused(ctx: CredentialsCtx, jwt: JwtPayload): Promise<void> {
  const host = `${tag().toLowerCase()}.broker.test`;
  const own = await seedRtu(ctx, "own", host);
  const theirs = await seedRtu(ctx, "other", host);
  const [ownBefore, theirsBefore] = [await stored(ctx, own), await stored(ctx, theirs)];
  await expect(ctx.svc.replace(jwt, own, { username: USERNAME, password: PASSWORD })).rejects.toThrow(RTU_CREDENTIALS_SHARED_BROKER);
  expect((await stored(ctx, own)).iv.equals(ownBefore.iv)).toBe(true);
  expect((await stored(ctx, theirs)).iv.equals(theirsBefore.iv)).toBe(true);
}

/** I3 — another organization's RTU cannot be named as a sibling, and is not written. */
export async function assertCrossTenantSiblingIsRefused(ctx: CredentialsCtx, jwt: JwtPayload): Promise<void> {
  // One host, so only the organization (and scope) check can refuse the sibling.
  const host = `${tag().toLowerCase()}.broker.test`;
  const own = await seedRtu(ctx, "own", host);
  const theirs = await seedRtu(ctx, "other", host);
  const theirsBefore = await stored(ctx, theirs);
  await expect(ctx.svc.replace(jwt, own, { username: USERNAME, password: PASSWORD, alsoApplyTo: [theirs] })).rejects.toThrow(
    "These RTUs cannot take this credential",
  );
  expect((await stored(ctx, theirs)).iv.equals(theirsBefore.iv)).toBe(true);
}
