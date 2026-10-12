import { sql } from "drizzle-orm";
import type pg from "pg";
import { expect } from "vitest";

import type { BmsDb } from "@bms/db";
import type { CopilotPendingChangeDto, JwtPayload } from "@bms/shared";
import { catalogEntry, proposeToolName } from "@bms/shared/copilot";

import { withTenant } from "../database/tenant-context";
import { withUser } from "../database/user-context";
import {
  CopilotPendingChangesService,
  type NewPendingChange,
  PENDING_CHANGE_TTL_MINUTES,
} from "./copilot-pending-changes.service";
import { createCopilotProposeTools, PROPOSE_TARGET_ERROR } from "./copilot-propose-tools";
import type { CopilotToolContext } from "./copilot-read-tools";
import { NO_GRANTS, NO_USERS } from "../testing/copilot-user-checks";
import { CopilotTargetResolver } from "./copilot-target-resolver";

/**
 * `F3.85` PR 4 / ADR 0099 decision 4.5 — `CopilotPendingChangesService`
 * against migration `0105` on a real database, as `bms_tenant`: the atomic
 * claim, the per-user boundary, expiry, release, record and the sweep (plan
 * Q4). Vitest entry point: the sibling `.test.ts` (ADR 0014).
 */
export type PendingCtx = {
  tenantDb: BmsDb;
  /** `bms_owner` — bound by the policy only through FORCE. */
  ownerPool: pg.Pool;
  orgA: string;
  userA: string;
  userB: string;
};

const service = (ctx: PendingCtx) => new CopilotPendingChangesService(ctx.tenantDb);

async function insertPending(
  ctx: PendingCtx,
  options: { expiresIn?: string; status?: string; claimedAgo?: string } = {},
): Promise<string> {
  const { rows } = await withUser(ctx.tenantDb, ctx.userA, (tx) =>
    tx.execute<{ id: string }>(sql`
      INSERT INTO bms.copilot_pending_changes
        (user_id, organization_id, catalog_id, method, path, body, body_hash, summary, risk, status, expires_at, claimed_at)
      VALUES (${ctx.userA}, ${ctx.orgA}, 'dashboards.create', 'POST', '/api/v1/dashboards', '{}'::jsonb,
              repeat('a', 64), 'F3.85 pending probe', 'create', ${options.status ?? "pending"},
              now() + ${options.expiresIn ?? "1 hour"}::interval,
              CASE WHEN ${options.claimedAgo ?? null}::text IS NULL THEN NULL
                   ELSE now() - ${options.claimedAgo ?? "0 seconds"}::interval END)
      RETURNING id`),
  );
  const id = rows[0]?.id;
  if (!id) throw new Error("F3.85: pending change was not created");
  return id;
}

async function statusOf(ctx: PendingCtx, id: string): Promise<Record<string, unknown> | undefined> {
  const { rows } = await withUser(ctx.tenantDb, ctx.userA, (tx) =>
    tx.execute<Record<string, unknown>>(sql`
      SELECT status, claimed_at IS NOT NULL AS claimed, finished_at IS NOT NULL AS finished, result_status, resource_id
        FROM bms.copilot_pending_changes WHERE id = ${id}`),
  );
  return rows[0];
}

/** Ten concurrent claims of one row: exactly one wins. */
export async function concurrentClaimsApplyOnce(ctx: PendingCtx): Promise<void> {
  const id = await insertPending(ctx);
  const results = await Promise.all(Array.from({ length: 10 }, () => service(ctx).claim(ctx.userA, id)));
  const winners = results.filter((r) => r !== null);
  expect(winners).toHaveLength(1);
  expect(winners[0]).toEqual({
    method: "POST",
    path: "/api/v1/dashboards",
    bodyHash: "a".repeat(64),
    organizationId: ctx.orgA,
    catalogId: "dashboards.create",
  });
  expect(await statusOf(ctx, id)).toMatchObject({ status: "applying", claimed: true });
}

/** User B can neither read nor claim A's change; A can (positive control). */
export async function anotherUserCannotPeekOrClaim(ctx: PendingCtx): Promise<void> {
  const id = await insertPending(ctx);
  expect(await service(ctx).peek(ctx.userB, id)).toBeNull();
  expect(await service(ctx).claim(ctx.userB, id)).toBeNull();
  expect(await statusOf(ctx, id)).toMatchObject({ status: "pending", claimed: false });
  expect(await service(ctx).peek(ctx.userA, id)).toEqual({ organizationId: ctx.orgA });
}

export async function anExpiredChangeCannotBePeekedOrClaimed(ctx: PendingCtx): Promise<void> {
  const id = await insertPending(ctx, { expiresIn: "-1 minute" });
  expect(await service(ctx).peek(ctx.userA, id)).toBeNull();
  expect(await service(ctx).claim(ctx.userA, id)).toBeNull();
  expect(await statusOf(ctx, id)).toMatchObject({ status: "pending" });
}

/** A released claim is pending and claimable again. */
export async function releaseReturnsAClaimToPending(ctx: PendingCtx): Promise<void> {
  const id = await insertPending(ctx);
  expect(await service(ctx).claim(ctx.userA, id)).not.toBeNull();
  await service(ctx).release(ctx.userA, id);
  expect(await statusOf(ctx, id)).toMatchObject({ status: "pending", claimed: false });
  expect(await service(ctx).claim(ctx.userA, id)).not.toBeNull();
}

/** `record` moves only an `applying` row; a pending row is left exactly as it was. */
export async function recordMovesOnlyAnApplyingRow(ctx: PendingCtx): Promise<void> {
  const untouched = await insertPending(ctx);
  await service(ctx).record(ctx.userA, untouched, "applied", 201, "x");
  expect(await statusOf(ctx, untouched)).toEqual({
    status: "pending",
    claimed: false,
    finished: false,
    result_status: null,
    resource_id: null,
  });

  const id = await insertPending(ctx);
  await service(ctx).claim(ctx.userA, id);
  await service(ctx).record(ctx.userA, id, "applied", 201, "dash-1");
  expect(await statusOf(ctx, id)).toEqual({
    status: "applied",
    claimed: true,
    finished: true,
    result_status: 201,
    resource_id: "dash-1",
  });
}

/**
 * The sweep (plan Q4): a claim older than five minutes becomes `applied` when
 * the audit log holds a row carrying its id, else `failed`; a fresh claim is
 * left alone.
 */
export async function theSweepResolvesStuckClaimsFromTheAuditLog(ctx: PendingCtx): Promise<void> {
  const audited = await insertPending(ctx, { status: "applying", claimedAgo: "10 minutes" });
  const lost = await insertPending(ctx, { status: "applying", claimedAgo: "10 minutes" });
  const fresh = await insertPending(ctx, { status: "applying", claimedAgo: "1 minute" });
  await withTenant(ctx.tenantDb, ctx.orgA, (tx) =>
    tx.execute(sql`
      INSERT INTO bms.audit_log (organization_id, action, entity_type, payload)
      VALUES (${ctx.orgA}, 'dashboard.create', 'dashboard',
              jsonb_build_object('via', 'copilot', 'changeId', ${audited}::text))`),
  );

  const resolved = await service(ctx).sweepStuck(ctx.userA);
  expect(resolved).toBeGreaterThanOrEqual(2);
  expect(await statusOf(ctx, audited)).toMatchObject({ status: "applied", finished: true });
  expect(await statusOf(ctx, lost)).toMatchObject({ status: "failed", finished: true });
  expect(await statusOf(ctx, fresh)).toMatchObject({ status: "applying", finished: false });
  // Another user's sweep touches none of A's rows.
  await withUser(ctx.tenantDb, ctx.userA, (tx) =>
    tx.execute(sql`UPDATE bms.copilot_pending_changes SET claimed_at = now() - interval '10 minutes' WHERE id = ${fresh}`),
  );
  expect(await service(ctx).sweepStuck(ctx.userB)).toBe(0);
  expect(await statusOf(ctx, fresh)).toMatchObject({ status: "applying" });
}

/**
 * The owner is bound by FORCE on the message and pending-change tables too:
 * without a user it reads none of A's committed rows, with A's id it does
 * (`bms-owner-rls.integration.spec.ts` names this spec for that half).
 */
export async function theOwnerIsBoundOnMessagesAndPendingChanges(ctx: PendingCtx): Promise<void> {
  const pending = await insertPending(ctx);
  const conversation = await withUser(ctx.tenantDb, ctx.userA, async (tx) => {
    const { rows } = await tx.execute<{ id: string }>(sql`
      INSERT INTO bms.copilot_conversations (user_id, title) VALUES (${ctx.userA}, 'F3.85 owner probe') RETURNING id`);
    const id = rows[0]?.id as string;
    await tx.execute(sql`
      INSERT INTO bms.copilot_messages (conversation_id, user_id, role, content) VALUES (${id}, ${ctx.userA}, 'user', 'probe')`);
    return id;
  });
  const count = async (setUser: boolean) => {
    const client = await ctx.ownerPool.connect();
    try {
      await client.query("BEGIN");
      if (setUser) await client.query("SELECT set_config('app.current_user', $1, true)", [ctx.userA]);
      const { rows } = await client.query<{ messages: number; pending: number }>(
        `SELECT (SELECT count(*)::int FROM bms.copilot_messages WHERE conversation_id = $1) AS messages,
                (SELECT count(*)::int FROM bms.copilot_pending_changes WHERE id = $2) AS pending`,
        [conversation, pending],
      );
      await client.query("COMMIT");
      return rows[0];
    } finally {
      client.release();
    }
  };
  expect(await count(false)).toEqual({ messages: 0, pending: 0 });
  expect(await count(true)).toEqual({ messages: 1, pending: 1 });
}

// --- F3.85 PR 8: the propose side --------------------------------------------

/** What the PR 8 cases add to the context: a second organization, a conversation of A's and the resolver fixtures. */
export type ProposeCtx = PendingCtx & {
  orgB: string;
  conversationA: string;
  templateA: string;
  templateB: string;
  locationA: string;
  locationB: string;
};

function change(ctx: ProposeCtx, conversationId = ctx.conversationA, summary = "F3.85 PR 8 probe"): NewPendingChange {
  return {
    conversationId,
    organizationId: ctx.orgA,
    catalogId: "dashboardTemplate.publish",
    method: "POST",
    path: "/api/v1/admin/dashboard-templates/x/publish",
    body: {},
    bodyHash: "b".repeat(64),
    summary,
    risk: "edit",
  };
}

/** `propose`, which must store (the conversation has nothing open). */
async function proposed(ctx: PendingCtx, change: NewPendingChange): Promise<CopilotPendingChangeDto> {
  const dto = await service(ctx).propose(ctx.userA, change);
  if (dto === null) throw new Error("F3.85: the proposal was refused as open");
  return dto;
}

/** A conversation of user A bound to organization A. */
export async function newConversation(ctx: PendingCtx): Promise<string> {
  const { rows } = await withUser(ctx.tenantDb, ctx.userA, (tx) =>
    tx.execute<{ id: string }>(sql`
      INSERT INTO bms.copilot_conversations (user_id, organization_id, title)
      VALUES (${ctx.userA}, ${ctx.orgA}, 'F3.85 PR 8') RETURNING id`),
  );
  const id = rows[0]?.id;
  if (!id) throw new Error("F3.85: conversation was not created");
  return id;
}

/**
 * `propose` stores a `pending` row that `listOpen` and `hasOpen` see for its
 * user only, expiring in fifteen minutes; `reject` moves it once, for its
 * user only, and it is then neither listed, open nor claimable.
 */
export async function aProposalIsOpenForItsUserUntilRejected(ctx: ProposeCtx): Promise<void> {
  const dto = await proposed(ctx, change(ctx));
  const minutes = (Date.parse(dto.expiresAt) - Date.parse(dto.proposedAt)) / 60_000;
  expect(minutes).toBeCloseTo(PENDING_CHANGE_TTL_MINUTES, 0);
  expect((await service(ctx).listOpen(ctx.userA, ctx.conversationA)).map((c) => c.id)).toContain(dto.id);
  expect(await service(ctx).hasOpen(ctx.userA, ctx.conversationA)).toBe(true);
  expect(await service(ctx).listOpen(ctx.userB, ctx.conversationA)).toEqual([]);
  expect(await service(ctx).hasOpen(ctx.userB, ctx.conversationA)).toBe(false);

  expect(await service(ctx).reject(ctx.userB, dto.id)).toBeNull();
  expect(await service(ctx).reject(ctx.userA, dto.id)).toEqual({
    conversationId: ctx.conversationA,
    organizationId: ctx.orgA,
    summary: "F3.85 PR 8 probe",
  });
  expect(await statusOf(ctx, dto.id)).toMatchObject({ status: "rejected", finished: true });
  expect(await service(ctx).reject(ctx.userA, dto.id)).toBeNull();
  expect((await service(ctx).listOpen(ctx.userA, ctx.conversationA)).map((c) => c.id)).not.toContain(dto.id);
  expect(await service(ctx).claim(ctx.userA, dto.id)).toBeNull();
}

/** An `applying` change keeps the conversation open but is no card; an expired one is neither. */
export async function openMeansPendingAndUnexpiredOrApplying(ctx: ProposeCtx): Promise<void> {
  const conversation = await newConversation(ctx);
  const expired = await proposed(ctx, change(ctx, conversation));
  await withUser(ctx.tenantDb, ctx.userA, (tx) =>
    tx.execute(sql`UPDATE bms.copilot_pending_changes SET expires_at = now() - interval '1 minute' WHERE id = ${expired.id}`),
  );
  expect(await service(ctx).hasOpen(ctx.userA, conversation)).toBe(false);
  expect(await service(ctx).listOpen(ctx.userA, conversation)).toEqual([]);

  const applying = await proposed(ctx, change(ctx, conversation));
  expect(await service(ctx).claim(ctx.userA, applying.id)).not.toBeNull();
  expect(await service(ctx).hasOpen(ctx.userA, conversation)).toBe(true);
  expect(await service(ctx).listOpen(ctx.userA, conversation)).toEqual([]);
}

/** `finished` reads only an applied or failed change, with what the follow-up needs, for its user. */
export async function finishedReadsOnlyAFinishedChange(ctx: ProposeCtx): Promise<void> {
  const conversation = await newConversation(ctx);
  const dto = await proposed(ctx, change(ctx, conversation, "finished probe"));
  expect(await service(ctx).finished(ctx.userA, dto.id)).toBeNull();
  await service(ctx).claim(ctx.userA, dto.id);
  expect(await service(ctx).finished(ctx.userA, dto.id)).toBeNull();
  await service(ctx).record(ctx.userA, dto.id, "applied", 200, "tpl-1");
  expect(await service(ctx).finished(ctx.userB, dto.id)).toBeNull();
  expect(await service(ctx).finished(ctx.userA, dto.id)).toEqual({
    conversationId: conversation,
    organizationId: ctx.orgA,
    catalogId: "dashboardTemplate.publish",
    status: "applied",
    resultStatus: 200,
    resourceId: "tpl-1",
    summary: "finished probe",
  });
}

/**
 * The one-card rule holds under concurrency (review L5): five proposals at
 * once in one conversation store one row; the others answer `null`. A second
 * conversation is not blocked by the first.
 */
export async function concurrentProposalsStoreOne(ctx: ProposeCtx): Promise<void> {
  const conversation = await newConversation(ctx);
  const results = await Promise.all(Array.from({ length: 5 }, () => service(ctx).propose(ctx.userA, change(ctx, conversation))));
  expect(results.filter((r) => r !== null)).toHaveLength(1);
  const { rows } = await withUser(ctx.tenantDb, ctx.userA, (tx) =>
    tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM bms.copilot_pending_changes WHERE conversation_id = ${conversation}`),
  );
  expect(rows[0]?.n).toBe(1);
  expect(await service(ctx).propose(ctx.userA, change(ctx, await newConversation(ctx)))).not.toBeNull();
}

/** `discard` rejects the turn's pending rows and leaves an applying one alone. */
export async function discardRejectsOnlyPendingRows(ctx: ProposeCtx): Promise<void> {
  const pending = await proposed(ctx, change(ctx, await newConversation(ctx)));
  const applying = await proposed(ctx, change(ctx, await newConversation(ctx)));
  await service(ctx).claim(ctx.userA, applying.id);
  await service(ctx).discard(ctx.userA, [pending.id, applying.id]);
  expect(await statusOf(ctx, pending.id)).toMatchObject({ status: "rejected" });
  expect(await statusOf(ctx, applying.id)).toMatchObject({ status: "applying" });
}

const always = (answer: boolean) =>
  ({
    canManageDashboard: async () => answer,
    canManageTemplate: async () => answer,
    canManageAsset: async () => answer,
    canManageLocation: async () => answer,
    canManageOrganization: async () => answer,
  }) as never;

const entry = (id: string) => {
  const found = catalogEntry(id);
  if (!found) throw new Error(id);
  return found;
};

/**
 * Decision 10 on a real database: a row is found only in an allowed
 * organization, under its tenant policy; a missing row, a row elsewhere and a
 * row the caller may not manage are the same `null`.
 */
export async function theResolverReadsATargetOnlyInTheAllowedSet(ctx: ProposeCtx): Promise<void> {
  const resolver = new CopilotTargetResolver(ctx.tenantDb, always(true), NO_USERS, NO_GRANTS);
  const archive = entry("dashboardTemplate.archive");
  const jwt = { sub: ctx.userA } as JwtPayload;
  const inA = await resolver.resolve(archive, { id: ctx.templateA }, {}, [ctx.orgA], jwt);
  expect(inA).toMatchObject({ organizationId: ctx.orgA, targetName: "F385 template A", organizationName: "F3.85 pending changes" });
  expect(await resolver.resolve(archive, { id: ctx.templateB }, {}, [ctx.orgA], jwt)).toBeNull();
  expect(await resolver.resolve(archive, { id: ctx.templateB }, {}, [ctx.orgA, ctx.orgB], jwt)).toMatchObject({
    organizationId: ctx.orgB,
    targetName: "F385 template B",
  });
  const missing = "99999999-9999-4999-8999-999999999999";
  expect(await resolver.resolve(archive, { id: missing }, {}, [ctx.orgA, ctx.orgB], jwt)).toBeNull();
  const denied = new CopilotTargetResolver(ctx.tenantDb, always(false), NO_USERS, NO_GRANTS);
  expect(await denied.resolve(archive, { id: ctx.templateA }, {}, [ctx.orgA], jwt)).toBeNull();
}

/** A create's organization must be allowed, and every id its body names must be a row of that organization. */
export async function theResolverChecksACreatesOrganizationAndRefs(ctx: ProposeCtx): Promise<void> {
  const resolver = new CopilotTargetResolver(ctx.tenantDb, always(true), NO_USERS, NO_GRANTS);
  const create = entry("dashboard.create");
  const jwt = { sub: ctx.userA } as JwtPayload;
  const body = (locationId: string) => ({ organizationId: ctx.orgA, slug: "x", name: "X", locationId });
  expect(await resolver.resolve(create, {}, body(ctx.locationA), [ctx.orgA], jwt)).toMatchObject({
    organizationId: ctx.orgA,
    targetName: "F3.85 pending changes",
  });
  expect(await resolver.resolve(create, {}, body(ctx.locationB), [ctx.orgA, ctx.orgB], jwt)).toBeNull();
  expect(await resolver.resolve(create, {}, { ...body(ctx.locationA), organizationId: ctx.orgB }, [ctx.orgA], jwt)).toBeNull();
  // A create in an organization outside the allowed set, with no ref to catch it (mutation M15).
  expect(await resolver.resolve(create, {}, { organizationId: ctx.orgB, slug: "x", name: "X" }, [ctx.orgA], jwt)).toBeNull();
  // A create the caller may not make is refused like a missing row (review L2).
  const denied = new CopilotTargetResolver(ctx.tenantDb, always(false), NO_USERS, NO_GRANTS);
  expect(await denied.resolve(create, {}, body(ctx.locationA), [ctx.orgA], jwt)).toBeNull();
}

/** A manage check that throws (an `asset_group_admin` on a master-data check) is the same refusal (review L1). */
export async function aThrowingManageCheckIsTheSameRefusal(ctx: ProposeCtx): Promise<void> {
  const throwing = {
    canManageDashboard: async () => {
      throw new Error("403");
    },
    canManageTemplate: async () => {
      throw new Error("403");
    },
  } as never;
  const resolver = new CopilotTargetResolver(ctx.tenantDb, throwing, NO_USERS, NO_GRANTS);
  const jwt = { sub: ctx.userA } as JwtPayload;
  expect(await resolver.resolve(entry("dashboardTemplate.archive"), { id: ctx.templateA }, {}, [ctx.orgA], jwt)).toBeNull();
  const create = { organizationId: ctx.orgA, code: "x", name: "X", section: "electrical" };
  expect(await resolver.resolve(entry("dashboardTemplate.create"), {}, create, [ctx.orgA], jwt)).toBeNull();
}

// --- F3.85 PR 11a: the assetTemplate target and the Q10 merge ----------------

/** The stored `content` of `assetTemplateA`: one section a KPI-only proposal must not delete (ruling Q10). */
export const ASSET_TEMPLATE_A_CONTENT = {
  alarms: [{ code: "HI-LOAD", pointKey: "kw", severity: "major", message: "F3.85 high load" }],
} as const;

/** What the PR 11a cases add: an asset template in each organization; A's `content` is `ASSET_TEMPLATE_A_CONTENT`. */
export type AssetTemplateCtx = ProposeCtx & { assetTemplateA: string; assetTemplateB: string };

const MISSING_ID = "99999999-9999-4999-8999-999999999999";

/** The propose tools over the real resolver (with `access` standing in for `AccessControlService`) and the real service. */
function proposeTools(ctx: AssetTemplateCtx, access: never) {
  return createCopilotProposeTools({
    targets: new CopilotTargetResolver(ctx.tenantDb, access, NO_USERS, NO_GRANTS),
    pending: service(ctx),
  });
}

/** A turn of user A in a fresh conversation (`hasOpen` runs before the target check), bound to `organizationId`. */
async function turn(ctx: AssetTemplateCtx, organizationId: string): Promise<CopilotToolContext> {
  return {
    identity: { id: ctx.userA } as never,
    user: { sub: ctx.userA } as JwtPayload,
    conversationId: await newConversation(ctx),
    conversationOrganizationId: organizationId,
    allowedOrganizationIds: [organizationId],
    turnKind: "user",
    now: new Date(),
  };
}

async function pendingBodiesOf(ctx: PendingCtx, conversationId: string): Promise<Record<string, unknown>[]> {
  const { rows } = await withUser(ctx.tenantDb, ctx.userA, (tx) =>
    tx.execute<{ body: Record<string, unknown> }>(
      sql`SELECT body FROM bms.copilot_pending_changes WHERE conversation_id = ${conversationId}`,
    ),
  );
  return rows.map((row) => row.body);
}

const UPDATE = "assetTemplate.update";
const PUBLISH = "assetTemplate.publish";

/** Case 1: an asset template of an allowed organization resolves, with that row's organization and name. */
export async function anAssetTemplateResolvesInAnAllowedOrganization(ctx: AssetTemplateCtx): Promise<void> {
  const resolver = new CopilotTargetResolver(ctx.tenantDb, always(true), NO_USERS, NO_GRANTS);
  const jwt = { sub: ctx.userA } as JwtPayload;
  expect(await resolver.resolve(entry(UPDATE), { id: ctx.assetTemplateB }, {}, [ctx.orgA, ctx.orgB], jwt)).toMatchObject({
    organizationId: ctx.orgB,
    targetName: "F385 asset template B",
    organizationName: "F3.85 pending changes B",
  });
}

/** Case 2, the resolver's own guard: the same id outside the allowed set is `null` (the propose tool's later checks would mask a resolver mutation). */
export async function theResolverDoesNotFindAnAssetTemplateOutsideTheAllowedSet(ctx: AssetTemplateCtx): Promise<void> {
  const resolver = new CopilotTargetResolver(ctx.tenantDb, always(true), NO_USERS, NO_GRANTS);
  const jwt = { sub: ctx.userA } as JwtPayload;
  expect(await resolver.resolve(entry(UPDATE), { id: ctx.assetTemplateA }, {}, [ctx.orgB], jwt)).toBeNull();
}

/** Case 2, end to end: a conversation of organization B naming A's asset template gets the single refusal and stores nothing. */
export async function anAssetTemplateOutsideTheAllowedSetIsTheSingleRefusal(ctx: AssetTemplateCtx): Promise<void> {
  const tools = proposeTools(ctx, always(true));
  const at = await turn(ctx, ctx.orgB);
  const answer = await tools.dispatch(proposeToolName(entry(UPDATE)), { id: ctx.assetTemplateA, body: { name: "X" } }, at);
  expect(answer).toEqual({ ok: false, error: PROPOSE_TARGET_ERROR });
  expect(await pendingBodiesOf(ctx, at.conversationId)).toEqual([]);
}

/** Case 3: a template id that does not exist is the same refusal text, and stores nothing. */
export async function aMissingAssetTemplateIsTheSameRefusal(ctx: AssetTemplateCtx): Promise<void> {
  const tools = proposeTools(ctx, always(true));
  const at = await turn(ctx, ctx.orgA);
  const answer = await tools.dispatch(proposeToolName(entry(UPDATE)), { id: MISSING_ID, body: { name: "X" } }, at);
  expect(answer).toEqual({ ok: false, error: PROPOSE_TARGET_ERROR });
  expect(await pendingBodiesOf(ctx, at.conversationId)).toEqual([]);
}

/**
 * Case 4: a caller for whom `canManageTemplate` is false gets the same refusal on a row of its own
 * organization. The fake stands in for `AccessControlService`, so only the manage guard can refuse.
 */
export async function anAssetTemplateTheCallerMayNotManageIsTheSameRefusal(ctx: AssetTemplateCtx): Promise<void> {
  const tools = proposeTools(ctx, always(false));
  const at = await turn(ctx, ctx.orgA);
  const answer = await tools.dispatch(proposeToolName(entry(UPDATE)), { id: ctx.assetTemplateA, body: { name: "X" } }, at);
  expect(answer).toEqual({ ok: false, error: PROPOSE_TARGET_ERROR });
  expect(await pendingBodiesOf(ctx, at.conversationId)).toEqual([]);
}

/** Case 5: the bodyless publish of an allowed draft stores `{}`. */
export async function aPublishOfAnAllowedDraftStoresAnEmptyBody(ctx: AssetTemplateCtx): Promise<void> {
  const tools = proposeTools(ctx, always(true));
  const at = await turn(ctx, ctx.orgA);
  const answer = await tools.dispatch(proposeToolName(entry(PUBLISH)), { id: ctx.assetTemplateA }, at);
  expect(answer).toMatchObject({ ok: true, organizationIds: [ctx.orgA] });
  expect(await pendingBodiesOf(ctx, at.conversationId)).toEqual([{}]);
}

/** Case 6, ruling Q10: a KPI-only proposal is stored merged over the stored content — the alarms stay, the KPIs are added. */
export async function aKpiOnlyProposalKeepsTheStoredSections(ctx: AssetTemplateCtx): Promise<void> {
  const tools = proposeTools(ctx, always(true));
  const at = await turn(ctx, ctx.orgA);
  const kpis = [{ code: "LOAD", name: "Load", pointKeys: ["kw"], expression: "{kw}", dialect: "unvalidated" }];
  const answer = await tools.dispatch(proposeToolName(entry(UPDATE)), { id: ctx.assetTemplateA, body: { content: { kpis } } }, at);
  expect(answer).toMatchObject({ ok: true });
  expect(await pendingBodiesOf(ctx, at.conversationId)).toEqual([{ content: { ...ASSET_TEMPLATE_A_CONTENT, kpis } }]);
}
