/**
 * Administrator copilot contracts (`F3.85`, ADR 0099 decision 5) — who may use
 * the copilot, and the settings an administrator reads and writes to decide it.
 *
 * Every schema here is a flat `z.object(...).strict()`, with no
 * `z.intersection` and no `.readonly()`, so the AGENTS.md §4.8 encoding rules
 * do not apply to them. `.strict()` on the responses: a field the server did
 * not mean to send fails the parse rather than being stripped silently.
 */
import { z } from "zod";

import { onboardingChatResponseDtoSchema, onboardingSessionDtoSchema } from "./onboarding";

/**
 * Why the copilot is not available to this user here (ADR 0099 decision 5;
 * the `F3.85` plan §5.2 and its Q2 ruling).
 *
 * - `not_provisioned`: the token matches no `bms.users` row.
 * - `role`: the user's role is not one of the four administrator roles.
 * - `other_organization`: a non-global administrator asked about an
 *   organization that is not their own (decision 10).
 * - `organization_off`: the organization switch is off, or has no row
 *   (ruling 15). It binds the global admin too (drafter choice 7).
 * - `role_off`: the switch for the user's scoped role is off.
 * - `user_denied`: a named-user exception denies this user.
 */
export const copilotAvailabilityReasonSchema = z.enum([
  "not_provisioned",
  "role",
  "other_organization",
  "organization_off",
  "role_off",
  "user_denied",
]);

/** The two roles that carry a role switch; `organization_admin`'s switch is the organization's. */
export const copilotSwitchableRoleSchema = z.enum(["location_admin", "asset_group_admin"]);

/**
 * `GET /api/v1/copilot/status`. `configured`: a key resolves for the scope asked about (`F3.85` PR 7, decision 10).
 * `attachmentsEnabled` (`F3.87`, ADR 0099 Amendment 3 A7): true only when the copilot is available and
 * configured for **one** organization whose copilot and attachment switches are both on; always false for a
 * cross-organization scope. The server always sends it; it is optional in the schema only so the many web
 * spec stubs of this DTO stay valid, and a reader takes an absent value as false (fail closed).
 */
export const copilotStatusDtoSchema = z
  .object({
    available: z.boolean(),
    reason: copilotAvailabilityReasonSchema.optional(),
    configured: z.boolean(),
    attachmentsEnabled: z.boolean().optional(),
  })
  .strict();

/** One named-user exception: `allow` re-enables or denies, whatever the role switch says. */
export const copilotUserOverrideDtoSchema = z
  .object({
    userId: z.string(),
    allow: z.boolean(),
  })
  .strict();

/**
 * `GET`/`PUT /api/v1/admin/organizations/:orgId/copilot-access`. `enabled` is
 * the organization switch (`false` when there is no row); each role switch is
 * `true` when it has no row (plan Q2). `attachmentsEnabled` is the attachment switch (`F3.87`, ADR 0099
 * Amendment 3 A7), `false` when there is no row; it counts only while `enabled` is true.
 */
export const copilotAccessDtoSchema = z
  .object({
    organizationId: z.string(),
    enabled: z.boolean(),
    attachmentsEnabled: z.boolean(),
    roles: z
      .object({
        location_admin: z.boolean(),
        asset_group_admin: z.boolean(),
      })
      .strict(),
    overrides: z.array(copilotUserOverrideDtoSchema),
  })
  .strict();

/**
 * How much a proposed change can do (`F3.85` PR 4, ADR 0099 decision 4): the
 * Confirm card shows it, and the `copilot_pending_changes_risk_check` CHECK
 * holds the same four.
 */
export const copilotChangeRiskSchema = z.enum(["create", "edit", "deactivate", "access"]);

/**
 * A change the model proposed, waiting for the user's Confirm (decision 4.5).
 * The browser sends `method path` with `body` and the `X-Copilot-Change: id`
 * header; the server applies it only if the method, the path and the body's
 * canonical hash match what it stored. `body` is `{}` for a catalog entry
 * that takes no body (plan §6.4).
 */
export const copilotPendingChangeDtoSchema = z
  .object({
    id: z.string(),
    catalogId: z.string(),
    method: z.enum(["POST", "PUT", "PATCH", "DELETE"]),
    // Always an API path on the same origin: the executor joins it to the API base.
    path: z.string().regex(/^\/api\/v1\//),
    body: z.record(z.string(), z.unknown()),
    summary: z.string(),
    risk: copilotChangeRiskSchema,
    proposedAt: z.string(),
    expiresAt: z.string(),
    // F4.247 / ADR 0099 Amendment 5: the target's `updatedAt` read at propose time, which the
    // browser sends as `If-Match` on Confirm; null for an entry with no precondition.
    ifMatch: z.string().nullable(),
  })
  .strict();

/** The two ends of a conversation turn, and the audit line for a confirmed change (migration 0105 CHECK). */
export const copilotMessageRoleSchema = z.enum(["user", "assistant", "action"]);

/**
 * One saved conversation (`F3.85` PR 5, ADR 0099 decision 8). `organizationId`
 * is the organization the conversation is bound to, `null` for a global
 * administrator's cross-organization conversation.
 */
export const copilotConversationDtoSchema = z
  .object({
    id: z.string(),
    organizationId: z.string().nullable(),
    title: z.string().nullable(),
    createdAt: z.string(),
    lastTurnAt: z.string(),
  })
  .strict();

/** One saved message; `organizationIds` names the organizations whose data the turn read (decision 8). */
export const copilotMessageDtoSchema = z
  .object({
    id: z.string(),
    conversationId: z.string(),
    role: copilotMessageRoleSchema,
    content: z.string(),
    organizationIds: z.array(z.string()),
    createdAt: z.string(),
  })
  .strict();

/**
 * `F3.86` PR 5 / ADR 0099 decision 7 — the onboarding skill's state, as the
 * dock renders it: the bound draft session and the members of the onboarding
 * chat answer the page renders today (chips, validation, preview). The
 * members are the onboarding contract's own, so the dock and the page read one
 * shape. A plain object: `skill` is `null` on a conversation with no skill.
 */
export const copilotSkillStateDtoSchema = z
  .object({
    kind: z.literal("onboarding"),
    sessionId: z.string(),
    session: onboardingSessionDtoSchema,
    suggestedReplies: onboardingChatResponseDtoSchema.shape.suggestedReplies,
    validationErrors: onboardingChatResponseDtoSchema.shape.validationErrors,
    readyToCommit: onboardingChatResponseDtoSchema.shape.readyToCommit,
    autoOpenPreview: onboardingChatResponseDtoSchema.shape.autoOpenPreview,
    autoOpenReason: onboardingChatResponseDtoSchema.shape.autoOpenReason,
  })
  .strict();

/**
 * `F4.244` — the follow-up turn the dock still waits for (ADR 0099 decision
 * 4.7): the conversation's newest finished change that its Confirm request
 * recorded (never one the stuck-claim sweeper resolved), within the server's
 * stuck window, whose own outcome line is not stored yet. `ageMs` is the
 * server's `now() - finished_at`: an age, not a timestamp, so the dock never
 * compares the database clock with the browser clock (owner ruling 2026-10-20).
 */
export const copilotAwaitingFollowUpDtoSchema = z
  .object({
    changeId: z.string(),
    status: z.enum(["applied", "failed"]),
    ageMs: z.number().int().nonnegative(),
  })
  .strict();

/** `GET /api/v1/copilot/conversations/:id` — the conversation and its messages, oldest first. */
export const copilotConversationDetailDtoSchema = z
  .object({
    id: z.string(),
    organizationId: z.string().nullable(),
    title: z.string().nullable(),
    createdAt: z.string(),
    lastTurnAt: z.string(),
    messages: z.array(copilotMessageDtoSchema),
    /** `F3.85` PR 8: the conversation's changes still waiting for a Confirm (pending and unexpired), oldest first. */
    pendingChanges: z.array(copilotPendingChangeDtoSchema),
    /** `F3.86` PR 5: the skill the conversation runs, or `null` (absent before PR 5). */
    skill: copilotSkillStateDtoSchema.nullable().optional(),
    /**
     * `F4.244`: the follow-up the dock waits for, or `null`. The server always sends the key
     * (`copilot-conversations.controller.spec.ts` pins it); it is optional here only so the many
     * web spec stubs of this DTO stay valid.
     */
    awaitingFollowUp: copilotAwaitingFollowUpDtoSchema.nullable().optional(),
  })
  .strict();

/**
 * `POST /api/v1/copilot/conversations/:id/skills/onboarding` (`F3.86` PR 5).
 * The organization must be the one the conversation is bound to: the route
 * refuses a cross-organization conversation and any other organization. With
 * `sessionId`, the route resumes that draft instead of creating one (`F4.255`,
 * ADR 0099 Amendment 2 A1).
 */
export const copilotStartOnboardingSkillBodySchema = z
  .object({
    organizationId: z.string().uuid(),
    sessionId: z.string().uuid().optional(),
  })
  .strict();

/**
 * `POST /api/v1/copilot/conversations`. A scoped administrator's conversation
 * is bound to the home organization whatever this says (plan Q9); the global
 * administrator may pass `null` or any existing organization.
 */
export const copilotCreateConversationBodySchema = z
  .object({
    organizationId: z.string().uuid().nullable(),
  })
  .strict();

/** The most characters one copilot turn's message may hold (`F3.85` plan §9.1). */
export const COPILOT_TURN_MESSAGE_MAX = 8_000;

/**
 * `F3.87` PR 7 (ADR 0099 Amendment 3 A4): the most files one copilot turn may
 * carry, and the most bytes an image or PDF may hold. An `.svg` is bounded by
 * `MAX_MIMIC_SYMBOL_SVG_BYTES` instead — it is a symbol candidate.
 *
 * Owner ruling 2026-10-16 (`F3.87` PR 8): the files of one turn may hold at
 * most 10 MB **together**, so a turn always fits the proxies' body limit
 * (`client_max_body_size 10m` = 10 MiB in `deploy/aws/nginx.conf`) with room
 * for the message and the multipart framing. 10 MB is decimal, 10,000,000
 * bytes; one file can be that whole budget.
 */
export const COPILOT_ATTACHMENTS_MAX = 3;
export const MAX_COPILOT_ATTACHMENT_BYTES: number = 10_000_000;
export const MAX_COPILOT_ATTACHMENTS_TOTAL_BYTES: number = 10_000_000;

/** `F4.245` (ADR 0099 Amendment 4): the most open wizards one turn may name. */
export const COPILOT_OPEN_WIZARDS_MAX = 8;

/**
 * `F4.245` (ADR 0099 Amendment 4): one wizard open on the user's screen — its
 * catalog entry and **every** path parameter of that entry's route (`{}` for
 * a create). The API checks each value with the entry's own `params` schema.
 */
export const copilotOpenWizardSchema = z
  .object({
    catalogId: z.string().min(1).max(64),
    params: z.record(z.string().min(1).max(64), z.string().min(1).max(256)),
  })
  .strict();

/**
 * `POST /api/v1/copilot/conversations/:id/turns` (`F3.85` PR 7, ADR 0099
 * decisions 1, 9, 10). The message, and since `F4.245` (Amendment 4) the
 * wizards open on the user's screen (`[]` when none). The organization a turn
 * reads and is counted against is still the conversation's own, read on the
 * server (decision 10), so a body naming one is a 400, never a hint: the
 * wizards only say which open form a `fill_step` may land in, and are never
 * an authorization input.
 */
export const copilotTurnBodySchema = z
  .object({
    message: z.string().min(1).max(COPILOT_TURN_MESSAGE_MAX),
    wizards: z.array(copilotOpenWizardSchema).max(COPILOT_OPEN_WIZARDS_MAX),
  })
  .strict();

/**
 * `F3.85` PR 8 (plan §10.2): the `fill_step` tool's output — values for one
 * step of the wizard for `catalogId`, checked against that step's fields.
 * The dock hands them to an open wizard; nothing is stored or sent.
 *
 * `F4.245` (ADR 0099 Amendment 4): `params` names the record — the path
 * parameters of the wizard the fill is for. The model names them and the
 * server accepts the fill only when they equal an open wizard's; the browser
 * applies it only to the wizard with the same catalog id and parameters.
 */
export const copilotFillStepDtoSchema = z
  .object({
    catalogId: z.string(),
    params: z.record(z.string(), z.string()),
    stepId: z.string(),
    values: z.record(z.string(), z.unknown()),
  })
  .strict();

/**
 * How a turn ended.
 *
 * - `answered`: the model answered; `messages` holds what was stored.
 * - `credential_refused`: the message looked like it held a credential (ADR
 *   0022); nothing was stored, sent or counted.
 * - `not_configured`: no key resolved for the conversation's scope (decision
 *   10); nothing was stored, sent or counted.
 * - `failed`: the model call failed or a cap stopped it; the turn was counted
 *   and nothing was stored.
 */
export const copilotTurnOutcomeSchema = z.enum(["answered", "credential_refused", "not_configured", "failed"]);

/**
 * The answer to one turn. `reply` is the text the dock shows; `messages` are
 * the rows this turn stored, oldest first — empty unless `outcome` is
 * `answered`, so "the transcript did not grow" is the refusal signal the
 * onboarding chat uses. `configured` is `false` only on `not_configured`.
 * `navigateTo` is an app route an `open_page` tool returned, or `null`.
 */
export const copilotTurnResponseDtoSchema = z
  .object({
    conversationId: z.string(),
    outcome: copilotTurnOutcomeSchema,
    configured: z.boolean(),
    reply: z.string(),
    messages: z.array(copilotMessageDtoSchema),
    navigateTo: z.string().nullable(),
    /** `F3.85` PR 8: the changes this turn proposed, each waiting for the user's Confirm or Reject. */
    pendingChanges: z.array(copilotPendingChangeDtoSchema),
    /** `F3.85` PR 8: values a `fill_step` tool gave an open wizard step, or `null`. It writes nothing. */
    fillStep: copilotFillStepDtoSchema.nullable(),
    /** `F3.86` PR 5: a skill turn's state (decision 7), or `null`; absent on a plain turn. */
    skill: copilotSkillStateDtoSchema.nullable().optional(),
  })
  .strict();

/**
 * `POST /api/v1/copilot/changes/:id/reject` (`F3.85` PR 8, decision 4): the
 * change is `rejected`; `messages` holds the action line stored in its
 * conversation (empty when the change has none).
 */
export const copilotRejectResponseDtoSchema = z
  .object({
    id: z.string(),
    status: z.literal("rejected"),
    messages: z.array(copilotMessageDtoSchema),
  })
  .strict();
