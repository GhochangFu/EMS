import { createHash, randomBytes } from "node:crypto";

import { expect } from "vitest";

import type { JwtPayload } from "@bms/shared";

import { FakeLlmProvider } from "../admin/onboarding/onboarding-agent-loop.spec";
import type { ResolvedIdentity } from "../auth/identity-resolver";
import { png } from "./copilot-attachments.spec";
import { CopilotAvailabilityService } from "./copilot-availability.service";
import { CopilotConversationsController } from "./copilot-conversations.controller";
import { CopilotConversationsService } from "./copilot-conversations.service";
import type { HistoryCtx } from "./copilot-history.rls.integration.spec";
import { CopilotPendingChangesService } from "./copilot-pending-changes.service";
import { EMPTY_COPILOT_READ_TOOLS } from "./copilot-read-tools";
import { CopilotTurnService } from "./copilot-turn.service";
import { CopilotUsageService } from "./copilot-usage.service";
import { UNUSED_COMMIT_READER, UNUSED_ONBOARDING_SKILL, UNUSED_SKILL_SERVICE } from "../testing/copilot-onboarding-fakes";

/**
 * `F3.87` PR 7 (ADR 0099 Amendment 3 A4, A7; plan §9.4, critique A5 item 4) —
 * a file turn on a real database: the file's bytes reach no table (only the
 * placeholder with its sha256 does), and the organization's attachment switch
 * is read from `bms.copilot_org_settings` — off is a 403 that counts nothing,
 * on runs the turn and counts it once. The provider is the scripted fake; the
 * key resolver is a fake (its own suite). Vitest entry point: the sibling
 * `.test.ts` (ADR 0014).
 */

function identity(id: string, role: ResolvedIdentity["role"], organizationId: string | null): ResolvedIdentity {
  return { id, email: `${id}@x.test`, displayName: id, role, organizationId, oidcSubject: null, disabledAt: null } as ResolvedIdentity;
}

/** Sets the organization's copilot switch on and its attachment switch as asked (superuser: setup only). */
export async function setSwitches(ctx: HistoryCtx, attachmentsEnabled: boolean): Promise<void> {
  await ctx.superPool.query(
    `INSERT INTO bms.copilot_org_settings (organization_id, enabled, attachments_enabled)
     VALUES ($1, true, $2)
     ON CONFLICT (organization_id) DO UPDATE SET enabled = true, attachments_enabled = $2`,
    [ctx.orgA, attachmentsEnabled],
  );
}

function controllerFor(ctx: HistoryCtx, llm: FakeLlmProvider) {
  const store = new CopilotConversationsService(ctx.tenantDb);
  const availability = new CopilotAvailabilityService(ctx.tenantDb);
  const pending = new CopilotPendingChangesService(ctx.tenantDb);
  const turns = new CopilotTurnService(
    store,
    availability,
    { resolveForOrganization: async () => ({ kind: "ready", provider: llm, source: "organization" }) } as never,
    new CopilotUsageService(ctx.tenantDb, { userDailyTurns: 150, organizationDailyTurns: 1_500 }),
    EMPTY_COPILOT_READ_TOOLS,
    EMPTY_COPILOT_READ_TOOLS,
    pending,
    UNUSED_ONBOARDING_SKILL,
    UNUSED_COMMIT_READER as never,
  );
  return { store, controller: new CopilotConversationsController(store, availability, pending, turns, UNUSED_SKILL_SERVICE) };
}

/** Today's turn count on this user's own row (a delta, never a lifetime counter). */
async function userTurnsToday(ctx: HistoryCtx, userId: string): Promise<number> {
  const { rows } = await ctx.superPool.query<{ turns: number }>(
    "SELECT coalesce(sum(turns), 0)::int AS turns FROM bms.copilot_usage WHERE user_id = $1 AND day = current_date",
    [userId],
  );
  return rows[0]?.turns ?? 0;
}

/** A PNG whose bytes hold a unique 32-byte marker. */
function markedPng(): { buffer: Buffer; marker: Buffer } {
  const marker = randomBytes(32);
  const buffer = png(256);
  marker.copy(buffer, 64);
  return { buffer, marker };
}

const caller = (ctx: HistoryCtx) => ({
  who: identity(ctx.userA, "organization_admin", ctx.orgA),
  jwt: { sub: ctx.userA, email: "a@x.test", role: "organization_admin" } as JwtPayload,
});

/**
 * (i) No byte of the file reaches a table: the marker and its base64 are in no
 * message, pending change, audit row or conversation; the user row holds the
 * placeholder with the sha256 (the positive control).
 */
export async function noAttachmentByteReachesAnyTable(ctx: HistoryCtx): Promise<void> {
  await setSwitches(ctx, true);
  const llm = new FakeLlmProvider([{ kind: "final", text: "A pump." }]);
  const { store, controller } = controllerFor(ctx, llm);
  const { who, jwt } = caller(ctx);
  const conversation = await store.create(ctx.userA, ctx.orgA);
  const { buffer, marker } = markedPng();
  const response = await controller.turn(conversation.id, { message: "what is this?" }, who, jwt, [
    { buffer, originalname: "plant.png" },
  ]);
  expect(response.outcome).toBe("answered");
  const sha = createHash("sha256").update(buffer).digest("hex");
  const hex = marker.toString("hex");
  // The marker sits at bytes 64–95; bytes 66–89 start on a 3-byte boundary, so their base64 is chars 88–119 of the whole.
  const b64 = buffer.toString("base64").slice(88, 120);
  expect(Buffer.from(b64, "base64").equals(buffer.subarray(66, 90))).toBe(true);
  const scans = [
    ["bms.copilot_messages", "SELECT count(*)::int AS n FROM bms.copilot_messages WHERE encode(convert_to(content, 'UTF8'), 'hex') LIKE $1 OR content LIKE $2"],
    ["bms.copilot_pending_changes", "SELECT count(*)::int AS n FROM bms.copilot_pending_changes WHERE encode(convert_to(body::text, 'UTF8'), 'hex') LIKE $1 OR body::text LIKE $2"],
    ["bms.audit_log", "SELECT count(*)::int AS n FROM bms.audit_log WHERE encode(convert_to(coalesce(payload::text, ''), 'UTF8'), 'hex') LIKE $1 OR coalesce(payload::text, '') LIKE $2"],
    ["bms.copilot_conversations", "SELECT count(*)::int AS n FROM bms.copilot_conversations c WHERE encode(convert_to(row_to_json(c)::text, 'UTF8'), 'hex') LIKE $1 OR row_to_json(c)::text LIKE $2"],
  ] as const;
  for (const [table, query] of scans) {
    const { rows } = await ctx.superPool.query<{ n: number }>(query, [`%${hex}%`, `%${b64}%`]);
    expect(rows[0]?.n, `${table} holds no byte of the file`).toBe(0);
  }
  const { rows } = await ctx.superPool.query<{ content: string }>(
    "SELECT content FROM bms.copilot_messages WHERE conversation_id = $1 AND role = 'user'",
    [conversation.id],
  );
  expect(rows[0]?.content).toContain(`sha256 ${sha}; not stored]`);
}

/** (ii) The switch off is a 403, and this user's counter for today does not move. */
export async function theSwitchOffIs403AndCountsNothing(ctx: HistoryCtx): Promise<void> {
  await setSwitches(ctx, false);
  const llm = new FakeLlmProvider([{ kind: "final", text: "leak" }]);
  const { store, controller } = controllerFor(ctx, llm);
  const { who, jwt } = caller(ctx);
  const conversation = await store.create(ctx.userA, ctx.orgA);
  const before = await userTurnsToday(ctx, ctx.userA);
  const error = await controller
    .turn(conversation.id, { message: "read this" }, who, jwt, [{ buffer: png(64), originalname: "a.png" }])
    .then(
      () => null,
      (err: { getStatus?: () => number }) => err,
    );
  expect(error?.getStatus?.()).toBe(403);
  expect(await userTurnsToday(ctx, ctx.userA)).toBe(before);
  expect(llm.calls).toBe(0);
}

/** (iii) The switch on runs the turn: counted once, the user row holds the placeholder. */
export async function theSwitchOnRunsAndCountsOnce(ctx: HistoryCtx): Promise<void> {
  await setSwitches(ctx, true);
  const llm = new FakeLlmProvider([{ kind: "final", text: "ok" }]);
  const { store, controller } = controllerFor(ctx, llm);
  const { who, jwt } = caller(ctx);
  const conversation = await store.create(ctx.userA, ctx.orgA);
  const before = await userTurnsToday(ctx, ctx.userA);
  const response = await controller.turn(conversation.id, { message: "read this" }, who, jwt, [
    { buffer: png(64), originalname: "a.png" },
  ]);
  expect(response.outcome).toBe("answered");
  expect(await userTurnsToday(ctx, ctx.userA)).toBe(before + 1);
  expect(response.messages.find((m) => m.role === "user")?.content).toContain('[Attachment 1 of 1: "a.png", image/png, 64 bytes');
}
