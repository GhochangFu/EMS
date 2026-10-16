import { randomUUID } from "node:crypto";

import { Reflector } from "@nestjs/core";
import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { AccessControlService } from "../auth/access-control.service";
import { rememberIdentity, type ResolvedIdentity } from "../auth/identity-resolver";
import { MimicSymbolLibrariesController } from "../mimic-symbol-libraries/mimic-symbol-libraries.controller";
import { MimicSymbolLibrariesService } from "../mimic-symbol-libraries/mimic-symbol-libraries.service";
import { openIntegrationPool, requireIntegrationDb, resolveIntegrationRoleUrl } from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import { jwtFor, primeSeededSubjects, SEEDED } from "../testing/seeded-subjects";
import { CopilotChangeInterceptor } from "./copilot-change.interceptor";
import { CopilotPendingChangesService } from "./copilot-pending-changes.service";
import {
  anotherLibrarysIdIs409AndTheRowStaysPending,
  changedBytesAre409AndTheRowStaysPending,
  theStoredTextApplies,
  type UploadConfirmCtx,
} from "./copilot-upload.integration.spec";

/**
 * `F3.87` PR 6b — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the pools, the fixtures and the cleanup. The
 * libraries are the global admin's, in ESKOM, with this run's code prefix;
 * every row this run writes is removed in `afterAll` (the conversations and
 * their pending changes, the symbols' and libraries' audit rows, the symbols,
 * the libraries).
 */
const connectionString = requireIntegrationDb({
  item: "F3.87 PR 6b",
  label: "a symbol upload card confirmed as multipart through both interceptor stages",
  because:
    "the claim, its release, the path and byte comparisons and the audit mark are facts about a real " +
    "database and the real interceptors (ADR 0099 Amendment 3 A3, plan D12).",
});

const RUN = randomUUID().replace(/-/g, "").slice(0, 8);

describe.skipIf(!connectionString)("F3.87 PR 6b — a symbol upload card confirmed through the two stages", () => {
  let superPool: pg.Pool;
  let tenantPool: pg.Pool;
  let authPool: pg.Pool;
  let fleetPool: pg.Pool;
  const libraryIds: string[] = [];
  const conversationIds: string[] = [];
  let ctx: UploadConfirmCtx;

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

    const service = new MimicSymbolLibrariesService(fleetDb, tenantDb, new AccessControlService(createDb(authPool), fleetDb), new MasterDataAuditService(tenantDb, fleetDb));
    const pending = new CopilotPendingChangesService(tenantDb);
    const turns = { followUp: async () => undefined };
    const availability = { decide: async () => ({ available: true }) };
    const interceptor = new CopilotChangeInterceptor(pending, availability as never, new Reflector(), turns as never);

    ctx = {
      superPool,
      controller: new MimicSymbolLibrariesController(service),
      pending,
      interceptor,
      jwt,
      identity,
      organizationId,
      newConversation: async () => {
        const { rows } = await superPool.query<{ id: string }>(
          "INSERT INTO bms.copilot_conversations (user_id, organization_id, title) VALUES ($1, $2, $3) RETURNING id",
          [identity.id, organizationId, `F3.87 PR 6b ${RUN}`],
        );
        const id = rows[0]?.id;
        if (!id) throw new Error("F3.87: conversation was not created");
        conversationIds.push(id);
        return id;
      },
      newLibrary: async (suffix) => {
        const created = await service.create(jwt, {
          organizationId,
          code: `f${RUN}${suffix}`.slice(0, 27),
          label: `F3.87 PR 6b ${suffix}`,
          style: "stroke",
          licence: "MIT",
          attribution: "",
        });
        libraryIds.push(created.id);
        return created.id;
      },
    };
    // The interceptor reads the identity the guard memoised on the request's payload object.
    rememberIdentity(jwt, identity);
  }, 60_000);

  afterAll(async () => {
    if (superPool) {
      if (conversationIds.length > 0) {
        await superPool.query("DELETE FROM bms.copilot_pending_changes WHERE conversation_id = ANY($1::uuid[])", [conversationIds]);
        await superPool.query("DELETE FROM bms.copilot_messages WHERE conversation_id = ANY($1::uuid[])", [conversationIds]);
        await superPool.query("DELETE FROM bms.copilot_conversations WHERE id = ANY($1::uuid[])", [conversationIds]);
      }
      if (libraryIds.length > 0) {
        const symbols = await superPool.query<{ id: string }>("SELECT id FROM bms.mimic_org_symbols WHERE library_id = ANY($1::uuid[])", [libraryIds]);
        const ids = [...libraryIds, ...symbols.rows.map((row) => row.id)];
        await superPool.query("DELETE FROM bms.audit_log WHERE entity_id = ANY($1::uuid[])", [ids]);
        await superPool.query("DELETE FROM bms.mimic_org_symbols WHERE library_id = ANY($1::uuid[])", [libraryIds]);
        await superPool.query("DELETE FROM bms.mimic_org_symbol_libraries WHERE id = ANY($1::uuid[])", [libraryIds]);
      }
    }
    await Promise.all([superPool?.end(), tenantPool?.end(), authPool?.end(), fleetPool?.end()]);
  }, 60_000);

  it("bytes that differ from fileSha256 answer 409 and leave the row pending", () => changedBytesAre409AndTheRowStaysPending(ctx), 30_000);
  it("a Confirm against another library's id answers 409 and leaves the row pending", () => anotherLibrarysIdIs409AndTheRowStaysPending(ctx), 30_000);
  it("the stored text answers 201, applies, and the audit row carries via and the change id", () => theStoredTextApplies(ctx), 30_000);
});
