import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb, onboardingSessions } from "@bms/db";
import type { OnboardingDraft } from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { withTenant } from "../../database/tenant-context";
import { CredentialCryptoService } from "../../security/credential-crypto.service";
import { openIntegrationPool, requireIntegrationDb } from "../../testing/integration-db-gate";
import { asRole } from "../../testing/role-urls";
import { jwtFor, primeSeededSubjects } from "../../testing/seeded-subjects";
import { VocabulariesService } from "../../vocabularies/vocabularies.service";
import { MasterDataAuditService } from "../master-data-audit.service";
import { OnboardingChatService } from "./onboarding-chat.service";
import { OnboardingCommitService } from "./onboarding-commit.service";
import {
  assertACommittedSessionCannotBeLocked,
  assertAGlobalAdminLocks,
  assertAnOrganizationAdminCannotLock,
  assertEveryWriterRefusesALockedDraft,
  assertUnlockIsIdempotent,
  type LockCtx,
} from "./onboarding-lock.integration.spec";
import { OnboardingSessionLockService } from "./onboarding-session-lock.service";
import { EMPTY_TEMPLATE_CONTEXT } from "./onboarding-template-refs";
import { OnboardingValidateService } from "./onboarding-validate.service";
import { OnboardingService } from "./onboarding.service";

/**
 * `F4.339` / ADR 0117 decision 9 — Vitest entry point. Assertions live in the
 * sibling `.spec` (ADR 0014); this file owns the database lifecycle, in the
 * shape of `onboarding-chat-lock.integration.test.ts` (the guided chat path, no
 * model call).
 */
const connectionString = requireIntegrationDb({
  item: "F4.339",
  label: "the onboarding draft lock: who may lock, the columns, every writer's 409, unlock",
  because:
    "the lock is three columns written under the session row lock and read by every writer's " +
    "locked re-check; only a real database shows the columns, the audit rows and each writer's refusal.",
});

const ORGANIZATION_ADMIN_EMAIL = "phe-admin@bms.local";
const RUN = Date.now();
const TYPES = [{ code: "smoc_campus", label: "SMOC campus" }];
const CREDENTIAL_KEY = Buffer.alloc(32, 0x02).toString("base64");

function seededDraft(n: number): OnboardingDraft {
  return {
    location: { code: `F4339-LK-${n}-${RUN}`, slug: `f4339-lk-${n}-${RUN}`, name: `F4.339 lock ${n}`, type: "smoc_campus", latitude: 19.3, longitude: 84.8 },
    rtus: [{ code: `F4339-LK-RTU-${n}`, displayName: "RTU", protocol: "mqtt", config: { host: "broker", port: 8883, topic: `f4339/lk/${RUN}/${n}` }, credentialsSet: false, ingestEnabled: false }],
  } as OnboardingDraft;
}

describe.skipIf(!connectionString)("F4.339 — the onboarding draft lock (real Postgres)", () => {
  let previousKey: string | undefined;
  let fleetPool: pg.Pool;
  let tenantPool: pg.Pool;
  let authPool: pg.Pool;
  const sessionIds: string[] = [];
  const ctx = {} as LockCtx;

  beforeAll(async () => {
    previousKey = process.env.CREDENTIAL_ENCRYPTION_KEY;
    process.env.CREDENTIAL_ENCRYPTION_KEY = CREDENTIAL_KEY;
    const url = connectionString as string;
    fleetPool = await openIntegrationPool(url, "F4.339");
    tenantPool = await openIntegrationPool(process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"), "F4.339");
    authPool = await openIntegrationPool(process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"), "F4.339");
    await primeSeededSubjects(fleetPool);

    const org = await fleetPool.query<{ id: string }>(
      `SELECT uoa.organization_id AS id
         FROM bms.user_organization_access uoa
         JOIN bms.users u ON u.id = uoa.user_id
        WHERE u.email = $1
        LIMIT 1`,
      [ORGANIZATION_ADMIN_EMAIL],
    );
    if (!org.rows[0]) {
      throw new Error(`F4.339: ${ORGANIZATION_ADMIN_EMAIL} has no organization grant — run pnpm db:seed.`);
    }
    const organizationId = org.rows[0].id;
    const fleetDb = createDb(fleetPool);
    const tenantDb = createDb(tenantPool);
    const authDb = createDb(authPool);
    const accessControl = new AccessControlService(authDb, fleetDb);
    const audit = new MasterDataAuditService(tenantDb, fleetDb);
    const vocabularies = { listLocationTypes: async () => TYPES };
    const templates = { context: async () => EMPTY_TEMPLATE_CONTEXT, pointKeyQuota: async () => "exempt" };
    const chat = new OnboardingChatService(
      new OnboardingValidateService(),
      new CredentialCryptoService(),
      {} as never,
      { listPointKeys: async () => [] } as never,
      vocabularies as never,
      { resolveForOrganization: async () => ({ kind: "guided", reason: "platform_off" }) } as never,
      templates as never,
      { listExisting: async () => ({ rows: [], total: 0 }), listParentCandidates: async () => [] } as never,
    );
    const commit = new OnboardingCommitService(
      fleetDb,
      tenantDb,
      accessControl,
      audit,
      new OnboardingValidateService(),
      new VocabulariesService(fleetDb),
      templates as never,
      {} as never,
      {} as never,
      {} as never,
      { listParentCandidates: async () => [] } as never,
    );
    const excel = {
      parseUpload: () => ({ location: { name: "x" }, rtus: [], assets: [], rtuCredentials: [], displayNameFixes: [] }),
      toDraftPatch: () => ({}),
    };
    const service = new OnboardingService(
      fleetDb,
      tenantDb,
      accessControl,
      chat,
      new OnboardingValidateService(),
      commit,
      excel as never,
      { listPointKeys: async () => [] } as never,
      vocabularies as never,
      templates as never,
      { listParentCandidates: async () => [] } as never,
    );
    let n = 0;
    Object.assign(ctx, {
      pool: fleetPool,
      service,
      locks: new OnboardingSessionLockService(fleetDb, tenantDb, accessControl, audit, service),
      commit: (jwt: Parameters<OnboardingCommitService["commit"]>[0], id: string) => commit.commit(jwt, id),
      adminJwt: jwtFor("admin@bms.local", "admin"),
      orgAdminJwt: jwtFor(ORGANIZATION_ADMIN_EMAIL, "organization_admin"),
      seed: async (status: "draft" | "committed" = "draft") => {
        n += 1;
        const draft = seededDraft(n);
        const id = await withTenant(tenantDb, organizationId, async (tx) => {
          const [row] = await tx
            .insert(onboardingSessions)
            .values({ organizationId, status, currentPhase: "rtu", draft, messages: [] })
            .returning({ id: onboardingSessions.id });
          return row.id;
        });
        sessionIds.push(id);
        return id;
      },
    });
  }, 60_000);

  afterAll(async () => {
    if (sessionIds.length > 0 && fleetPool) {
      await fleetPool.query("DELETE FROM bms.audit_log WHERE entity_id = ANY($1)", [sessionIds]);
      await fleetPool.query("DELETE FROM bms.onboarding_sessions WHERE id = ANY($1)", [sessionIds]);
    }
    if (previousKey === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY;
    else process.env.CREDENTIAL_ENCRYPTION_KEY = previousKey;
    await Promise.all([fleetPool?.end(), tenantPool?.end(), authPool?.end()]);
  }, 60_000);

  it("LK1 an organization admin cannot lock", async () => {
    await assertAnOrganizationAdminCannotLock(ctx);
  }, 30_000);

  it("LK2 a global admin locks: columns, one audit row, the DTO", async () => {
    await assertAGlobalAdminLocks(ctx);
  }, 30_000);

  it("LK3 every writer refuses a locked draft with the one sentence; the read still answers", async () => {
    await assertEveryWriterRefusesALockedDraft(ctx);
  }, 30_000);

  it("LK4 unlock clears the lock and is idempotent", async () => {
    await assertUnlockIsIdempotent(ctx);
  }, 30_000);

  it("LK5 a committed session cannot be locked", async () => {
    await assertACommittedSessionCannotBeLocked(ctx);
  }, 30_000);
});
