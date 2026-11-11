import type pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";

import {
  openIntegrationPool,
  requireIntegrationDb,
  resolveIntegrationRoleUrl,
} from "../testing/integration-db-gate";
import {
  assertADisabledAccountIsRefused,
  assertAnExpiredTokenIsRefused,
  assertARevokedTokenIsRefusedOnceForgotten,
  assertARevokeNotificationReachesTheListener,
  assertAValidTokenVerifiesOnTheRealAuthPool,
  closeTokenSuite,
  openTokenSuite,
  type TokenSuite,
} from "./service-token.integration.spec";

const connectionString = requireIntegrationDb({
  item: "F4.17",
  label: "service-account token verification on a real bms_auth connection",
  because:
    "the verifier reads bms.service_account_tokens and bms.users on the auth pool, whose column grants " +
    "and live-only policies (migrations 0144/0145) only a real database enforces; a fake proves neither, " +
    "and a missing grant would refuse every token in production.",
});

describe.skipIf(!connectionString)("F4.17 — service tokens on bms_auth (ADR 0125 decisions 11–13)", () => {
  let superPool: pg.Pool;
  let authPool: pg.Pool;
  let suite: TokenSuite;

  beforeAll(async () => {
    superPool = await openIntegrationPool(
      resolveIntegrationRoleUrl(connectionString as string, "superuser", process.env),
      "F4.17",
    );
    const authUrl = resolveIntegrationRoleUrl(connectionString as string, "auth", process.env);
    authPool = await openIntegrationPool(authUrl, "F4.17");
    suite = await openTokenSuite(superPool, createDb(authPool), authUrl);
  });

  afterAll(async () => {
    if (suite) await closeTokenSuite(suite);
    await authPool?.end();
    await superPool?.end();
  });

  it("a valid read-only token verifies as its service account, and last_used_at is touched", async () => {
    await assertAValidTokenVerifiesOnTheRealAuthPool(suite);
  });

  it("a revoked token is refused once its cache entry is forgotten", async () => {
    await assertARevokedTokenIsRefusedOnceForgotten(suite);
  });

  it("an expired token is refused", async () => {
    await assertAnExpiredTokenIsRefused(suite);
  });

  it("a token of a disabled account is refused", async () => {
    await assertADisabledAccountIsRefused(suite);
  });

  it("a committed revoke NOTIFY reaches the listener", async () => {
    await assertARevokeNotificationReachesTheListener(suite);
  });
});
