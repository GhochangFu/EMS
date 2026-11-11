import type { QueryClient } from "@tanstack/react-query";
import {
  createServiceTokenResponseSchema,
  serviceAccountResponseSchema,
  serviceAccountsListResponseSchema,
} from "@bms/shared/contracts";
import type {
  AddServiceAccountGrantBody,
  CreateServiceAccountBody,
  CreateServiceTokenBody,
  CreateServiceTokenResponse,
  ServiceAccountResponse,
  ServiceAccountsListResponse,
  UpdateServiceAccountBody,
} from "@bms/shared";

import { adminFetch } from "./client";

/**
 * `F4.17` / ADR 0125 decision 14 — `/admin/service-accounts`. `admin` and
 * `organization_admin` only; the server refuses every other role. No query
 * ever holds a token: the create-token response is the only one that carries
 * it, and the page keeps it in one dialog's state until the dialog closes.
 */

export const serviceAccountsQueryKey = ["admin", "service-accounts"] as const;

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const path = (id: string, rest = ""): string => `/admin/service-accounts/${encodeURIComponent(id)}${rest}`;

/** `GET /admin/service-accounts` — the accounts the caller may manage, with tokens (never a secret) and grants. */
export async function fetchServiceAccounts(): Promise<ServiceAccountsListResponse> {
  return adminFetch("/admin/service-accounts", serviceAccountsListResponseSchema);
}

/** `POST /admin/service-accounts` — a `viewer` or `operator` account in one organization. */
export async function createServiceAccount(input: CreateServiceAccountBody): Promise<ServiceAccountResponse> {
  return adminFetch("/admin/service-accounts", serviceAccountResponseSchema, json("POST", input));
}

/** `PATCH /admin/service-accounts/:id` — rename, change role, disable (revokes every token) or enable. */
export async function updateServiceAccount(id: string, input: UpdateServiceAccountBody): Promise<ServiceAccountResponse> {
  return adminFetch(path(id), serviceAccountResponseSchema, json("PATCH", input));
}

/** `POST /admin/service-accounts/:id/tokens` — the one response that carries a token; never cached. */
export async function createServiceToken(id: string, input: CreateServiceTokenBody): Promise<CreateServiceTokenResponse> {
  return adminFetch(path(id, "/tokens"), createServiceTokenResponseSchema, {
    ...json("POST", input),
    cache: "no-store",
  });
}

/** `POST /admin/service-accounts/:id/tokens/:tokenId/revoke` — final. */
export async function revokeServiceToken(id: string, tokenRowId: string): Promise<ServiceAccountResponse> {
  return adminFetch(path(id, `/tokens/${encodeURIComponent(tokenRowId)}/revoke`), serviceAccountResponseSchema, {
    method: "POST",
  });
}

/** `POST /admin/service-accounts/:id/grants` — a location or asset group of the account's organization. */
export async function addServiceAccountGrant(id: string, input: AddServiceAccountGrantBody): Promise<ServiceAccountResponse> {
  return adminFetch(path(id, "/grants"), serviceAccountResponseSchema, json("POST", input));
}

/** `DELETE /admin/service-accounts/:id/grants/:kind/:grantId`. */
export async function removeServiceAccountGrant(id: string, kind: string, grantId: string): Promise<ServiceAccountResponse> {
  return adminFetch(
    path(id, `/grants/${encodeURIComponent(kind)}/${encodeURIComponent(grantId)}`),
    serviceAccountResponseSchema,
    { method: "DELETE" },
  );
}

export async function invalidateServiceAccountReads(queryClient: QueryClient): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: serviceAccountsQueryKey });
}
