import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb, onboardingSessions } from "@bms/db";
import type { OnboardingDraft } from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { withTenant } from "../../database/tenant-context";
import { CredentialCryptoService } from "../../security/credential-crypto.service";
import {
  openIntegrationPool,
  requireIntegrationDb,
  resolveIntegrationRoleUrl,
} from "../../testing/integration-db-gate";
import { asRole } from "../../testing/role-urls";
import { jwtFor, primeSeededSubjects } from "../../testing/seeded-subjects";
import { OnboardingChatService } from "./onboarding-chat.service";
import {
  assertAChangedDraftAnswers409,
  assertAnUnchangedDraftLetsTheTurnWrite,
  assertTheRefusedTurnWroteNothing,
  assertTheTurnWaitedOnTheHolder,
  raceTheChatWrite,
  type ChatLockCtx,
} from "./onboarding-chat-lock.integration.spec";
import { EMPTY_TEMPLATE_CONTEXT } from "./onboarding-template-refs";
import { OnboardingValidateService } from "./onboarding-validate.service";
import { OnboardingService } from "./onboarding.service";

/**
 * `F4.227` — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the database lifecycle. Both races run once in
 * `beforeAll`, one after the other, each on its own session row; every row is
 * committed, so `afterAll` deletes them by id.
 */
const connectionString = requireIntegrationDb({
  item: "F4.227",
  label: "OnboardingService.chat locks the session row before it compares the draft hash",
  because:
    "the chat write's SELECT ... FOR UPDATE and the hash re-check on the locked row are " +
    "only observable against a second writer on a real connection; the unit fakes answer " +
    ".for() with a static row, so a plain SELECT or a re-check on the loaded row passes them.",
});

const ORGANIZATION_ADMIN_EMAIL = "phe-admin@bms.local";
const RUN = Date.now();
const SEEDED_NAME = `F4.227 Seeded ${RUN}`;
const HOLDER_NAME = `F4.227 Holder ${RUN}`;
const TYPES = [{ code: "smoc_campus", label: "SMOC campus" }];

function seededDraft(suffix: string): OnboardingDraft {
  return {
    location: {
      code: `F4227-LOC-${suffix}-${RUN}`,
      slug: `f4227-loc-${suffix.toLowerCase()}-${RUN}`,
      name: SEEDED_NAME,
      type: "smoc_campus",
      latitude: 19.3,
      longitude: 84.8,
    },
  } as OnboardingDraft;
}

describe.skipIf(!connectionString)("F4.227 — the chat write locks the session row (real Postgres)", () => {
  let fleetPool: pg.Pool;
  let tenantPool: pg.Pool;
  let authPool: pg.Pool;
  let holderPool: pg.Pool;
  const sessionIds: string[] = [];
  const ctx = {} as ChatLockCtx;

  beforeAll(async () => {
    const url = connectionString as string;
    fleetPool = await openIntegrationPool(url, "F4.227");
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F4.227",
    );
    authPool = await openIntegrationPool(
      process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"),
      "F4.227",
    );
    // The holder: superuser, its own pool — never a connection the service uses.
    holderPool = await openIntegrationPool(
      resolveIntegrationRoleUrl(process.env.DATABASE_URL as string, "superuser", process.env),
      "F4.227",
    );

    await primeSeededSubjects(fleetPool);
    const jwt = jwtFor(ORGANIZATION_ADMIN_EMAIL, "organization_admin");
    const org = await fleetPool.query<{ id: string }>(
      `SELECT uoa.organization_id AS id
         FROM bms.user_organization_access uoa
         JOIN bms.users u ON u.id = uoa.user_id
        WHERE u.email = $1
        LIMIT 1`,
      [ORGANIZATION_ADMIN_EMAIL],
    );
    if (!org.rows[0]) {
      throw new Error(`F4.227: ${ORGANIZATION_ADMIN_EMAIL} has no organization grant — run pnpm db:seed.`);
    }
    const organizationId = org.rows[0].id;

    const fleetDb = createDb(fleetPool);
    const tenantDb = createDb(tenantPool);
    const authDb = createDb(authPool);

    const seedSession = async (suffix: string): Promise<string> => {
      const id = await withTenant(tenantDb, organizationId, async (tx) => {
        const [row] = await tx
          .insert(onboardingSessions)
          .values({ organizationId, status: "draft", currentPhase: "rtu", draft: seededDraft(suffix), messages: [] })
          .returning({ id: onboardingSessions.id });
        return row.id;
      });
      sessionIds.push(id);
      return id;
    };

    // The guided path (no provider), as `.env.example` ships: no model call.
    const vocabularies = { listLocationTypes: async () => TYPES };
    const chat = new OnboardingChatService(
      new OnboardingValidateService(),
      new CredentialCryptoService(),
      {} as never,
      { listPointKeys: async () => [] } as never,
      vocabularies as never,
      { resolveForOrganization: async () => ({ kind: "guided", reason: "platform_off" }) } as never,
      { context: async () => EMPTY_TEMPLATE_CONTEXT } as never,
      { listExisting: async () => ({ rows: [], total: 0 }) } as never,
    );
    const service = new OnboardingService(
      fleetDb,
      tenantDb,
      new AccessControlService(authDb, fleetDb),
      chat,
      new OnboardingValidateService(),
      {} as never,
      {} as never,
      {} as never,
      vocabularies as never,
      { context: async () => EMPTY_TEMPLATE_CONTEXT } as never,
    );

    Object.assign(ctx, { holderPool, service, jwt, holderName: HOLDER_NAME, seededName: SEEDED_NAME });

    const changedId = await seedSession("CHG");
    ctx.changed = await raceTheChatWrite(ctx, changedId, "race 1 (draft changed)", async (holder) => {
      const res = await holder.query(
        `UPDATE bms.onboarding_sessions
            SET draft = jsonb_set(draft, '{location,name}', to_jsonb($2::text))
          WHERE id = $1`,
        [changedId, HOLDER_NAME],
      );
      return res.rowCount;
    });

    const unchangedId = await seedSession("UNC");
    ctx.unchanged = await raceTheChatWrite(ctx, unchangedId, "race 2 (no change)", null);
  }, 60_000);

  afterAll(async () => {
    if (holderPool && sessionIds.length > 0) {
      await holderPool.query("DELETE FROM bms.onboarding_sessions WHERE id = ANY($1)", [sessionIds]);
    }
    await Promise.all([fleetPool?.end(), tenantPool?.end(), authPool?.end(), holderPool?.end()]);
  }, 60_000);

  // One claim group per `it`: `expect` throws, so the groups stay apart and a
  // failed group does not hide the next one (within a group, the first failed
  // `expect` hides the rest).
  it("race 1 control — the turn blocked on the holder's FOR UPDATE until it committed", () => {
    assertTheTurnWaitedOnTheHolder(ctx);
  });

  it("race 1 — a draft committed under the lock answers 409 DRAFT_CHANGED_DURING_TURN", () => {
    assertAChangedDraftAnswers409(ctx);
  });

  it("race 1 — the refused turn wrote nothing: the row holds the holder's draft and no new message", () => {
    assertTheRefusedTurnWroteNothing(ctx);
  });

  it("race 2 — a holder that commits no change lets the turn write its RTU and messages", () => {
    assertAnUnchangedDraftLetsTheTurnWrite(ctx);
  });
});
