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
  assertABrokerMismatchWritesNothing,
  assertAHostEditDropsACopiedCredential,
  assertACommittedSourceCopiesItsBytes,
  assertAnotherOrganizationsRtuIsNotFound,
  assertASameDraftCopy,
  assertReplaceDecides,
  type CopyCtx,
  PORT,
} from "./onboarding-credential-copy.integration.spec";
import { OnboardingCredentialCopyService } from "./onboarding-credential-copy.service";
import { EMPTY_TEMPLATE_CONTEXT } from "./onboarding-template-refs";
import { OnboardingValidateService } from "./onboarding-validate.service";
import { OnboardingService } from "./onboarding.service";

/**
 * `F4.339` / ADR 0117 decision 7 — Vitest entry point. Assertions live in the
 * sibling `.spec` (ADR 0014); this file owns the database lifecycle, in the
 * shape of `onboarding-lock.integration.test.ts`. Every credential is a test
 * value encrypted under a test key; every row it makes is deleted afterwards.
 */
const connectionString = requireIntegrationDb({
  item: "F4.339",
  label: "the onboarding credential copy: the stored blob, the audit row, a committed source, RLS",
  because:
    "the copy reads a committed RTU's ciphertext under tenant RLS and writes the draft's _secrets under " +
    "the session row lock; only a real database shows the bytes, the 404 across organizations and the audit row.",
});

const ORGANIZATION_ADMIN_EMAIL = "phe-admin@bms.local";
const RUN = Date.now();
const TYPES = [{ code: "smoc_campus", label: "SMOC campus" }];
const CREDENTIAL_KEY = Buffer.alloc(32, 0x02).toString("base64");

function seededDraft(n: number, thirdPort: number): { draft: OnboardingDraft; codes: string[] } {
  const codes = [0, 1, 2].map((i) => `F4339-CC-${n}-${i}`);
  const draft = {
    location: { code: `F4339-CC-${n}-${RUN}`, slug: `f4339-cc-${n}-${RUN}`, name: `F4.339 copy ${n}`, type: "smoc_campus", latitude: 19.3, longitude: 84.8 },
    rtus: codes.map((code, i) => ({
      code,
      displayName: code,
      protocol: "mqtt",
      config: { host: "broker.test", port: i === 2 ? thirdPort : PORT, topic: `f4339/cc/${RUN}/${n}/${i}` },
      credentialsSet: false,
      ingestEnabled: false,
    })),
  } as OnboardingDraft;
  return { draft, codes };
}

describe.skipIf(!connectionString)("F4.339 — the onboarding credential copy (real Postgres)", () => {
  let previousKey: string | undefined;
  let fleetPool: pg.Pool;
  let tenantPool: pg.Pool;
  let authPool: pg.Pool;
  const sessionIds: string[] = [];
  const rtuIds: string[] = [];
  const ctx = {} as CopyCtx;

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
    const crypto = new CredentialCryptoService();
    let n = 0;
    Object.assign(ctx, {
      pool: fleetPool,
      service,
      copies: new OnboardingCredentialCopyService(tenantDb, accessControl, audit, service),
      jwt: jwtFor(ORGANIZATION_ADMIN_EMAIL, "organization_admin"),
      seed: async (thirdPort = PORT) => {
        n += 1;
        const { draft, codes } = seededDraft(n, thirdPort);
        const id = await withTenant(tenantDb, organizationId, async (tx) => {
          const [row] = await tx
            .insert(onboardingSessions)
            .values({ organizationId, status: "draft", currentPhase: "rtu", draft, messages: [] })
            .returning({ id: onboardingSessions.id });
          return row.id;
        });
        sessionIds.push(id);
        return { id, codes };
      },
      committedRtu: async (own: boolean) => {
        n += 1;
        const loc = await fleetPool.query<{ id: string; organization_id: string }>(
          `SELECT id, organization_id FROM bms.locations WHERE ${own ? "organization_id = $1" : "organization_id <> $1"} AND active = true ORDER BY created_at, code LIMIT 1`,
          [organizationId],
        );
        if (!loc.rows[0]) throw new Error("F4.339: the seed has no location for this case — run pnpm db:seed.");
        const code = `F4339-CC-RTU-${n}-${RUN}`;
        const rtu = await fleetPool.query<{ id: string }>(
          `INSERT INTO bms.rtus (organization_id, location_id, code, display_name) VALUES ($1, $2, $3, $3) RETURNING id`,
          [loc.rows[0].organization_id, loc.rows[0].id, code],
        );
        const id = rtu.rows[0]!.id;
        rtuIds.push(id);
        const enc = crypto.encrypt({ username: "f4339-test", password: "not-a-real-password" });
        await fleetPool.query(
          `INSERT INTO bms.rtu_connection_configs (organization_id, rtu_id, protocol, config, credentials_ciphertext, credentials_iv, key_version)
           VALUES ($1, $2, 'mqtt', $3, $4, $5, $6)`,
          [loc.rows[0].organization_id, id, JSON.stringify({ host: "broker.test", port: PORT }), enc.ciphertext, enc.iv, enc.keyVersion],
        );
        return { id, code, ciphertext: enc.ciphertext, keyVersion: enc.keyVersion };
      },
    });
  }, 60_000);

  afterAll(async () => {
    if (rtuIds.length > 0 && fleetPool) {
      await fleetPool.query("DELETE FROM bms.rtus WHERE id = ANY($1)", [rtuIds]);
    }
    if (sessionIds.length > 0 && fleetPool) {
      await fleetPool.query("DELETE FROM bms.audit_log WHERE entity_id = ANY($1)", [sessionIds]);
      await fleetPool.query("DELETE FROM bms.onboarding_sessions WHERE id = ANY($1)", [sessionIds]);
    }
    if (previousKey === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY;
    else process.env.CREDENTIAL_ENCRYPTION_KEY = previousKey;
    await Promise.all([fleetPool?.end(), tenantPool?.end(), authPool?.end()]);
  }, 60_000);

  it("CC1 a same-draft copy: three equal blobs, credentialsSet, one audit row with no blob", async () => {
    await assertASameDraftCopy(ctx);
  }, 30_000);

  it("CC2 held targets refuse without replace and copy with it", async () => {
    await assertReplaceDecides(ctx);
  }, 30_000);

  it("CC3 a committed source copies its bytes and key version", async () => {
    await assertACommittedSourceCopiesItsBytes(ctx);
  }, 30_000);

  it("CC4 another organization's RTU is not found", async () => {
    await assertAnotherOrganizationsRtuIsNotFound(ctx);
  }, 30_000);

  it("CC5 a broker mismatch refuses and writes nothing", async () => {
    await assertABrokerMismatchWritesNothing(ctx);
  }, 30_000);

  it("CC6 a host edit after a copy drops the copied credential (review H1)", async () => {
    await assertAHostEditDropsACopiedCredential(ctx);
  }, 30_000);
});
