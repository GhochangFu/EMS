import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import { AccessControlService } from "./access-control.service";
import { jwtFor } from "./access-control.integration.spec";
import { assertTwoOrgActorScopeIsBoundedUnion } from "./multi-org-scope.rls.integration.spec";

/**
 * `E7.1b` — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the database lifecycle. No seeded user holds more
 * than one org, so it creates a two-org actor — one `bms.users` row plus two
 * `user_organization_access` grants across the two seeded organizations — on the
 * fleet (BYPASSRLS) pool, then drives `AccessControlService` (real
 * `bms_auth`/`bms_fleet`) to prove the actor is scoped to the bounded union of
 * both orgs.
 *
 * The fixture reuses the seeded organizations and adds NO location — a new
 * location would re-open the seed-breaker E7.1a closed. Cleanup is by id.
 */
const connectionString = requireIntegrationDb({
  item: "E7.1b",
  label: "AccessControlService multi-org scope against real, non-owner roles",
  because:
    "Amendment 3 ruling 3 says a multi-org actor resolves on fleetDb to the union of its orgs. No " +
    "seeded user holds >1 org, so only a created two-org actor can prove scopeFromSource('organization') " +
    "unions all of directOrganizationIds' grants rather than collapsing to one — and returns an explicit " +
    "bounded list, not the global admin's null scope. The owner connection cannot tell these apart.",
});

const SCOPED_ADMIN_EMAIL = "phe-admin@bms.local";

// Per-run identity for the created actor. bms.users.email is UNIQUE; cleanup is
// by id, so randomUUID here avoids collision across concurrent runs.
const RUN = randomUUID().replace(/-/g, "").slice(0, 12);
const ACTOR_EMAIL = `e71b-multiorg-${RUN}@bms.local`;

describe.skipIf(!connectionString)("E7.1b — multi-org actor scope under real RLS", () => {
  let ownerPool: pg.Pool;
  let authPool: pg.Pool;
  let superPool: pg.Pool;
  let svc: AccessControlService;
  let orgAId = "";
  let orgBId = "";
  let userId = "";

  beforeAll(async () => {
    const url = connectionString as string;
    ownerPool = await openIntegrationPool(url, "E7.1b"); // fleet (BYPASSRLS) by default
    authPool = await openIntegrationPool(
      process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"),
      "E7.1b",
    );
    // bms_fleet has BYPASSRLS but no INSERT on bms.users / user_organization_access
    // (Amendment 4 narrowed it to reads), and bms_owner is FORCE-bound with no GUC,
    // so neither can create the identity fixture. Only the superuser can — the
    // established pattern for seeding identity rows under FORCE. Fixture setup and
    // teardown alone use it; every assertion runs on bms_auth / bms_fleet.
    superPool = await openIntegrationPool(
      process.env.DATABASE_URL_SUPERUSER ?? asRole(url, "bms_app", "bms_app_dev"),
      "E7.1b",
    );
    svc = new AccessControlService(createDb(authPool), createDb(ownerPool));

    // orgB = the scoped admin's org; orgA = any other seeded org. Both carry
    // active locations with assets, so the union has two non-empty halves.
    const orgB = await ownerPool.query<{ id: string }>(
      `SELECT uoa.organization_id AS id
         FROM bms.user_organization_access uoa
         JOIN bms.users u ON u.id = uoa.user_id
        WHERE u.email = $1
        LIMIT 1`,
      [SCOPED_ADMIN_EMAIL],
    );
    if (!orgB.rows[0]) {
      throw new Error(`E7.1b: ${SCOPED_ADMIN_EMAIL} has no organization grant — run pnpm db:seed.`);
    }
    orgBId = orgB.rows[0].id;

    const orgA = await ownerPool.query<{ id: string }>(
      "SELECT id FROM bms.organizations WHERE id <> $1 LIMIT 1",
      [orgBId],
    );
    if (!orgA.rows[0]) {
      throw new Error("E7.1b: need a second seeded organization for the two-org actor.");
    }
    orgAId = orgA.rows[0].id;

    // The two-org actor. Home org is one of the two (arbitrary — scope comes from
    // the grants below, not the home column). password_hash is required but
    // unused: this test never authenticates, it resolves scope by email.
    const user = await superPool.query<{ id: string }>(
      `INSERT INTO bms.users (email, password_hash, display_name, role, organization_id)
         VALUES ($1, 'unused-not-a-login-test', $2, 'organization_admin', $3) RETURNING id`,
      [ACTOR_EMAIL, "E7.1b multi-org actor", orgAId],
    );
    userId = user.rows[0]!.id;

    await superPool.query(
      `INSERT INTO bms.user_organization_access (user_id, organization_id) VALUES ($1, $2), ($1, $3)`,
      [userId, orgAId, orgBId],
    );
  });

  afterAll(async () => {
    if (superPool && userId) {
      await superPool.query("DELETE FROM bms.user_organization_access WHERE user_id = $1", [userId]);
      await superPool.query("DELETE FROM bms.users WHERE id = $1", [userId]);
    }
    await Promise.all([ownerPool, authPool, superPool].filter(Boolean).map((p) => p.end()));
  });

  it("scopes a two-org actor to the bounded union of both orgs, not the global null", async () => {
    await assertTwoOrgActorScopeIsBoundedUnion(
      svc,
      ownerPool,
      jwtFor(ACTOR_EMAIL, "organization_admin"),
      orgAId,
      orgBId,
    );
  });
});
