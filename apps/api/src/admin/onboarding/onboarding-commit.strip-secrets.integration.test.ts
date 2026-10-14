import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb, onboardingSessions } from "@bms/db";
import { CREDENTIAL_KEY_ENV } from "@bms/shared";
import type { JwtPayload, OnboardingCommitResponseDto, OnboardingDraft } from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { withTenant } from "../../database/tenant-context";
import { CredentialCryptoService } from "../../security/credential-crypto.service";
import { openIntegrationPool, requireIntegrationDb } from "../../testing/integration-db-gate";
import { asRole } from "../../testing/role-urls";
import { jwtFor, primeSeededSubjects } from "../../testing/seeded-subjects";
import { VocabulariesService } from "../../vocabularies/vocabularies.service";
import { MasterDataAuditService } from "../master-data-audit.service";
import { OnboardingCommitService } from "./onboarding-commit.service";
import {
  assertAnOpenDraftKeepsItsSecrets,
  assertTheCommittedDraftHoldsNoSecrets,
  assertTheConnectionConfigHoldsTheCiphertext,
  type StripSecretsCtx,
} from "./onboarding-commit.strip-secrets.integration.spec";
import { EMPTY_TEMPLATE_CONTEXT } from "./onboarding-template-refs";
import { OnboardingValidateService } from "./onboarding-validate.service";

/**
 * `F4.258` — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the database lifecycle. The harness and the
 * stale-row sweep are the `F4.228` empty-topic suite's. Two sessions in one
 * organization, both carrying `_secrets`: one is committed here, under a key
 * loaded for the duration of the encrypt and the commit, and one stays open.
 */
const connectionString = requireIntegrationDb({
  item: "F4.258",
  label: "the onboarding commit strips the draft's encrypted credentials",
  because:
    "the strip is a jsonb operator on the stored column, and only a real commit can show it " +
    "removes _secrets while the connection config keeps the ciphertext",
});

const ORGANIZATION_ADMIN_EMAIL = "phe-admin@bms.local";

const RUN = Date.now();
/** A row of this family older than this is an earlier run's, never a live one's. */
const STALE_AFTER = "30 minutes";

/** Reaps what an earlier run committed but never cleaned; see the F4.228 suite. */
async function sweepStaleRuns(pool: pg.Pool): Promise<void> {
  const staleLocations = `SELECT id FROM bms.locations
    WHERE code LIKE 'F4258-SS-LOC-%' AND created_at < now() - $1::interval`;
  const staleAssets = `SELECT id FROM bms.assets WHERE location_id IN (${staleLocations})`;
  const staleRtus = `SELECT id FROM bms.rtus WHERE location_id IN (${staleLocations})`;
  const staleSessions = `SELECT id FROM bms.onboarding_sessions
    WHERE draft->'location'->>'code' LIKE 'F4258-SS-LOC-%' AND created_at < now() - $1::interval`;
  const age = [STALE_AFTER];
  try {
    await pool.query(
      `DELETE FROM bms.audit_log
        WHERE (entity_type = 'location' AND entity_id IN (${staleLocations}))
           OR (entity_type = 'asset' AND entity_id IN (${staleAssets}))
           OR (entity_type = 'onboarding_session' AND entity_id IN (${staleSessions}))`,
      age,
    );
    await pool.query(`DELETE FROM bms.asset_points WHERE asset_id IN (${staleAssets})`, age);
    await pool.query(`DELETE FROM bms.assets WHERE id IN (${staleAssets})`, age);
    await pool.query(`DELETE FROM bms.rtu_connection_configs WHERE rtu_id IN (${staleRtus})`, age);
    await pool.query(`DELETE FROM bms.rtus WHERE id IN (${staleRtus})`, age);
    // `_` is a LIKE wildcard, so the point key family escapes it.
    await pool.query(
      `DELETE FROM bms.point_keys WHERE code LIKE 'F4258\\_SS\\_PK\\_%' AND created_at < now() - $1::interval`,
      age,
    );
    await pool.query(`DELETE FROM bms.locations WHERE id IN (${staleLocations})`, age);
    await pool.query(`DELETE FROM bms.onboarding_sessions WHERE id IN (${staleSessions})`, age);
  } catch (err) {
    process.stderr.write(
      `[F4.258] could not sweep stale fixture rows: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  }
}

/** One simulator RTU, one point key, one asset, one asset point. */
function draftFor(tag: string, domain: string): OnboardingDraft {
  return {
    location: {
      code: `F4258-SS-LOC-${tag}-${RUN}`,
      slug: `f4258-ss-loc-${tag.toLowerCase()}-${RUN}`,
      name: `F4.258 Strip secrets location ${tag}`,
      type: "smoc_campus",
      latitude: 0,
      longitude: 0,
    },
    rtus: [
      {
        code: rtuCode(tag),
        displayName: `F4.258 Strip secrets RTU ${tag}`,
        protocol: "simulator",
        config: {},
      },
    ],
    pointKeys: [{ code: `F4258_SS_PK_${tag}_${RUN}`, name: `F4.258 Point Key ${tag}`, unit: "kW" }],
    assets: [
      {
        rtuIndex: 0,
        code: `F4258-SS-AS-${tag}-${RUN}`,
        name: `F4.258 Asset ${tag}`,
        siteName: "F4.258 Site",
        domain,
      },
    ],
    assetPoints: [
      { assetIndex: 0, pointKey: `F4258_SS_PK_${tag}_${RUN}`, sourceDataKey: `F4258/SS/${tag}/${RUN}` },
    ],
  } as OnboardingDraft;
}

function rtuCode(tag: string): string {
  return `F4258-SS-RTU-${tag}-${RUN}`;
}

/** Sets the credential key env for `fn` and restores every name afterwards. */
async function withKey<T>(keyBase64: string, fn: () => Promise<T> | T): Promise<T> {
  const names = [CREDENTIAL_KEY_ENV.current, CREDENTIAL_KEY_ENV.previous, CREDENTIAL_KEY_ENV.version];
  const saved = names.map((name) => [name, process.env[name]] as const);
  process.env[CREDENTIAL_KEY_ENV.current] = keyBase64;
  delete process.env[CREDENTIAL_KEY_ENV.previous];
  delete process.env[CREDENTIAL_KEY_ENV.version];
  try {
    return await fn();
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }
}

describe.skipIf(!connectionString)("F4.258 — the onboarding commit strips the draft's encrypted credentials", () => {
  let ownerPool: pg.Pool;
  let authPool: pg.Pool;
  let tenantPool: pg.Pool;
  let fleetPool: pg.Pool;
  let committedSessionId = "";
  let openSessionId = "";
  let committed: OnboardingCommitResponseDto | undefined;
  let jwt: JwtPayload;
  let ctx: StripSecretsCtx;

  beforeAll(async () => {
    const url = connectionString as string;
    ownerPool = await openIntegrationPool(url, "F4.258");
    authPool = await openIntegrationPool(
      process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"),
      "F4.258",
    );
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F4.258",
    );
    fleetPool = await openIntegrationPool(
      process.env.DATABASE_URL_FLEET ?? asRole(url, "bms_fleet", "bms_fleet_dev"),
      "F4.258",
    );
    // F3.78: jwtFor carries the real bms.users.id as sub (ADR 0089 decision 4).
    await primeSeededSubjects(fleetPool);
    jwt = jwtFor(ORGANIZATION_ADMIN_EMAIL, "organization_admin");

    await sweepStaleRuns(ownerPool);

    const org = await ownerPool.query<{ id: string }>(
      `SELECT uoa.organization_id AS id
         FROM bms.user_organization_access uoa
         JOIN bms.users u ON u.id = uoa.user_id
        WHERE u.email = $1
        LIMIT 1`,
      [ORGANIZATION_ADMIN_EMAIL],
    );
    if (!org.rows[0]) {
      throw new Error(`F4.258: ${ORGANIZATION_ADMIN_EMAIL} has no organization grant — run pnpm db:seed.`);
    }
    const organizationId = org.rows[0].id;

    const dom = await ownerPool.query<{ code: string }>(
      "SELECT code FROM bms.asset_domains WHERE active = true LIMIT 1",
    );
    if (!dom.rows[0]) {
      throw new Error("F4.258: no active asset_domain — run pnpm db:seed.");
    }
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
        return row.id;
      });

    const commitSvc = new OnboardingCommitService(
      fleetDb,
      tenantDb,
      new AccessControlService(authDb, fleetDb),
      new MasterDataAuditService(tenantDb, fleetDb),
      new OnboardingValidateService(),
      new VocabulariesService(fleetDb),
      { context: async () => EMPTY_TEMPLATE_CONTEXT } as never,
      // F3.22: the three template services; these drafts hold no template, so none is called.
      {} as never,
      {} as never,
      {} as never,
    );

    // The commit copies a blob only when a key is configured
    // (`CredentialCryptoService.isConfigured()`), so the encrypt and the commit
    // both run under one key, set here and restored after.
    const keyBase64 = randomBytes(32).toString("base64");
    await withKey(keyBase64, async () => {
      const crypto = new CredentialCryptoService();
      const blobFor = (password: string) => {
        const enc = crypto.encrypt({ password });
        return { c: enc.ciphertext.toString("base64"), iv: enc.iv.toString("base64"), v: enc.keyVersion };
      };
      const committedBlob = blobFor("committed-password");
      const openSecrets = { [rtuCode("O")]: blobFor("open-password") };

      committedSessionId = await seedSession({
        ...draftFor("C", domain),
        _secrets: { [rtuCode("C")]: committedBlob },
      } as unknown as OnboardingDraft);
      openSessionId = await seedSession({
        ...draftFor("O", domain),
        _secrets: openSecrets,
      } as unknown as OnboardingDraft);

      committed = await commitSvc.commit(jwt, committedSessionId);
      ctx = {
        ownerPool,
        committedSessionId,
        openSessionId,
        committed,
        committedCiphertext: committedBlob.c,
        openSecrets,
      };
    });
  }, 60_000);

  afterAll(async () => {
    if (ownerPool) {
      if (committed) {
        const c = committed;
        await ownerPool.query(`DELETE FROM bms.audit_log WHERE entity_id = ANY($1)`, [
          [...c.assetIds, c.locationId],
        ]);
        await ownerPool.query(`DELETE FROM bms.asset_points WHERE id = ANY($1)`, [c.assetPointIds]);
        await ownerPool.query(`DELETE FROM bms.assets WHERE id = ANY($1)`, [c.assetIds]);
        await ownerPool.query(`DELETE FROM bms.rtu_connection_configs WHERE rtu_id = ANY($1)`, [c.rtuIds]);
        await ownerPool.query(`DELETE FROM bms.rtus WHERE id = ANY($1)`, [c.rtuIds]);
        await ownerPool.query(`DELETE FROM bms.point_keys WHERE id = ANY($1)`, [c.pointKeyIds]);
        await ownerPool.query(`DELETE FROM bms.locations WHERE id = $1`, [c.locationId]);
      }
      const sessionIds = [committedSessionId, openSessionId].filter(Boolean);
      if (sessionIds.length > 0) {
        // The commit audits the session as well as the location and assets.
        await ownerPool.query(
          `DELETE FROM bms.audit_log WHERE entity_type = 'onboarding_session' AND entity_id = ANY($1)`,
          [sessionIds],
        );
        await ownerPool.query(`DELETE FROM bms.onboarding_sessions WHERE id = ANY($1)`, [sessionIds]);
      }
    }
    await Promise.all([ownerPool?.end(), authPool?.end(), tenantPool?.end(), fleetPool?.end()]);
  }, 60_000);

  it("C1 the committed session's draft holds no _secrets", async () => {
    await assertTheCommittedDraftHoldsNoSecrets(ctx);
  }, 30_000);

  it("C2 the RTU's connection config holds the ciphertext the draft carried", async () => {
    await assertTheConnectionConfigHoldsTheCiphertext(ctx);
  }, 30_000);

  it("C3 an open draft in the same organization keeps its _secrets", async () => {
    await assertAnOpenDraftKeepsItsSecrets(ctx);
  }, 30_000);
});
