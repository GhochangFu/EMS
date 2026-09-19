import {
  calcParameterDtoSchema,
  calcParameterKeysListResponseSchema,
  calcParametersListResponseSchema,
} from "@bms/shared/contracts";
import type {
  CalcParameterDto,
  CalcParameterKeysListResponse,
  CalcParametersListResponse,
} from "@bms/shared";

import { ApiError } from "../../lib/api-error";
import { clearSessionOnAuthFailure, withAuth } from "../http";
import { adminFetch } from "./client";

const base = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

/**
 * `E4.1a` U9 (ADR 0070 decision 2) — the `/admin/calc-parameters` client.
 *
 * The read side is `adminFetch` against the `@bms/shared` contracts, the
 * `point-keys.ts` shape. The write bodies mirror
 * `apps/api/src/admin/calc-parameters/calc-parameters.schema.ts`: `create`
 * names the organization, the key, at most one of `locationId` / `assetId`
 * and the window; `update` carries `value`, `effectiveFrom`, `effectiveTo`
 * only — key and scope are immutable (plan design decision 12) and the API's
 * `.strict()` body refuses one.
 */

export type CreateCalcParameterInput = {
  organizationId: string;
  key: string;
  locationId?: string | null;
  assetId?: string | null;
  value: number;
  /** ISO 8601 with an offset — the API refuses an unzoned wall-clock string. */
  effectiveFrom: string;
  effectiveTo?: string | null;
};

export type UpdateCalcParameterInput = Partial<{
  value: number;
  effectiveFrom: string;
  /** `null` clears the end and makes the row open-ended. */
  effectiveTo: string | null;
}>;

export const calcParameterKeysQueryKey = ["admin", "calc-parameter-keys"] as const;

export function calcParametersQueryKey(organizationId: string) {
  return ["admin", "calc-parameters", organizationId] as const;
}

/** `GET /admin/calc-parameters/keys` — the active vocabulary, in `sortOrder`. */
export async function fetchCalcParameterKeys(): Promise<CalcParameterKeysListResponse> {
  return adminFetch("/admin/calc-parameters/keys", calcParameterKeysListResponseSchema);
}

/** `GET /admin/calc-parameters?organizationId=` — one organization's rows, by key then window. */
export async function fetchAdminCalcParameters(
  organizationId: string,
  key?: string,
): Promise<CalcParametersListResponse> {
  const params = new URLSearchParams({ organizationId });
  if (key) {
    params.set("key", key);
  }
  return adminFetch(`/admin/calc-parameters?${params}`, calcParametersListResponseSchema);
}

export async function createAdminCalcParameter(
  input: CreateCalcParameterInput,
): Promise<CalcParameterDto> {
  return adminFetch("/admin/calc-parameters", calcParameterDtoSchema, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function updateAdminCalcParameter(
  id: string,
  input: UpdateCalcParameterInput,
): Promise<CalcParameterDto> {
  return adminFetch(`/admin/calc-parameters/${encodeURIComponent(id)}`, calcParameterDtoSchema, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

/**
 * `DELETE /admin/calc-parameters/:id` — 204, no body.
 *
 * `adminFetch` cannot serve it: it reads `res.json()`, and there is no empty
 * response schema in `client.ts`. This is `deleteAssetImage`'s shape
 * (`api/asset-images.ts`): the success test is `status === 204` because the
 * route is declared `@HttpCode(204)`, and a refusal is the same
 * `clearSessionOnAuthFailure` then `ApiError` sequence `adminFetch` runs.
 */
export async function deleteAdminCalcParameter(id: string): Promise<void> {
  const res = await fetch(
    `${base}/api/v1/admin/calc-parameters/${encodeURIComponent(id)}`,
    withAuth({ method: "DELETE" }),
  );
  if (res.status === 204) {
    return;
  }
  clearSessionOnAuthFailure(res);
  const text = await res.text();
  throw new ApiError(text || `admin /admin/calc-parameters/:id ${res.status}`, res.status);
}
