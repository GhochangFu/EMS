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

/** `GET /api/v1/copilot/status`. `configured` stays `false` until the model wiring lands. */
export const copilotStatusDtoSchema = z
  .object({
    available: z.boolean(),
    reason: copilotAvailabilityReasonSchema.optional(),
    configured: z.boolean(),
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
 * `true` when it has no row (plan Q2).
 */
export const copilotAccessDtoSchema = z
  .object({
    organizationId: z.string(),
    enabled: z.boolean(),
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

/** `GET /api/v1/copilot/conversations/:id` — the conversation and its messages, oldest first. */
export const copilotConversationDetailDtoSchema = z
  .object({
    id: z.string(),
    organizationId: z.string().nullable(),
    title: z.string().nullable(),
    createdAt: z.string(),
    lastTurnAt: z.string(),
    messages: z.array(copilotMessageDtoSchema),
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
