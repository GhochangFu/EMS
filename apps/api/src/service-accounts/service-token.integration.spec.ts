import { randomUUID } from "node:crypto";

import { Client } from "pg";
import type pg from "pg";
import { expect } from "vitest";

import { createDb } from "@bms/db";
import type { BmsDb } from "@bms/db";

import type { ListenerClient } from "../database/notify-listener";
import { issueServiceToken } from "./service-token-codec";
import { createServiceTokenRevokedListener, notifyServiceTokenRevoked } from "./service-token-notify";
import { ServiceTokenVerifier } from "./service-token-verifier.service";

/**
 * `F4.17` / ADR 0125 decisions 11–13 against a real database: the verifier on
 * the real `bms_auth` pool (its column grants and its live-only policies from
 * migrations 0144/0145), and one real NOTIFY round trip to the revoke
 * listener. Fixtures are committed through the superuser pool — the verifier
 * reads on its own connection — and removed in `closeTokenSuite`.
 */

export type TokenSuite = {
  superPool: pg.Pool;
  authDb: BmsDb;
  authUrl: string;
  accountId: string;
  organizationId: string;
};

export async function openTokenSuite(superPool: pg.Pool, authDb: BmsDb, authUrl: string): Promise<TokenSuite> {
  const org = await superPool.query<{ id: string }>(`SELECT id FROM bms.organizations ORDER BY created_at, code LIMIT 1`);
  const organizationId = org.rows[0]?.id;
  if (!organizationId) throw new Error("F4.17: needs a seeded organization — run pnpm db:seed.");
  const accountId = randomUUID();
  await superPool.query(
    `INSERT INTO bms.users (id, organization_id, email, display_name, role, kind)
     VALUES ($1, $2, $3, 'F4.17 integration', 'operator', 'service')`,
    [accountId, organizationId, `svc-${accountId.slice(0, 8)}@service-account.invalid`],
  );
  return { superPool, authDb, authUrl, accountId, organizationId };
}

export async function closeTokenSuite(suite: TokenSuite): Promise<void> {
  await suite.superPool.query(`DELETE FROM bms.service_account_tokens WHERE service_account_id = $1`, [suite.accountId]);
  await suite.superPool.query(`DELETE FROM bms.users WHERE id = $1`, [suite.accountId]);
}

async function insertToken(suite: TokenSuite, expiresIn = "30 days", readOnly = false) {
  const issued = issueServiceToken();
  await suite.superPool.query(
    `INSERT INTO bms.service_account_tokens
       (organization_id, service_account_id, token_id, token_hash, name, read_only, expires_at)
     VALUES ($1, $2, $3, $4, 'F4.17 integration', $5, now() + $6::interval)`,
    [suite.organizationId, suite.accountId, issued.tokenId, issued.tokenHash, readOnly, expiresIn],
  );
  return issued;
}

export async function assertAValidTokenVerifiesOnTheRealAuthPool(suite: TokenSuite): Promise<void> {
  const issued = await insertToken(suite, "30 days", true);
  const verifier = new ServiceTokenVerifier(suite.authDb);
  const principal = await verifier.verify(issued.token);
  expect(principal?.payload.sub).toBe(suite.accountId);
  expect(principal?.identity).toEqual(expect.objectContaining({ kind: "service", organizationId: suite.organizationId }));
  expect(principal?.readOnly).toBe(true);
  // The fire-and-forget touch lands, stamped by the trigger.
  let used: unknown = null;
  for (let i = 0; i < 20 && used === null; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    const r = await suite.superPool.query(`SELECT last_used_at FROM bms.service_account_tokens WHERE token_id = $1`, [issued.tokenId]);
    used = r.rows[0]?.last_used_at ?? null;
  }
  expect(used).not.toBeNull();
}

export async function assertARevokedTokenIsRefusedOnceForgotten(suite: TokenSuite): Promise<void> {
  const issued = await insertToken(suite);
  const verifier = new ServiceTokenVerifier(suite.authDb);
  expect(await verifier.verify(issued.token)).not.toBeNull();
  await suite.superPool.query(`UPDATE bms.service_account_tokens SET revoked_at = now() WHERE token_id = $1`, [issued.tokenId]);
  verifier.forget(issued.tokenId);
  expect(await verifier.verify(issued.token)).toBeNull();
}

export async function assertAnExpiredTokenIsRefused(suite: TokenSuite): Promise<void> {
  const issued = await insertToken(suite, "1 second");
  await new Promise((resolve) => setTimeout(resolve, 1_200));
  expect(await new ServiceTokenVerifier(suite.authDb).verify(issued.token)).toBeNull();
}

export async function assertADisabledAccountIsRefused(suite: TokenSuite): Promise<void> {
  const issued = await insertToken(suite);
  await suite.superPool.query(`UPDATE bms.users SET disabled_at = now() WHERE id = $1`, [suite.accountId]);
  try {
    expect(await new ServiceTokenVerifier(suite.authDb).verify(issued.token)).toBeNull();
  } finally {
    await suite.superPool.query(`UPDATE bms.users SET disabled_at = NULL WHERE id = $1`, [suite.accountId]);
  }
}

export async function assertARevokeNotificationReachesTheListener(suite: TokenSuite): Promise<void> {
  const issued = await insertToken(suite);
  const forgotten: string[] = [];
  let connected = false;
  let forgotAll = 0;
  const listener = createServiceTokenRevokedListener({
    createClient: () => new Client({ connectionString: suite.authUrl }) as unknown as ListenerClient,
    forget: (id) => forgotten.push(id),
    forgetAll: () => {
      forgotAll += 1;
    },
    disconnectServiceToken: () => 0,
    connectedServiceTokenIds: () => [],
    readLiveTokenIds: async () => [],
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    logger: { log: () => undefined, warn: () => undefined, error: () => undefined },
    onStateChange: (state) => {
      if (state === "connected") connected = true;
    },
  });
  listener.start();
  try {
    for (let i = 0; i < 50 && !connected; i += 1) await new Promise((resolve) => setTimeout(resolve, 50));
    expect(connected).toBe(true);
    // The catch-up on connect ran (F2): a NOTIFY missed while disconnected is covered.
    for (let i = 0; i < 20 && forgotAll === 0; i += 1) await new Promise((resolve) => setTimeout(resolve, 25));
    expect(forgotAll).toBeGreaterThanOrEqual(1);
    // Committed: a NOTIFY is delivered only when its transaction commits.
    await createDb(suite.superPool).transaction(async (tx) => {
      await notifyServiceTokenRevoked(tx, issued.tokenId);
    });
    for (let i = 0; i < 40 && forgotten.length === 0; i += 1) await new Promise((resolve) => setTimeout(resolve, 50));
    expect(forgotten).toEqual([issued.tokenId]);
  } finally {
    await listener.stop();
  }
}
