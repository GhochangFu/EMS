import {
  adminUsersListResponseSchema,
  userGrantsResponseSchema,
  userWriteResponseSchema,
} from "@bms/shared/contracts";
import type {
  AdminUsersListResponse,
  UpdateUserBody,
  UserGrantKind,
  UserGrantsResponse,
  UserRole,
  UserWriteResponse,
} from "@bms/shared";

import { adminFetch } from "./client";

/**
 * `F3.78` (ADR 0089) — the users and grants admin surface. One function per
 * route; every response is parsed with its shared Zod schema by `adminFetch`.
 *
 * A write that fails after Keycloak changed something answers either a 200
 * with `followUp` or an error body carrying `followUp`; the page reads both
 * (`users-page.tsx`). The temporary password travels only in the request body
 * and is never part of a query key or a logged value.
 */
export const adminUsersQueryKey = ["admin", "users"] as const;
export const adminUserGrantsQueryKey = (userId: string) =>
  ["admin", "users", userId, "grants"] as const;

const json = { "Content-Type": "application/json" };

/** The create body as the form holds it; the API trims and lower-cases the email. */
export type CreateAdminUserInput = {
  email: string;
  displayName: string;
  role: UserRole;
  organizationId: string | null;
  temporaryPassword: string;
};

/** GET /api/v1/admin/users */
export async function fetchAdminUsers(): Promise<AdminUsersListResponse> {
  return adminFetch("/admin/users", adminUsersListResponseSchema);
}

/** POST /api/v1/admin/users */
export async function createAdminUser(input: CreateAdminUserInput): Promise<UserWriteResponse> {
  return adminFetch("/admin/users", userWriteResponseSchema, {
    method: "POST",
    headers: json,
    body: JSON.stringify(input),
  });
}

/** PATCH /api/v1/admin/users/:id */
export async function updateAdminUser(id: string, body: UpdateUserBody): Promise<UserWriteResponse> {
  return adminFetch(`/admin/users/${id}`, userWriteResponseSchema, {
    method: "PATCH",
    headers: json,
    body: JSON.stringify(body),
  });
}

/** POST /api/v1/admin/users/:id/deactivate */
export async function deactivateAdminUser(id: string): Promise<UserWriteResponse> {
  return adminFetch(`/admin/users/${id}/deactivate`, userWriteResponseSchema, { method: "POST" });
}

/** POST /api/v1/admin/users/:id/reactivate */
export async function reactivateAdminUser(id: string): Promise<UserWriteResponse> {
  return adminFetch(`/admin/users/${id}/reactivate`, userWriteResponseSchema, { method: "POST" });
}

/** POST /api/v1/admin/users/:id/temporary-password */
export async function setAdminUserTemporaryPassword(
  id: string,
  temporaryPassword: string,
): Promise<UserWriteResponse> {
  return adminFetch(`/admin/users/${id}/temporary-password`, userWriteResponseSchema, {
    method: "POST",
    headers: json,
    body: JSON.stringify({ temporaryPassword }),
  });
}

/** GET /api/v1/admin/users/:id/grants */
export async function fetchAdminUserGrants(id: string): Promise<UserGrantsResponse> {
  return adminFetch(`/admin/users/${id}/grants`, userGrantsResponseSchema);
}

/** POST /api/v1/admin/users/:id/grants */
export async function addAdminUserGrant(
  id: string,
  grant: { kind: UserGrantKind; targetId: string },
): Promise<UserGrantsResponse> {
  return adminFetch(`/admin/users/${id}/grants`, userGrantsResponseSchema, {
    method: "POST",
    headers: json,
    body: JSON.stringify(grant),
  });
}

/** DELETE /api/v1/admin/users/:id/grants/:kind/:grantId */
export async function removeAdminUserGrant(
  id: string,
  kind: UserGrantKind,
  grantId: string,
): Promise<UserGrantsResponse> {
  return adminFetch(`/admin/users/${id}/grants/${kind}/${grantId}`, userGrantsResponseSchema, {
    method: "DELETE",
  });
}
