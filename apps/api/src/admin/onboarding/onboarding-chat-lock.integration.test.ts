import { randomUUID } from "node:crypto";

import { eq, sql } from "drizzle-orm";
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
  CONFIRM_TURN,
  UNDO_TURN,
  assertAChangedDraftAnswers409,
  assertACommittingConfirmAppendsToTheCommittedRow,
  assertACommittingConfirmKeepsAMessageCommittedUnderTheLock,
  assertAConfirmWithNoProposalKeepsAMessageCommittedUnderTheLock,
  assertAMessageCommittedUnderTheLockSurvivesTheUndo,
  assertAStaleConfirmKeepsAMessageCommittedUnderTheLock,
  assertAStaleConfirmOverAChangedDraftAnswers409,
  assertAnUnchangedDraftLetsTheTurnWrite,
  assertAnUndoOverAChangedDraftAnswers409,
  assertTheChangedUndoWaitedOnTheHolder,
  assertTheRefusedTurnWroteNothing,
  assertTheTurnWaitedOnTheHolder,
  assertTheUndoWaitedOnTheHolder,
  raceTheChatWrite,
  runTheChatTurn,
  type ChatLockCtx,
} from "./onboarding-chat-lock.integration.spec";
import { attachCommitProposal, draftHash } from "./onboarding-commit-proposal";
import { EMPTY_TEMPLATE_CONTEXT } from "./onboarding-template-refs";
import { OnboardingValidateService } from "./onboarding-validate.service";
import { OnboardingService } from "./onboarding.service";

/**
 * `F4.227` — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the database lifecycle. Every race runs once in
 * `beforeAll`, one after the other, each on its own session row; every row is
 * committed, so `afterAll` deletes them by id. `F4.231` adds races 3 to 8 and
 * case 9 (the empty-ring `undo` and the typed confirm).
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
const HOLDER_MESSAGE_ID = randomUUID();

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

    const seedSession = async (suffix: string, draft: object = seededDraft(suffix)): Promise<string> => {
      const id = await withTenant(tenantDb, organizationId, async (tx) => {
        const [row] = await tx
          .insert(onboardingSessions)
          .values({ organizationId, status: "draft", currentPhase: "rtu", draft, messages: [] })
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
    // F4.231: the typed confirm's commit service. In a race it must not touch
    // the row (the holder holds it); in case 9 it marks the row committed, as
    // `commitWith`'s own transaction does, before the confirm writes.
    const commitStub = {
      mode: "touch-nothing" as "touch-nothing" | "mark-committed",
      commitProposed: async (_jwt: unknown, sessionId: string) => {
        if (commitStub.mode === "mark-committed") {
          await withTenant(tenantDb, organizationId, (tx) =>
            tx
              .update(onboardingSessions)
              .set({ status: "committed", committedAt: sql`now()`, checkpoints: null })
              .where(eq(onboardingSessions.id, sessionId)),
          );
        }
        return {
          sessionId,
          locationId: "x",
          rtuIds: [],
          assetIds: [],
          pointKeyIds: [],
          assetPointIds: [],
          templateIds: [],
          templatedAssetCount: 0,
          templatedAssetPointCount: 0,
          seededRuleCount: 0,
          dashboardCount: 0,
        };
      },
    };
    const service = new OnboardingService(
      fleetDb,
      tenantDb,
      new AccessControlService(authDb, fleetDb),
      chat,
      new OnboardingValidateService(),
      commitStub as never,
      {} as never,
      {} as never,
      vocabularies as never,
      { context: async () => EMPTY_TEMPLATE_CONTEXT } as never,
    );

    Object.assign(ctx, {
      holderPool,
      service,
      jwt,
      holderName: HOLDER_NAME,
      seededName: SEEDED_NAME,
      holderMessageId: HOLDER_MESSAGE_ID,
    });

    // The two things a holder commits under its lock: a draft change, and a
    // message that leaves the draft (and so the hash) as it was.
    const changeTheName = (id: string) => async (holder: pg.PoolClient) => {
      const res = await holder.query(
        `UPDATE bms.onboarding_sessions
            SET draft = jsonb_set(draft, '{location,name}', to_jsonb($2::text))
          WHERE id = $1`,
        [id, HOLDER_NAME],
      );
      return res.rowCount;
    };
    const appendAMessage = (id: string) => async (holder: pg.PoolClient) => {
      const message = { id: HOLDER_MESSAGE_ID, role: "assistant", content: "kept", createdAt: new Date().toISOString() };
      const res = await holder.query("UPDATE bms.onboarding_sessions SET messages = messages || $2::jsonb WHERE id = $1", [
        id,
        JSON.stringify([message]),
      ]);
      return res.rowCount;
    };
    const withProposal = (suffix: string, hash: string) =>
      attachCommitProposal(seededDraft(suffix), { draftHash: hash, summary: "proposed", proposedAt: new Date().toISOString() });
    const staleHash = "0".repeat(64);

    const changedId = await seedSession("CHG");
    ctx.changed = await raceTheChatWrite(ctx, changedId, "race 1 (draft changed)", changeTheName(changedId));

    const unchangedId = await seedSession("UNC");
    ctx.unchanged = await raceTheChatWrite(ctx, unchangedId, "race 2 (no change)", null);

    const undoKeptId = await seedSession("UNDO");
    ctx.undoKept = await raceTheChatWrite(
      ctx,
      undoKeptId,
      "race 3 (empty-ring undo, message committed under the lock)",
      appendAMessage(undoKeptId),
      UNDO_TURN,
    );

    const undoChangedId = await seedSession("UNDC");
    ctx.undoChanged = await raceTheChatWrite(
      ctx,
      undoChangedId,
      "race 4 (empty-ring undo, draft changed)",
      changeTheName(undoChangedId),
      UNDO_TURN,
    );

    const noProposalId = await seedSession("CNP");
    ctx.confirmNoProposal = await raceTheChatWrite(
      ctx,
      noProposalId,
      "race 5 (confirm, no proposal, message committed under the lock)",
      appendAMessage(noProposalId),
      CONFIRM_TURN,
    );

    const staleChangedId = await seedSession("CSC", withProposal("CSC", staleHash));
    ctx.confirmStaleChanged = await raceTheChatWrite(
      ctx,
      staleChangedId,
      "race 6 (confirm, stale proposal, draft changed)",
      changeTheName(staleChangedId),
      CONFIRM_TURN,
    );

    const staleKeptId = await seedSession("CSK", withProposal("CSK", staleHash));
    ctx.confirmStaleKept = await raceTheChatWrite(
      ctx,
      staleKeptId,
      "race 7 (confirm, stale proposal, message committed under the lock)",
      appendAMessage(staleKeptId),
      CONFIRM_TURN,
    );

    const commitKeptId = await seedSession("CCK", withProposal("CCK", draftHash(seededDraft("CCK"))!));
    commitStub.mode = "touch-nothing";
    ctx.confirmCommitKept = await raceTheChatWrite(
      ctx,
      commitKeptId,
      "race 8 (committing confirm, message committed under the lock)",
      appendAMessage(commitKeptId),
      CONFIRM_TURN,
    );

    const committedId = await seedSession("CCM", withProposal("CCM", draftHash(seededDraft("CCM"))!));
    commitStub.mode = "mark-committed";
    try {
      ctx.confirmCommitted = await runTheChatTurn(ctx, committedId, CONFIRM_TURN);
    } finally {
      commitStub.mode = "touch-nothing";
    }
  }, 150_000);

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

  it("race 3 control — the empty-ring undo blocked on the holder's FOR UPDATE until it committed", () => {
    assertTheUndoWaitedOnTheHolder(ctx);
  });

  it("race 3 — a message committed under the lock survives the empty-ring undo", () => {
    assertAMessageCommittedUnderTheLockSurvivesTheUndo(ctx);
  });

  it("race 4 control — the empty-ring undo blocked on a holder that changed the draft", () => {
    assertTheChangedUndoWaitedOnTheHolder(ctx);
  });

  it("race 4 — an empty-ring undo over a draft changed under the lock answers 409 and writes nothing", () => {
    assertAnUndoOverAChangedDraftAnswers409(ctx);
  });

  it("race 5 — a confirm with no proposal keeps a message committed under the lock", () => {
    assertAConfirmWithNoProposalKeepsAMessageCommittedUnderTheLock(ctx);
  });

  it("race 6 — a stale confirm over a draft changed under the lock answers 409; the newer draft and its proposal stand", () => {
    assertAStaleConfirmOverAChangedDraftAnswers409(ctx);
  });

  it("race 7 — a stale confirm keeps a message committed under the lock and clears the proposal", () => {
    assertAStaleConfirmKeepsAMessageCommittedUnderTheLock(ctx);
  });

  it("race 8 — a committing confirm keeps a message committed under the lock", () => {
    assertACommittingConfirmKeepsAMessageCommittedUnderTheLock(ctx);
  });

  it("case 9 — a committing confirm appends its messages to the row its own commit marked committed", () => {
    assertACommittingConfirmAppendsToTheCommittedRow(ctx);
  });
});
