import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb, onboardingSessions } from "@bms/db";
import type { JwtPayload, OnboardingDraft } from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { withTenant } from "../../database/tenant-context";
import { CredentialCryptoService } from "../../security/credential-crypto.service";
import { openIntegrationPool, requireIntegrationDb } from "../../testing/integration-db-gate";
import { registerFixturePointKeys } from "../../testing/integration-fixtures";
import { asRole } from "../../testing/role-urls";
import { VocabulariesService } from "../../vocabularies/vocabularies.service";
import { MasterDataAuditService } from "../master-data-audit.service";
import { OnboardingCommitService } from "./onboarding-commit.service";
import { OnboardingValidateService } from "./onboarding-validate.service";
import {
  assertCommitAnswersADuplicateLocationCodeWithAFieldError,
  assertCommitAnswersADuplicateRtuCodeWithAFieldError,
  assertCommitRefusesAContradictingPointKey,
  assertCommitStampsOrgOnEveryTenantRow,
  assertCommitWritesTheKeyVersionForEachCredentialState,
  type CommitConflictFixtures,
  type CommitDuplicateFixtures,
  type CommitDuplicateRtuCodeFixtures,
  type CommitIds,
  type CommitKeyVersionFixtures,
  type CommitRlsFixtures,
} from "./onboarding-commit.service.rls.integration.spec";

/**
 * `E7.1b` — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the database lifecycle. It seeds one commit-ready
 * draft, runs the wizard's real commit against real `bms_auth`/`bms_tenant`/
 * `bms_fleet` connections, and proves every tenant-bearing row it writes is
 * stamped with the session's organization.
 *
 * The draft uses a `simulator` RTU on purpose: it exercises the same
 * `rtus`/`assets`/`asset_points` write path without needing an MQTT topic, MQTT
 * credentials or a configured `CREDENTIAL_ENCRYPTION_KEY`, so the org-stamping
 * proof stands on its own.
 */
const connectionString = requireIntegrationDb({
  item: "E7.1b",
  label: "onboarding commit stamps org on every tenant-bearing row it writes",
  because:
    "OnboardingCommitService.commit writes a whole estate — location, point keys, RTUs, RTU " +
    "connection configs, assets and asset points — in one withTenant transaction. rtus, assets " +
    "and asset_points gained organization_id in 0046 and a FORCEd policy in 0047; constructing " +
    "the service with real bms_tenant/bms_fleet connections is the only proof their inserts stamp " +
    "the org rather than passing because the owner connection bypasses row-level security.",
});

const ORGANIZATION_ADMIN_EMAIL = "phe-admin@bms.local";
const SYNTHETIC_SUB = "00000000-0000-4000-8000-000000000006";

const RUN = Date.now();
const LOCATION_CODE = `E71B-OB-${RUN}`;
const LOCATION_SLUG = `e71b-ob-${RUN}`;
const RTU_CODE = `E71B-OB-RTU-${RUN}`;
const ASSET_CODE = `E71B-OB-AS-${RUN}`;
const POINT_KEY_CODE = `E71B_OB_PK_${RUN}`;

// ADR 0051 Amendment 1 — a second draft, on its own codes so neither test can
// leave the other a row it did not expect. `SHARED_POINT_KEY_CODE` is
// registered in the catalog before the run with no unit, which is the
// decision 3 case: the draft below declares one, and must be refused.
const CONFLICT_LOCATION_CODE = `E71B-OBX-${RUN}`;
const CONFLICT_LOCATION_SLUG = `e71b-obx-${RUN}`;
const CONFLICT_RTU_CODE = `E71B-OBX-RTU-${RUN}`;
const CONFLICT_ASSET_CODE = `E71B-OBX-AS-${RUN}`;
const SHARED_POINT_KEY_CODE = `E71B_OBX_SHARED_${RUN}`;

// `F4.109` — a third draft, on its own codes again. Its `location.code` is one
// the fixture writes into this organization before the run, so the very first
// insert the commit transaction makes raises `23505` on
// `locations_org_code_idx`. The **slug** differs on purpose: a shared slug
// would raise `locations_slug_unique` instead and the case would silently
// measure the wrong constraint.
const DUPE_LOCATION_CODE = `E71B-OBD-${RUN}`;
const DUPE_SEEDED_LOCATION_SLUG = `e71b-obd-seed-${RUN}`;
const DUPE_DRAFT_LOCATION_SLUG = `e71b-obd-draft-${RUN}`;
const DUPE_RTU_CODE = `E71B-OBD-RTU-${RUN}`;
const DUPE_ASSET_CODE = `E71B-OBD-AS-${RUN}`;
const DUPE_POINT_KEY_CODE = `E71B_OBD_PK_${RUN}`;

// `F4.60` — a fifth draft, on its own codes again, and the one pre-existing RTU
// its `rtus[0].rtuCode` collides with.
//
// **Its location code and slug are BOTH fresh**, which is the opposite of the
// `F4.109` draft above and is what makes the case measure the right constraint.
// `rtus_rtu_code_idx` is keyed on the bare `rtu_code` column with no
// `location_id` and no `organization_id`, so the collision does not need — and
// must not have — anything else in common with an existing row. If the location
// code collided too, `locations_org_code_idx` would raise first, the commit
// would never reach its RTU insert, and the case would pass having proved
// nothing about `F4.60` at all.
//
// `RTUDUP_DEVICE_CODE` is the `rtus.rtu_code` value; `RTUDUP_RTU_CODE` is the
// location-scoped `rtus.code`. Two different columns, and conflating them is
// exactly how this case would go vacuous.
const RTUDUP_LOCATION_CODE = `E71B-OBR-${RUN}`;
const RTUDUP_LOCATION_SLUG = `e71b-obr-${RUN}`;
const RTUDUP_RTU_CODE = `E71B-OBR-RTU-${RUN}`;
const RTUDUP_ASSET_CODE = `E71B-OBR-AS-${RUN}`;
const RTUDUP_POINT_KEY_CODE = `E71B_OBR_PK_${RUN}`;
const RTUDUP_DEVICE_CODE = `E71B-OBR-DEV-${RUN}`;
const RTUDUP_SEEDED_LOCATION_CODE = `E71B-OBR-SEED-${RUN}`;
const RTUDUP_SEEDED_LOCATION_SLUG = `e71b-obr-seed-${RUN}`;
const RTUDUP_SEEDED_RTU_CODE = `E71B-OBR-SEED-RTU-${RUN}`;

// ADR 0062 decision 3 — a fourth draft, on its own codes and its own location,
// with three RTUs and no assets or point keys: nothing here exercises those,
// so they are left out rather than padded in to match the other drafts' shape.
const KEYVER_LOCATION_CODE = `E71B-OBK-${RUN}`;
const KEYVER_LOCATION_SLUG = `e71b-obk-${RUN}`;
const KEYVER_RTU_CURRENT_CODE = `E71B-OBK-RTU-A-${RUN}`;
const KEYVER_RTU_PREVIOUS_CODE = `E71B-OBK-RTU-P-${RUN}`;
const KEYVER_RTU_NONE_CODE = `E71B-OBK-RTU-N-${RUN}`;
const KEYVER_ASSET_CODE = `E71B-OBK-AS-${RUN}`;
const KEYVER_POINT_KEY_CODE = `E71B_OBK_PK_${RUN}`;

/** The distinct codes one draft writes, so two drafts never collide. */
type DraftCodes = {
  locationCode: string;
  locationSlug: string;
  rtuCode: string;
  assetCode: string;
  pointKeyCode: string;
  pointKeyUnit: string;
};

function jwtFor(email: string, role: JwtPayload["role"]): JwtPayload {
  return { sub: SYNTHETIC_SUB, email, name: `integration:${email}`, role };
}

function commitReadyDraft(domain: string, codes: DraftCodes): OnboardingDraft {
  return {
    location: {
      code: codes.locationCode,
      slug: codes.locationSlug,
      name: "E7.1b Onboarding Location",
      type: "smoc_campus",
      latitude: 0,
      longitude: 0,
    },
    rtus: [
      {
        code: codes.rtuCode,
        displayName: "E7.1b Onboarding RTU",
        protocol: "simulator",
        config: {},
      },
    ],
    pointKeys: [
      {
        code: codes.pointKeyCode,
        name: "E7.1b Onboarding Point Key",
        unit: codes.pointKeyUnit,
      },
    ],
    assets: [
      {
        rtuIndex: 0,
        code: codes.assetCode,
        name: "E7.1b Onboarding Asset",
        siteName: "E7.1b Site",
        domain,
      },
    ],
    assetPoints: [
      {
        assetIndex: 0,
        pointKey: codes.pointKeyCode,
        sourceDataKey: "E71B/OB/RAW",
      },
    ],
  } as OnboardingDraft;
}

const STAMPING_CODES: DraftCodes = {
  locationCode: LOCATION_CODE,
  locationSlug: LOCATION_SLUG,
  rtuCode: RTU_CODE,
  assetCode: ASSET_CODE,
  pointKeyCode: POINT_KEY_CODE,
  pointKeyUnit: "kW",
};

const CONFLICT_CODES: DraftCodes = {
  locationCode: CONFLICT_LOCATION_CODE,
  locationSlug: CONFLICT_LOCATION_SLUG,
  rtuCode: CONFLICT_RTU_CODE,
  assetCode: CONFLICT_ASSET_CODE,
  pointKeyCode: SHARED_POINT_KEY_CODE,
  pointKeyUnit: "kW",
};

const RTUDUP_CODES: DraftCodes = {
  locationCode: RTUDUP_LOCATION_CODE,
  locationSlug: RTUDUP_LOCATION_SLUG,
  rtuCode: RTUDUP_RTU_CODE,
  assetCode: RTUDUP_ASSET_CODE,
  pointKeyCode: RTUDUP_POINT_KEY_CODE,
  pointKeyUnit: "kW",
};

/**
 * `F4.60` — `commitReadyDraft` with the device key set on its one RTU.
 *
 * `DraftCodes.rtuCode` is `rtus[].code`, the location-scoped name. The column
 * `0071` constrains is `rtus[].rtuCode`, which the base draft never sets, so it
 * is added here rather than by widening `DraftCodes` — four other drafts use
 * that type and none of them wants a device key.
 */
function draftWithDeviceKey(domain: string, codes: DraftCodes, deviceKey: string): OnboardingDraft {
  const draft = commitReadyDraft(domain, codes);
  const [rtu] = draft.rtus ?? [];
  if (!rtu) {
    throw new Error("F4.60: commitReadyDraft produced no RTU to hang a device key on");
  }
  rtu.rtuCode = deviceKey;
  return draft;
}

const DUPE_CODES: DraftCodes = {
  locationCode: DUPE_LOCATION_CODE,
  locationSlug: DUPE_DRAFT_LOCATION_SLUG,
  rtuCode: DUPE_RTU_CODE,
  assetCode: DUPE_ASSET_CODE,
  pointKeyCode: DUPE_POINT_KEY_CODE,
  pointKeyUnit: "kW",
};

/**
 * Runs `fn` with the three key-window env vars set to exactly the given
 * values, then restores whatever was there before — used both to produce
 * fixture ciphertext under a chosen key and, in the case itself, to run the
 * commit under the real rotation window (ADR 0062 decision 3).
 */
async function withKeyWindow<T>(
  vars: { current?: string; previous?: string; version?: string },
  fn: () => Promise<T> | T,
): Promise<T> {
  const NAMES = {
    current: "CREDENTIAL_ENCRYPTION_KEY",
    previous: "CREDENTIAL_ENCRYPTION_KEY_PREVIOUS",
    version: "CREDENTIAL_ENCRYPTION_KEY_VERSION",
  } as const;
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(NAMES) as (keyof typeof NAMES)[]) {
    saved[NAMES[key]] = process.env[NAMES[key]];
    const value = vars[key];
    if (value === undefined) {
      delete process.env[NAMES[key]];
    } else {
      process.env[NAMES[key]] = value;
    }
  }
  try {
    return await fn();
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }
}

/**
 * A draft with three RTUs. `readyToCommit` requires the "review" phase, which
 * `OnboardingValidateService.inferPhase` reaches only once a point key, an
 * asset and an asset point all exist — so one of each is added here, mapped
 * to the first RTU, exactly as `commitReadyDraft` does for its single RTU.
 */
function keyVersionDraft(domain: string): OnboardingDraft {
  return {
    location: {
      code: KEYVER_LOCATION_CODE,
      slug: KEYVER_LOCATION_SLUG,
      name: "E8.4 Key Version Location",
      type: "smoc_campus",
      latitude: 0,
      longitude: 0,
    },
    rtus: [
      {
        code: KEYVER_RTU_CURRENT_CODE,
        displayName: "E8.4 Current-key RTU",
        protocol: "simulator",
        config: {},
      },
      {
        code: KEYVER_RTU_PREVIOUS_CODE,
        displayName: "E8.4 Previous-key RTU",
        protocol: "simulator",
        config: {},
      },
      {
        code: KEYVER_RTU_NONE_CODE,
        displayName: "E8.4 Credential-less RTU",
        protocol: "simulator",
        config: {},
      },
    ],
    pointKeys: [
      {
        code: KEYVER_POINT_KEY_CODE,
        name: "E8.4 Key Version Point Key",
        unit: "kW",
      },
    ],
    assets: [
      {
        rtuIndex: 0,
        code: KEYVER_ASSET_CODE,
        name: "E8.4 Key Version Asset",
        siteName: "E8.4 Site",
        domain,
      },
    ],
    assetPoints: [
      {
        assetIndex: 0,
        pointKey: KEYVER_POINT_KEY_CODE,
        sourceDataKey: "E71B/OBK/RAW",
      },
    ],
  } as OnboardingDraft;
}

describe.skipIf(!connectionString)("E7.1b — onboarding commit stamps org under real RLS", () => {
  let ownerPool: pg.Pool;
  let authPool: pg.Pool;
  let tenantPool: pg.Pool;
  let fleetPool: pg.Pool;
  let ctx: CommitRlsFixtures;
  let conflictCtx: CommitConflictFixtures;
  let dupeCtx: CommitDuplicateFixtures;
  let rtuDupCtx: CommitDuplicateRtuCodeFixtures;
  let sessionId = "";
  let conflictSessionId = "";
  let dupeSessionId = "";
  let dupeLocationId = "";
  let rtuDupSessionId = "";
  let rtuDupSeedLocationId = "";
  let rtuDupSeedRtuId = "";
  let removeSharedPointKey: (() => Promise<void>) | undefined;
  let committed: CommitIds | undefined;
  let keyVerCtx: CommitKeyVersionFixtures;
  let keyVerSessionId = "";
  let keyVerCommitted: CommitIds | undefined;

  const jwt = jwtFor(ORGANIZATION_ADMIN_EMAIL, "organization_admin");

  beforeAll(async () => {
    const url = connectionString as string;
    ownerPool = await openIntegrationPool(url, "E7.1b");
    authPool = await openIntegrationPool(
      process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"),
      "E7.1b",
    );
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "E7.1b",
    );
    fleetPool = await openIntegrationPool(
      process.env.DATABASE_URL_FLEET ?? asRole(url, "bms_fleet", "bms_fleet_dev"),
      "E7.1b",
    );

    const org = await ownerPool.query<{ id: string }>(
      `SELECT uoa.organization_id AS id
         FROM bms.user_organization_access uoa
         JOIN bms.users u ON u.id = uoa.user_id
        WHERE u.email = $1
        LIMIT 1`,
      [ORGANIZATION_ADMIN_EMAIL],
    );
    if (!org.rows[0]) {
      throw new Error(
        `E7.1b: ${ORGANIZATION_ADMIN_EMAIL} has no organization grant — run pnpm db:seed.`,
      );
    }
    const organizationId = org.rows[0].id;

    const dom = await ownerPool.query<{ code: string }>(
      "SELECT code FROM bms.asset_domains WHERE active = true LIMIT 1",
    );
    if (!dom.rows[0]) {
      throw new Error("E7.1b: no active asset_domain — run pnpm db:seed.");
    }
    const domain = dom.rows[0].code;

    const tenantDb = createDb(tenantPool);
    const fleetDb = createDb(fleetPool);
    const authDb = createDb(authPool);

    // Seed each draft session through bms_tenant. onboarding_sessions is
    // policied (FORCE since 0040), so the GUC = org is what lets the insert's
    // WITH CHECK pass — the same tenant boundary the commit itself runs under.
    const seedSession = async (draft: OnboardingDraft): Promise<string> =>
      withTenant(tenantDb, organizationId, async (tx) => {
        const [row] = await tx
          .insert(onboardingSessions)
          .values({
            organizationId,
            status: "draft",
            currentPhase: "review",
            draft,
          })
          .returning({ id: onboardingSessions.id });
        return row.id;
      });

    sessionId = await seedSession(commitReadyDraft(domain, STAMPING_CODES));
    conflictSessionId = await seedSession(commitReadyDraft(domain, CONFLICT_CODES));
    dupeSessionId = await seedSession(commitReadyDraft(domain, DUPE_CODES));
    rtuDupSessionId = await seedSession(
      draftWithDeviceKey(domain, RTUDUP_CODES, RTUDUP_DEVICE_CODE),
    );

    // ADR 0062 decision 3 — build the two credential blobs the key-version
    // draft carries, each under its own env-loaded key, before the draft is
    // seeded. `previousKeyBase64` encrypts as the (sole, "current") key here
    // so the blob is genuinely readable under it, and is stored with no `v` —
    // the state every pre-ADR-0062 blob is actually in.
    const currentKeyBase64 = randomBytes(32).toString("base64");
    const previousKeyBase64 = randomBytes(32).toString("base64");
    const currentBlob = await withKeyWindow(
      { current: currentKeyBase64, version: "2" },
      () => new CredentialCryptoService().encrypt({ password: "current-key-password" }),
    );
    const previousBlob = await withKeyWindow({ current: previousKeyBase64 }, () =>
      new CredentialCryptoService().encrypt({ password: "previous-key-password" }),
    );

    const draftWithSecrets = {
      ...keyVersionDraft(domain),
      _secrets: {
        [KEYVER_RTU_CURRENT_CODE]: {
          c: currentBlob.ciphertext.toString("base64"),
          iv: currentBlob.iv.toString("base64"),
          v: 2,
        },
        [KEYVER_RTU_PREVIOUS_CODE]: {
          c: previousBlob.ciphertext.toString("base64"),
          iv: previousBlob.iv.toString("base64"),
        },
      },
    } as unknown as OnboardingDraft;
    keyVerSessionId = await seedSession(draftWithSecrets);

    // `F4.109` — the row the third draft's `location.code` collides with.
    // Written here rather than by a sibling test so the case carries no
    // ordering dependency, and on `ownerPool` (BYPASSRLS) so it needs no GUC.
    const dupeLocation = await ownerPool.query<{ id: string }>(
      `INSERT INTO bms.locations
         (organization_id, code, slug, name, type, latitude, longitude)
       VALUES ($1, $2, $3, 'F4.109 duplicate-code probe', 'smoc_campus', 0, 0)
       RETURNING id`,
      [organizationId, DUPE_LOCATION_CODE, DUPE_SEEDED_LOCATION_SLUG],
    );
    dupeLocationId = dupeLocation.rows[0].id;

    // `F4.60` — the RTU whose `rtu_code` the fifth draft collides with, on its
    // own location so the collision is on the device key ALONE. Written here on
    // `ownerPool` (BYPASSRLS) for the same reasons as the row above.
    const rtuDupLocation = await ownerPool.query<{ id: string }>(
      `INSERT INTO bms.locations
         (organization_id, code, slug, name, type, latitude, longitude)
       VALUES ($1, $2, $3, 'F4.60 duplicate-rtu_code probe', 'smoc_campus', 0, 0)
       RETURNING id`,
      [organizationId, RTUDUP_SEEDED_LOCATION_CODE, RTUDUP_SEEDED_LOCATION_SLUG],
    );
    rtuDupSeedLocationId = rtuDupLocation.rows[0].id;
    const rtuDupRtu = await ownerPool.query<{ id: string }>(
      `INSERT INTO bms.rtus
         (organization_id, location_id, code, display_name, rtu_code)
       VALUES ($1, $2, $3, 'F4.60 duplicate-rtu_code probe', $4)
       RETURNING id`,
      [organizationId, rtuDupSeedLocationId, RTUDUP_SEEDED_RTU_CODE, RTUDUP_DEVICE_CODE],
    );
    rtuDupSeedRtuId = rtuDupRtu.rows[0].id;

    // The catalog row the second draft contradicts. `registerFixturePointKeys`
    // writes `(code, name, active)` only, so the unit is NULL — Amendment 1
    // decision 3's case, and the one the four seeded orphans are in.
    removeSharedPointKey = await registerFixturePointKeys(ownerPool, [SHARED_POINT_KEY_CODE]);

    const commitSvc = new OnboardingCommitService(
      fleetDb,
      tenantDb,
      new AccessControlService(authDb, fleetDb),
      new MasterDataAuditService(tenantDb, fleetDb),
      new OnboardingValidateService(),
      new VocabulariesService(fleetDb),
    );

    ctx = { commitSvc, ownerPool, organizationId, sessionId };
    conflictCtx = {
      commitSvc,
      ownerPool,
      sessionId: conflictSessionId,
      pointKeyCode: SHARED_POINT_KEY_CODE,
      locationCode: CONFLICT_LOCATION_CODE,
    };
    dupeCtx = {
      commitSvc,
      ownerPool,
      sessionId: dupeSessionId,
      organizationId,
      locationCode: DUPE_LOCATION_CODE,
    };
    rtuDupCtx = {
      commitSvc,
      ownerPool,
      sessionId: rtuDupSessionId,
      rtuCode: RTUDUP_DEVICE_CODE,
      draftLocationCode: RTUDUP_LOCATION_CODE,
    };
    keyVerCtx = {
      commitSvc,
      ownerPool,
      sessionId: keyVerSessionId,
      currentKeyBase64,
      previousKeyBase64,
      rtuCodes: {
        current: KEYVER_RTU_CURRENT_CODE,
        previous: KEYVER_RTU_PREVIOUS_CODE,
        none: KEYVER_RTU_NONE_CODE,
      },
    };
  });

  afterAll(async () => {
    // `F4.109` — set by the sweep below, reported after every delete has run.
    let dupeProbeRowMissing = false;
    let rtuDupProbeRowMissing = false;
    // children first, on the BYPASSRLS fleet connection. Delete by the ids the
    // commit returned; the session row is removed by its own id regardless.
    if (ownerPool) {
      if (committed) {
        await ownerPool.query(`DELETE FROM bms.audit_log WHERE entity_id = ANY($1)`, [
          [sessionId, committed.locationId],
        ]);
        await ownerPool.query(`DELETE FROM bms.asset_points WHERE id = ANY($1)`, [
          committed.assetPointIds,
        ]);
        await ownerPool.query(`DELETE FROM bms.assets WHERE id = ANY($1)`, [committed.assetIds]);
        await ownerPool.query(`DELETE FROM bms.rtu_connection_configs WHERE rtu_id = ANY($1)`, [
          committed.rtuIds,
        ]);
        await ownerPool.query(`DELETE FROM bms.rtus WHERE id = ANY($1)`, [committed.rtuIds]);
        await ownerPool.query(`DELETE FROM bms.point_keys WHERE id = ANY($1)`, [
          committed.pointKeyIds,
        ]);
        await ownerPool.query(`DELETE FROM bms.locations WHERE id = $1`, [committed.locationId]);
      }
      // ADR 0062 decision 3's draft, cleaned up the same way as `committed` above.
      if (keyVerCommitted) {
        await ownerPool.query(`DELETE FROM bms.asset_points WHERE id = ANY($1)`, [
          keyVerCommitted.assetPointIds,
        ]);
        await ownerPool.query(`DELETE FROM bms.assets WHERE id = ANY($1)`, [
          keyVerCommitted.assetIds,
        ]);
        await ownerPool.query(`DELETE FROM bms.rtu_connection_configs WHERE rtu_id = ANY($1)`, [
          keyVerCommitted.rtuIds,
        ]);
        await ownerPool.query(`DELETE FROM bms.rtus WHERE id = ANY($1)`, [keyVerCommitted.rtuIds]);
        await ownerPool.query(`DELETE FROM bms.point_keys WHERE id = ANY($1)`, [
          keyVerCommitted.pointKeyIds,
        ]);
        await ownerPool.query(`DELETE FROM bms.locations WHERE id = $1`, [
          keyVerCommitted.locationId,
        ]);
      }
      // Both sessions, unconditionally: the conflict draft never commits, so it
      // leaves nothing but its own row, and `committed` says nothing about it.
      const sessionIds = [sessionId, conflictSessionId, dupeSessionId, keyVerSessionId].filter(
        Boolean,
      );
      if (sessionIds.length > 0) {
        await ownerPool.query(`DELETE FROM bms.onboarding_sessions WHERE id = ANY($1)`, [
          sessionIds,
        ]);
      }
    }
    // Everything below is outside the `if (committed)` bracket on purpose, and
    // is keyed by this run's codes rather than by ids a commit returned.
    //
    // The second test asserts a **refusal**, so on a green run its draft writes
    // nothing and these statements delete nothing. The run that matters is the
    // red one: if the guard ever regresses, that draft commits a whole estate
    // into PHEWB and no `committed` value names it. A leftover `E71B-OB*`
    // location is what makes `compose up`'s seed verifier fail on the next run,
    // several sessions later, with a row count and no cause.
    if (ownerPool) {
      const strays = await ownerPool.query<{ id: string }>(
        `SELECT id FROM bms.assets WHERE code = $1`,
        [CONFLICT_ASSET_CODE],
      );
      const strayAssetIds = strays.rows.map((r) => r.id);
      if (strayAssetIds.length > 0) {
        await ownerPool.query(`DELETE FROM bms.asset_points WHERE asset_id = ANY($1)`, [
          strayAssetIds,
        ]);
        await ownerPool.query(`DELETE FROM bms.asset_group_members WHERE asset_id = ANY($1)`, [
          strayAssetIds,
        ]);
        await ownerPool.query(`DELETE FROM bms.assets WHERE id = ANY($1)`, [strayAssetIds]);
      }
      const strayRtus = await ownerPool.query<{ id: string }>(
        `SELECT id FROM bms.rtus WHERE code = $1`,
        [CONFLICT_RTU_CODE],
      );
      const strayRtuIds = strayRtus.rows.map((r) => r.id);
      if (strayRtuIds.length > 0) {
        await ownerPool.query(`DELETE FROM bms.rtu_connection_configs WHERE rtu_id = ANY($1)`, [
          strayRtuIds,
        ]);
        await ownerPool.query(`DELETE FROM bms.rtus WHERE id = ANY($1)`, [strayRtuIds]);
      }
      const strayLocations = await ownerPool.query<{ id: string }>(
        `SELECT id FROM bms.locations WHERE code = $1`,
        [CONFLICT_LOCATION_CODE],
      );
      const strayLocationIds = strayLocations.rows.map((r) => r.id);
      if (strayLocationIds.length > 0) {
        await ownerPool.query(`DELETE FROM bms.audit_log WHERE entity_id = ANY($1)`, [
          strayLocationIds,
        ]);
        await ownerPool.query(`DELETE FROM bms.locations WHERE id = ANY($1)`, [strayLocationIds]);
      }
    }
    // `F4.109` — the same shape again for the duplicate-code draft, and for the
    // same reason: on a green run it commits nothing and these delete nothing,
    // but a regression that lets the duplicate through writes a whole estate
    // into PHEWB under `E71B-OBD*` codes and no returned id names it. The
    // locations sweep is by `code`, which matches the seeded probe row **and**
    // any stray the commit wrote — both must go, and the seeded one is the row
    // this case exists to collide with, so it is never left behind.
    if (ownerPool) {
      const dupeAssets = await ownerPool.query<{ id: string }>(
        `SELECT id FROM bms.assets WHERE code = $1`,
        [DUPE_ASSET_CODE],
      );
      const dupeAssetIds = dupeAssets.rows.map((r) => r.id);
      if (dupeAssetIds.length > 0) {
        await ownerPool.query(`DELETE FROM bms.asset_points WHERE asset_id = ANY($1)`, [
          dupeAssetIds,
        ]);
        await ownerPool.query(`DELETE FROM bms.asset_group_members WHERE asset_id = ANY($1)`, [
          dupeAssetIds,
        ]);
        await ownerPool.query(`DELETE FROM bms.assets WHERE id = ANY($1)`, [dupeAssetIds]);
      }
      const dupeRtus = await ownerPool.query<{ id: string }>(
        `SELECT id FROM bms.rtus WHERE code = $1`,
        [DUPE_RTU_CODE],
      );
      const dupeRtuIds = dupeRtus.rows.map((r) => r.id);
      if (dupeRtuIds.length > 0) {
        await ownerPool.query(`DELETE FROM bms.rtu_connection_configs WHERE rtu_id = ANY($1)`, [
          dupeRtuIds,
        ]);
        await ownerPool.query(`DELETE FROM bms.rtus WHERE id = ANY($1)`, [dupeRtuIds]);
      }
      const dupeLocations = await ownerPool.query<{ id: string }>(
        `SELECT id FROM bms.locations WHERE code = $1`,
        [DUPE_LOCATION_CODE],
      );
      const dupeLocationIds = dupeLocations.rows.map((r) => r.id);
      if (dupeLocationIds.length > 0) {
        await ownerPool.query(`DELETE FROM bms.audit_log WHERE entity_id = ANY($1)`, [
          dupeLocationIds,
        ]);
        await ownerPool.query(`DELETE FROM bms.locations WHERE id = ANY($1)`, [dupeLocationIds]);
      }
      // After the asset_points above, which reference it (migration `0057`).
      await ownerPool.query(`DELETE FROM bms.point_keys WHERE code = $1`, [DUPE_POINT_KEY_CODE]);
      // Recorded, **not thrown here**. A throw at this point aborts the rest of
      // `afterAll` — including `removeSharedPointKey()` below — and a stray
      // `bms.point_keys` row is exactly what makes a later `compose up` fail its
      // seed count with no cause. The report happens after every delete has run.
      dupeProbeRowMissing = dupeLocationId !== "" && dupeLocationIds.length === 0;
    }
    // `F4.60` — the same shape once more. Two sweeps, because this case plants
    // rows under TWO locations: the seeded probe (`E71B-OBR-SEED*`, holding the
    // RTU the draft collides with) and the draft's own (`E71B-OBR-*`), which
    // exists only if a regression let the commit through. Assets and RTUs go
    // before their locations; `rtu_connection_configs` before its RTU.
    if (ownerPool) {
      const rtuDupAssets = await ownerPool.query<{ id: string }>(
        `SELECT id FROM bms.assets WHERE code = $1`,
        [RTUDUP_ASSET_CODE],
      );
      const rtuDupAssetIds = rtuDupAssets.rows.map((r) => r.id);
      if (rtuDupAssetIds.length > 0) {
        await ownerPool.query(`DELETE FROM bms.asset_points WHERE asset_id = ANY($1)`, [
          rtuDupAssetIds,
        ]);
        await ownerPool.query(`DELETE FROM bms.asset_group_members WHERE asset_id = ANY($1)`, [
          rtuDupAssetIds,
        ]);
        await ownerPool.query(`DELETE FROM bms.assets WHERE id = ANY($1)`, [rtuDupAssetIds]);
      }
      // By `rtu_code`, not by `code`: that catches BOTH the seeded probe RTU and
      // any stray the commit wrote, since sharing this value is the whole point
      // of the case. A sweep by `code` alone would leave one of them behind, and
      // a left-behind row here poisons the NEXT run of this same suite — its
      // fresh draft would collide with the stray instead of with its own probe.
      const rtuDupRtus = await ownerPool.query<{ id: string }>(
        `SELECT id FROM bms.rtus WHERE rtu_code = $1 OR code = $2`,
        [RTUDUP_DEVICE_CODE, RTUDUP_RTU_CODE],
      );
      const rtuDupRtuIds = rtuDupRtus.rows.map((r) => r.id);
      if (rtuDupRtuIds.length > 0) {
        await ownerPool.query(`DELETE FROM bms.rtu_connection_configs WHERE rtu_id = ANY($1)`, [
          rtuDupRtuIds,
        ]);
        await ownerPool.query(`DELETE FROM bms.rtus WHERE id = ANY($1)`, [rtuDupRtuIds]);
      }
      const rtuDupLocations = await ownerPool.query<{ id: string }>(
        `SELECT id FROM bms.locations WHERE code = ANY($1)`,
        [[RTUDUP_SEEDED_LOCATION_CODE, RTUDUP_LOCATION_CODE]],
      );
      const rtuDupLocationIds = rtuDupLocations.rows.map((r) => r.id);
      if (rtuDupLocationIds.length > 0) {
        await ownerPool.query(`DELETE FROM bms.audit_log WHERE entity_id = ANY($1)`, [
          rtuDupLocationIds,
        ]);
        await ownerPool.query(`DELETE FROM bms.locations WHERE id = ANY($1)`, [rtuDupLocationIds]);
      }
      await ownerPool.query(`DELETE FROM bms.point_keys WHERE code = $1`, [RTUDUP_POINT_KEY_CODE]);
      rtuDupProbeRowMissing = rtuDupSeedRtuId !== "" && rtuDupRtuIds.length === 0;
    }
    // Last, because the asset_points above reference it (migration `0057`).
    // This row is inserted in `beforeAll`, not by a commit, so no `committed`
    // id would ever reach it.
    if (removeSharedPointKey) {
      await removeSharedPointKey();
    }
    await Promise.all(
      [ownerPool, authPool, tenantPool, fleetPool].filter(Boolean).map((p) => p.end()),
    );
    // Last of all, so raising it cannot cost any of the deletes above.
    if (dupeProbeRowMissing) {
      throw new Error(
        `F4.109: the seeded probe location ${DUPE_LOCATION_CODE} was gone before cleanup — ` +
          "something else removed it, and the duplicate-code case measured nothing",
      );
    }
    if (rtuDupProbeRowMissing) {
      throw new Error(
        `F4.60: the seeded probe RTU carrying rtu_code ${RTUDUP_DEVICE_CODE} was gone before ` +
          "cleanup — something else removed it, and the duplicate-rtuCode case measured nothing",
      );
    }
  });

  it("stamps the session org on the location, point keys, RTUs, assets and asset points", async () => {
    committed = await assertCommitStampsOrgOnEveryTenantRow(ctx, jwt);
  });

  it("refuses a draft that contradicts a point key the whole fleet shares", async () => {
    await assertCommitRefusesAContradictingPointKey(conflictCtx, jwt);
  });

  it("answers a duplicate location code with a per-field 400 rather than a 500 (F4.109)", async () => {
    await assertCommitAnswersADuplicateLocationCodeWithAFieldError(dupeCtx, jwt);
  });

  it("answers a duplicate rtuCode with a per-field 400 naming rtus (F4.60)", async () => {
    await assertCommitAnswersADuplicateRtuCodeWithAFieldError(rtuDupCtx, jwt);
  });

  it("writes the key version with the ciphertext, never a literal (ADR 0062 decision 3)", async () => {
    keyVerCommitted = await assertCommitWritesTheKeyVersionForEachCredentialState(keyVerCtx, jwt);
  });
});
