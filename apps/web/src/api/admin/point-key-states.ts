import type { QueryClient } from "@tanstack/react-query";
import {
  adminPointKeyStateDtoSchema,
  adminPointKeyStatesListResponseSchema,
} from "@bms/shared/contracts";
import type {
  AdminPointKeyStateDto,
  AdminPointKeyStatesListResponse,
  CreatePointKeyStateBody,
  UpdatePointKeyStateBody,
} from "@bms/shared";

import { ApiError } from "../../lib/api-error";
import { clearSessionOnAuthFailure, withAuth } from "../http";
import { vocabulariesQueryKey } from "../vocabularies";
import { adminFetch } from "./client";

const base = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

/**
 * `F4.309` (ADR 0088 Amendment 3, plan C13) — the fleet-wide state labels of switching points,
 * `bms.point_key_states`, at `/admin/point-key-states`. Global `admin` only: every route, the read
 * included, refuses any other role (decision 2). A seeded row (`seeded: true`) answers 409 to a
 * `PATCH` or `DELETE` (decision 3).
 */
export const adminPointKeyStatesQueryKey = ["admin", "point-key-states"] as const;

/** Every row, ordered by point key then value. */
export async function fetchAdminPointKeyStates(): Promise<AdminPointKeyStatesListResponse> {
  return adminFetch("/admin/point-key-states", adminPointKeyStatesListResponseSchema);
}

/** Adds a row; a seeded or existing `(pointKey, value)` pair is a 409, an unknown or inactive key a 400. */
export async function createAdminPointKeyState(input: CreatePointKeyStateBody): Promise<AdminPointKeyStateDto> {
  return adminFetch("/admin/point-key-states", adminPointKeyStateDtoSchema, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

/** Label and tone only: the body is `.strict()`, so a key or a value would be a 400 (decision 4). */
export async function updateAdminPointKeyState(
  id: string,
  input: UpdatePointKeyStateBody,
): Promise<AdminPointKeyStateDto> {
  return adminFetch(`/admin/point-key-states/${encodeURIComponent(id)}`, adminPointKeyStateDtoSchema, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

/**
 * Removes a row; the route answers 204 with no body, which `adminFetch` cannot parse, so this
 * makes the request itself with `adminFetch`'s refusal handling: the session cleared on a 401, an
 * `ApiError` carrying the body and the status.
 */
export async function deleteAdminPointKeyState(id: string): Promise<void> {
  const path = `/admin/point-key-states/${encodeURIComponent(id)}`;
  const sent = withAuth({ method: "DELETE" });
  const res = await fetch(`${base}/api/v1${path}`, sent);
  if (!res.ok) {
    clearSessionOnAuthFailure(res, sent);
    const text = await res.text();
    throw new ApiError(text || `admin ${path} ${res.status}`, res.status);
  }
}

/**
 * After any write: this list, and `/vocabularies`, whose `switchingStates` the state legend draws
 * (decision 5), so a new label shows there without a reload.
 */
export async function invalidatePointKeyStateReads(queryClient: QueryClient): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: adminPointKeyStatesQueryKey });
  await queryClient.invalidateQueries({ queryKey: vocabulariesQueryKey });
}
