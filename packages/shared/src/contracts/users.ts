/**
 * `F3.78` / ADR 0089 decisions 1–3 — the users API (`/api/v1/admin/users`)
 * request and response contracts.
 *
 * All plain `z.object`s: nothing here is an intersection or an all-readonly
 * object, so there is no `.merge()`, no `z.intersection` and no `.readonly()`
 * (ADR 0030). The email is trimmed and lower-cased by the schema itself, so
 * every write sees the Keycloak username form (decision 1).
 */
import { z } from "zod";

import { userRoleSchema } from "./auth";

/** One `bms.users` row as the admin screen reads it. Never `password_hash`. */
export const adminUserDtoSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  displayName: z.string(),
  role: userRoleSchema,
  /** `null` exactly when `role` is `admin` (ADR 0043 Amendment 4, the `0098` CHECK). */
  organizationId: z.string().uuid().nullable(),
  /** Whether the row is joined to a Keycloak account (`oidc_subject IS NOT NULL`). */
  linked: z.boolean(),
  disabledAt: z.string().nullable(),
  lastLoginAt: z.string().nullable(),
  createdAt: z.string(),
});

export const adminUsersListResponseSchema = z.object({
  items: z.array(adminUserDtoSchema),
});

/** A temporary password Keycloak makes the user change at the next sign-in (decision 6). */
const temporaryPasswordSchema = z.string().min(12).max(128);

/**
 * `POST /admin/users`. The admin/organization rule is checked here, so a body
 * that breaks it is a 400 before any Keycloak call. **`.strict()`** (`F4.189`),
 * on the object before the `superRefine`: an unknown key is a caller error and
 * is refused before any Keycloak call, not dropped and answered 200 — a key
 * this route does not take (a grant list, say) would otherwise be silently
 * ignored while the account is created.
 */
const createUserBodyObject = z
  .object({
    email: z
      .string()
      .trim()
      .email()
      .max(255)
      .transform((email) => email.toLowerCase()),
    displayName: z.string().trim().min(1).max(255),
    role: userRoleSchema,
    organizationId: z.string().uuid().nullable(),
    temporaryPassword: temporaryPasswordSchema,
  })
  .strict();

/** The admin/organization boundary of a create (the `users_role_organization_check` CHECK). */
function userOrganizationBoundary(body: { role: string; organizationId: string | null }, ctx: z.RefinementCtx): void {
  if ((body.role === "admin") !== (body.organizationId === null)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["organizationId"],
      message: "an admin has organizationId null and every other role names an organization",
    });
  }
}

/** `F3.86` PR 4 / ADR 0099 decision 3: the copilot never proposes the global `admin` role. */
export const COPILOT_NEVER_GLOBAL_ADMIN_MESSAGE =
  "the copilot never proposes the global admin role — the Users page keeps it (ADR 0099 decision 3)";

function neverGlobalAdmin(body: { role?: string }, ctx: z.RefinementCtx): void {
  if (body.role === "admin") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["role"], message: COPILOT_NEVER_GLOBAL_ADMIN_MESSAGE });
  }
}

export const createUserBodySchema = createUserBodyObject
  .superRefine(userOrganizationBoundary)
  .describe(
    "role admin requires organizationId null, and every other role requires an organization " +
      "(ADR 0089 decision 2, the users_role_organization_check CHECK).",
  );

/**
 * `PATCH /admin/users/:id`. The email is not editable (it is the Keycloak
 * username). `organizationId` is accepted only with `role`; the rules that
 * need the target's current role (it must cross the `admin` boundary, and a
 * demotion from `admin` must name an organization) are the service's.
 */
const updateUserBodyObject = z
  .object({
    displayName: z.string().trim().min(1).max(255).optional(),
    role: userRoleSchema.optional(),
    organizationId: z.string().uuid().nullable().optional(),
  })
  .strict();

/** The update's own rules: something changes, and the admin boundary holds. */
function updateUserRules(
  body: { displayName?: string; role?: string; organizationId?: string | null },
  ctx: z.RefinementCtx,
): void {
  if (body.displayName === undefined && body.role === undefined && body.organizationId === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "the body changes nothing" });
  }
  if (body.organizationId !== undefined && body.role === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["organizationId"],
      message: "organizationId is accepted only with a role that crosses the admin boundary",
    });
  }
  if (body.role === "admin" && body.organizationId !== undefined && body.organizationId !== null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["organizationId"],
      message: "an admin has organizationId null",
    });
  }
  if (body.role !== undefined && body.role !== "admin" && body.organizationId === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["organizationId"],
      message: "every role other than admin names an organization",
    });
  }
}

export const updateUserBodySchema = updateUserBodyObject
  .superRefine(updateUserRules)
  .describe(
    "at least one field; organizationId only with role; role admin with organizationId null; " +
      "a non-admin role never with organizationId null (ADR 0089 decisions 1 and 2).",
  );

/**
 * `F3.86` PR 4 / ADR 0099 decision 3 — the body the copilot proposes a user
 * create with (the catalog entry's `modelBody`): the route's own object and
 * boundary, **without `temporaryPassword`** (a `clientOnly` field the admin
 * types on the Confirm card, never the model) and **never the global
 * `admin` role** (the Users page keeps promotion).
 */
export const copilotCreateUserBodySchema = createUserBodyObject
  .omit({ temporaryPassword: true })
  .strict()
  .superRefine(userOrganizationBoundary)
  .superRefine(neverGlobalAdmin)
  .describe(
    "the create-user body without temporaryPassword (typed on the Confirm card), never role admin " +
      "(ADR 0099 decision 3); every other role names an organization.",
  );

/** `F3.86` PR 4 — the update the copilot proposes: the route's rules, and never the global `admin` role. */
export const copilotUpdateUserBodySchema = updateUserBodyObject
  .strict()
  .superRefine(updateUserRules)
  .superRefine(neverGlobalAdmin)
  .describe("the update-user body, never role admin (ADR 0099 decision 3).");

/** `POST /admin/users/:id/temporary-password`. */
export const temporaryPasswordBodySchema = z
  .object({
    temporaryPassword: temporaryPasswordSchema,
  })
  .strict();

/**
 * Every user write answers the row and, when a Keycloak step after the
 * database commit failed, what an admin must do next: `keycloak_enable_failed`
 * (create committed, the account is still disabled — use reactivate) or
 * `keycloak_disable_failed` (the row is deactivated, the Keycloak account and
 * sessions were not) or `keycloak_logout_failed` (a temporary password was
 * set and audited, but the user's existing sessions were not ended — end
 * them in Keycloak).
 *
 * `keycloak_orphan_disabled_account` rides on an **error** body, not on a
 * 2xx: a create failed after Keycloak made the account, and the compensating
 * delete failed too, so a disabled Keycloak account with no `bms.users` row
 * remains (ADR 0089 decision 3) — an operator removes it in Keycloak. The
 * error keeps its original status.
 *
 * `keycloak_create_outcome_unknown` rides on a 502 error body too: Keycloak's
 * create timed out or answered a 5xx / unrecognised status, so it may have
 * made the account but no id came back and nothing could be undone — a
 * (disabled) Keycloak account with no `bms.users` row may remain; an operator
 * checks Keycloak for the email before retrying.
 */
export const userWriteFollowUpSchema = z.enum([
  "keycloak_enable_failed",
  "keycloak_disable_failed",
  "keycloak_logout_failed",
  "keycloak_orphan_disabled_account",
  "keycloak_create_outcome_unknown",
]);

export const userWriteResponseSchema = z.object({
  user: adminUserDtoSchema,
  followUp: userWriteFollowUpSchema.nullable(),
});
