import { parseMqttPlaintextHosts, type JwtPayload, type OnboardingDraft } from "@bms/shared";
import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb, onboardingSessions } from "@bms/db";

import { AccessControlService } from "../../auth/access-control.service";
import { withTenant } from "../../database/tenant-context";
import { openIntegrationPool, requireIntegrationDb } from "../../testing/integration-db-gate";
import { asRole } from "../../testing/role-urls";
import { jwtFor, primeSeededSubjects } from "../../testing/seeded-subjects";
import { VocabulariesService } from "../../vocabularies/vocabularies.service";
import { MasterDataAuditService } from "../master-data-audit.service";
import { OnboardingCommitService } from "./onboarding-commit.service";
import {
  assertAListedPlainRtuStoresTlsFalse,
  assertAnUnlistedPlainDraftCommitsNothing,
  assertTheCommitAuditRecordsThePlainRtu,
  type OnboardingPlaintextCtx,
} from "./onboarding-commit.plaintext.integration.spec";
import { EMPTY_TEMPLATE_CONTEXT } from "./onboarding-template-refs";
import { OnboardingValidateService } from "./onboarding-validate.service";

/**
 * `F4.326` — Vitest entry point; the harness is the `F4.228` empty-topic
 * suite's (seeded admin, real non-owner roles, one session per claim).
 */
const connectionString = requireIntegrationDb({
  item: "F4.326",
  label: "the onboarding commit and plain MQTT",
  because:
    "only a real commit shows the validator refusing before any write, the stored JSONB tls value " +
    "and the plaintextRtus audit payload (ADR 0114 decisions 5 and 6)",
});

const ORGANIZATION_ADMIN_EMAIL = "phe-admin@bms.local";
const RUN = Date.now();
const PLAIN_HOST = "plain.f4326.example";

function draftFor(tag: string, domain: string, rtus: { code: string; config: Record<string, unknown> }[]): OnboardingDraft {
  return {
    location: {
      code: `F4326-PL-LOC-${tag}-${RUN}`,
      slug: `f4326-pl-loc-${tag.toLowerCase()}-${RUN}`,
      name: `F4.326 Plain MQTT location ${tag}`,
      type: "smoc_campus",
      latitude: 0,
      longitude: 0,
    },
    rtus: rtus.map((r) => ({
      code: r.code,
      displayName: r.code,
      protocol: "mqtt",
      ingestEnabled: false,
      credentialsSet: false,
      config: r.config,
    })),
    pointKeys: [{ code: `F4326_PL_PK_${tag}_${RUN}`, name: `F4.326 Point Key ${tag}`, unit: "m3/h" }],
    assets: [{ rtuIndex: 0, code: `F4326-PL-AS-${tag}-${RUN}`, name: `F4.326 Asset ${tag}`, siteName: "F4.326 Site", domain }],
    assetPoints: [{ assetIndex: 0, pointKey: `F4326_PL_PK_${tag}_${RUN}`, sourceDataKey: `flow_${tag}` }],
  } as OnboardingDraft;
}

describe.skipIf(!connectionString)("F4.326 — the onboarding commit and plain MQTT (ADR 0114)", () => {
  let ownerPool: pg.Pool;
  let authPool: pg.Pool;
  let tenantPool: pg.Pool;
  let fleetPool: pg.Pool;
  const sessionIds: string[] = [];
  let ctx: OnboardingPlaintextCtx;
  const committed: OnboardingPlaintextCtx["committed"] = {};

  beforeAll(async () => {
    const url = connectionString as string;
    ownerPool = await openIntegrationPool(url, "F4.326");
    authPool = await openIntegrationPool(process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"), "F4.326");
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F4.326",
    );
    fleetPool = await openIntegrationPool(process.env.DATABASE_URL_FLEET ?? asRole(url, "bms_fleet", "bms_fleet_dev"), "F4.326");
    await primeSeededSubjects(fleetPool);
    const jwt: JwtPayload = jwtFor(ORGANIZATION_ADMIN_EMAIL, "organization_admin");

    const org = await ownerPool.query<{ id: string }>(
      `SELECT uoa.organization_id AS id FROM bms.user_organization_access uoa
         JOIN bms.users u ON u.id = uoa.user_id WHERE u.email = $1 LIMIT 1`,
      [ORGANIZATION_ADMIN_EMAIL],
    );
    if (!org.rows[0]) throw new Error(`F4.326: ${ORGANIZATION_ADMIN_EMAIL} has no organization grant — run pnpm db:seed.`);
    const organizationId = org.rows[0].id;
    const dom = await ownerPool.query<{ code: string }>("SELECT code FROM bms.asset_domains WHERE active = true LIMIT 1");
    if (!dom.rows[0]) throw new Error("F4.326: no active asset_domain — run pnpm db:seed.");
    const domain = dom.rows[0].code;

    const tenantDb = createDb(tenantPool);
    const fleetDb = createDb(fleetPool);
    const authDb = createDb(authPool);
    const seedSession = async (draft: OnboardingDraft): Promise<string> =>
      withTenant(tenantDb, organizationId, async (tx) => {
        const [row] = await tx
          .insert(onboardingSessions)
          .values({ organizationId, status: "draft", currentPhase: "review", draft })
          .returning({ id: onboardingSessions.id });
        sessionIds.push(row.id);
        return row.id;
      });

    const plainCode = `F4326-PL-RTU-P-${RUN}`;
    const tlsCode = `F4326-PL-RTU-T-${RUN}`;
    const plainConfig = { host: PLAIN_HOST, port: 1883, tls: false, topic: `F4326/${RUN}/plain` };
    const refusedSessionId = await seedSession(
      draftFor("R", domain, [{ code: `F4326-PL-RTU-R-${RUN}`, config: { ...plainConfig, topic: `F4326/${RUN}/refused` } }]),
    );
    const listedSessionId = await seedSession(
      draftFor("L", domain, [
        { code: plainCode, config: plainConfig },
        { code: tlsCode, config: { host: "tls.f4326.example", port: 8883, topic: `F4326/${RUN}/tls` } },
      ]),
    );

    const build = (validator: OnboardingValidateService) =>
      new OnboardingCommitService(
        fleetDb,
        tenantDb,
        new AccessControlService(authDb, fleetDb),
        new MasterDataAuditService(tenantDb, fleetDb),
        validator,
        new VocabulariesService(fleetDb),
        { context: async () => EMPTY_TEMPLATE_CONTEXT, pointKeyQuota: async () => "exempt" } as never,
        {} as never,
        {} as never,
        {} as never,
        { listParentCandidates: async () => [] } as never,
      );

    ctx = {
      ownerPool,
      listedSvc: build(new OnboardingValidateService(parseMqttPlaintextHosts(PLAIN_HOST))),
      bareSvc: build(new OnboardingValidateService()),
      jwt,
      refusedSessionId,
      refusedLocationCode: `F4326-PL-LOC-R-${RUN}`,
      listedSessionId,
      plainCode,
      tlsCode,
      committed,
    };
  }, 60_000);

  afterAll(async () => {
    if (ownerPool) {
      const c = committed.listed;
      if (c) {
        await ownerPool.query(`DELETE FROM bms.audit_log WHERE entity_id = ANY($1)`, [[...c.assetIds, c.locationId]]);
        await ownerPool.query(`DELETE FROM bms.asset_points WHERE id = ANY($1)`, [c.assetPointIds]);
        await ownerPool.query(`DELETE FROM bms.assets WHERE id = ANY($1)`, [c.assetIds]);
        await ownerPool.query(`DELETE FROM bms.rtu_connection_configs WHERE rtu_id = ANY($1)`, [c.rtuIds]);
        await ownerPool.query(`DELETE FROM bms.rtus WHERE id = ANY($1)`, [c.rtuIds]);
        await ownerPool.query(`DELETE FROM bms.point_keys WHERE id = ANY($1)`, [c.pointKeyIds]);
        await ownerPool.query(`DELETE FROM bms.locations WHERE id = $1`, [c.locationId]);
      }
      if (sessionIds.length > 0) {
        await ownerPool.query(
          `DELETE FROM bms.audit_log WHERE entity_type = 'onboarding_session' AND entity_id = ANY($1)`,
          [sessionIds],
        );
        await ownerPool.query(`DELETE FROM bms.onboarding_sessions WHERE id = ANY($1)`, [sessionIds]);
      }
    }
    await Promise.all([ownerPool?.end(), authPool?.end(), tenantPool?.end(), fleetPool?.end()]);
  }, 60_000);

  it("P1 an unlisted plain RTU is refused and commits nothing", async () => {
    await assertAnUnlistedPlainDraftCommitsNothing(ctx);
  }, 30_000);

  it("P2 a listed plain RTU commits with config.tls stored as false", async () => {
    await assertAListedPlainRtuStoresTlsFalse(ctx);
  }, 30_000);

  it("P3 the commit audit records the plain RTU by code only", async () => {
    await assertTheCommitAuditRecordsThePlainRtu(ctx);
  }, 30_000);
});
