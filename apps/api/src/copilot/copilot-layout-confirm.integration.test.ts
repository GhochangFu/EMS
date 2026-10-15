import { randomUUID } from "node:crypto";

import { Reflector } from "@nestjs/core";
import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { AccessControlService } from "../auth/access-control.service";
import { rememberIdentity, type ResolvedIdentity } from "../auth/identity-resolver";
import { MimicLayoutsController } from "../mimic-layouts/mimic-layouts.controller";
import { MimicLayoutsService } from "../mimic-layouts/mimic-layouts.service";
import { openIntegrationPool, requireIntegrationDb, resolveIntegrationRoleUrl } from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import { jwtFor, primeSeededSubjects, SEEDED } from "../testing/seeded-subjects";
import { CopilotChangeInterceptor } from "./copilot-change.interceptor";
import {
  aCardAtTheLiveVersionApplies,
  aConfirmCarryingTheBaselineIs400,
  aStaleCardIs409FailedAndReturnedToTheModel,
  layoutGraph,
  type LayoutConfirmCtx,
} from "./copilot-layout-confirm.integration.spec";
import { CopilotPendingChangesService, type FinishedChange } from "./copilot-pending-changes.service";

/**
 * `F3.87` PR 5 — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the pools, the fixtures and the cleanup. The
 * layouts are the global admin's, in ESKOM; every row this run writes is
 * removed by id in `afterAll` (layouts, their audit rows, the conversations
 * and their pending changes).
 */
const connectionString = requireIntegrationDb({
  item: "F3.87 PR 5",
  label: "a stale mimic layout card is 409 on Confirm",
  because:
    "the card's baseline, the route's version check and the recorded outcome the follow-up reads are " +
    "facts about a real database and the real interceptor (ADR 0099 Amendment 3 A2, owner ruling Q5).",
});

const RUN = randomUUID().replace(/-/g, "").slice(0, 8);

describe.skipIf(!connectionString)("F3.87 PR 5 — a mimic layout card confirmed through the interceptor", () => {
  let superPool: pg.Pool;
  let tenantPool: pg.Pool;
  let authPool: pg.Pool;
  let fleetPool: pg.Pool;
  const layoutIds: string[] = [];
  const conversationIds: string[] = [];
  let ctx: LayoutConfirmCtx;

  beforeAll(async () => {
    const url = connectionString as string;
    superPool = await openIntegrationPool(resolveIntegrationRoleUrl(url, "superuser", process.env), "F3.87");
    tenantPool = await openIntegrationPool(process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"), "F3.87");
    authPool = await openIntegrationPool(process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"), "F3.87");
    fleetPool = await openIntegrationPool(process.env.DATABASE_URL_FLEET ?? asRole(url, "bms_fleet", "bms_fleet_dev"), "F3.87");
    await primeSeededSubjects(fleetPool);
    const fleetDb = createDb(fleetPool);
    const tenantDb = createDb(tenantPool);

    const org = await superPool.query<{ id: string }>("SELECT id FROM bms.organizations WHERE code = 'ESKOM' LIMIT 1");
    const organizationId = org.rows[0]?.id;
    if (!organizationId) throw new Error("F3.87: organization ESKOM not found — run pnpm db:seed");

    const jwt: JwtPayload = jwtFor(SEEDED.globalAdmin, "admin");
    const identity: ResolvedIdentity = {
      id: jwt.sub,
      email: SEEDED.globalAdmin,
      displayName: "F3.87 admin",
      role: "admin",
      organizationId: null,
      oidcSubject: null,
      disabledAt: null,
    };

    const service = new MimicLayoutsService(fleetDb, tenantDb, new AccessControlService(createDb(authPool), fleetDb), new MasterDataAuditService(tenantDb, fleetDb));
    const pending = new CopilotPendingChangesService(tenantDb);
    const followUps: Array<FinishedChange | null> = [];
    const turns = {
      followUp: async (caller: { identity: ResolvedIdentity }, changeId: string) => {
        followUps.push(await pending.finished(caller.identity.id, changeId));
      },
    };
    const availability = { decide: async () => ({ available: true }) };
    const interceptor = new CopilotChangeInterceptor(pending, availability as never, new Reflector(), turns as never);

    ctx = {
      superPool,
      service,
      controller: new MimicLayoutsController(service),
      pending,
      interceptor,
      followUps,
      jwt,
      identity,
      organizationId,
      newConversation: async () => {
        const { rows } = await superPool.query<{ id: string }>(
          "INSERT INTO bms.copilot_conversations (user_id, organization_id, title) VALUES ($1, $2, $3) RETURNING id",
          [identity.id, organizationId, `F3.87 PR 5 ${RUN}`],
        );
        const id = rows[0]?.id;
        if (!id) throw new Error("F3.87: conversation was not created");
        conversationIds.push(id);
        return id;
      },
      newLayout: async (suffix) => {
        const graph = layoutGraph(`f387-${RUN}-${suffix}`);
        const created = await service.create(jwt, { organizationId, ...graph });
        layoutIds.push(created.id);
        return { id: created.id, body: { version: created.version, ...graph } };
      },
    };
    // The interceptor reads the identity the guard memoised on the request's payload object.
    rememberIdentity(jwt, identity);
  }, 60_000);

  afterAll(async () => {
    if (superPool) {
      const byRun = await superPool.query<{ id: string }>("SELECT id FROM bms.mimic_layouts WHERE slug LIKE $1", [`f387-${RUN}-%`]);
      const ids = [...new Set([...layoutIds, ...byRun.rows.map((row) => row.id)])];
      if (conversationIds.length > 0) {
        await superPool.query("DELETE FROM bms.copilot_pending_changes WHERE conversation_id = ANY($1::uuid[])", [conversationIds]);
        await superPool.query("DELETE FROM bms.copilot_messages WHERE conversation_id = ANY($1::uuid[])", [conversationIds]);
        await superPool.query("DELETE FROM bms.copilot_conversations WHERE id = ANY($1::uuid[])", [conversationIds]);
      }
      if (ids.length > 0) {
        await superPool.query("DELETE FROM bms.audit_log WHERE entity_id = ANY($1::uuid[])", [ids]);
        await superPool.query("DELETE FROM bms.mimic_layouts WHERE id = ANY($1::uuid[])", [ids]);
      }
    }
    await Promise.all([superPool?.end(), tenantPool?.end(), authPool?.end(), fleetPool?.end()]);
  }, 60_000);

  it("a stale card answers 409, is recorded failed, and the follow-up reads it", () => aStaleCardIs409FailedAndReturnedToTheModel(ctx), 30_000);
  it("a card at the live version applies (positive control)", () => aCardAtTheLiveVersionApplies(ctx), 30_000);
  it("a Confirm that carries the baseline is 400 from the strict body", () => aConfirmCarryingTheBaselineIs400(ctx), 30_000);
});
