import {
  dashboardDeletedResponseSchema,
  dashboardDtoSchema,
  dashboardsListResponseSchema,
} from "@bms/shared/contracts";
import type { Contract, ContractSchema } from "@bms/shared/contracts";
import type { DashboardDeletedResponse, DashboardDto, DashboardsListResponse } from "@bms/shared";

import { ApiError } from "../lib/api-error";
import type { PutDashboardWidgetsPayload } from "../lib/dashboard-builder-form";
import { clearSessionOnAuthFailure, withAuth } from "./http";
import { checkResponse } from "./validate";

const base = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

/**
 * `F3.1d` Unit 5 — the client for `F3.1b`'s dashboard read/write API
 * (`DashboardBuilderController`, base path `/dashboards`). Every response is
 * validated with `checkResponse` (ADR 0030 decision 5).
 *
 * **Throws `ApiError`, not a plain `Error` — follows `adminFetch`
 * (`apps/web/src/api/admin/client.ts`), not `rules.ts`.** `rules.ts`'s own
 * throw sites lose the HTTP status, and `lib/query-retry.ts` needs it to stop
 * a 403 costing four requests (`F4.63`). This file does not literally reuse
 * `adminFetch` — that function lives under `api/admin/` and labels every
 * endpoint `admin ...`, which would misdescribe a route a `viewer` reads
 * every day — but `dashboardsFetch` below is byte-for-byte the same shape:
 * auth header, `!res.ok` handled before the body is touched (so
 * `clearSessionOnAuthFailure` sees the 401 first), and an `ApiError` carrying
 * the status.
 */
async function dashboardsFetch<S extends ContractSchema>(
  path: string,
  schema: S,
  endpoint: string,
  init?: RequestInit,
): Promise<Contract<S>> {
  const res = await fetch(`${base}/api/v1${path}`, withAuth(init));
  if (!res.ok) {
    clearSessionOnAuthFailure(res);
    const text = await res.text();
    throw new ApiError(text || `${endpoint} ${res.status}`, res.status);
  }
  return checkResponse(schema, await res.json(), endpoint);
}

function organizationQuery(organizationId?: string): string {
  return organizationId ? `?organizationId=${encodeURIComponent(organizationId)}` : "";
}

function jsonInit(method: "POST" | "PATCH" | "PUT", body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

/** `POST /dashboards`'s body. Declared locally rather than imported from `apps/api` — `apps/web`
 * does not depend on `apps/api` — mirroring `CreateDashboardBody`
 * (`apps/api/src/dashboard-builder/dashboards.schema.ts`) field for field, the same shape
 * `rules.ts`'s `RuleDraftPayload` uses for its own request body. */
export type CreateDashboardPayload = {
  organizationId: string;
  slug: string;
  name: string;
  description?: string | null;
  locationId?: string | null;
  assetGroupId?: string | null;
};

/** `PATCH /dashboards/:id`'s body — every field optional, `organizationId` omitted entirely
 * (a dashboard's tenant is fixed at creation; `UpdateDashboardBody` rejects the field rather
 * than silently ignoring it). */
export type UpdateDashboardPayload = Partial<Omit<CreateDashboardPayload, "organizationId">>;

/** `GET /dashboards`, optionally narrowed to one organization. An admin/multi-organization
 * caller sees every readable organization's dashboards when it is omitted — `Amendment 4`'s read
 * visibility, unchanged by this client. */
export async function fetchDashboards(organizationId?: string): Promise<DashboardsListResponse> {
  const path = `/dashboards${organizationQuery(organizationId)}`;
  return dashboardsFetch(path, dashboardsListResponseSchema, "dashboards");
}

/** `GET /dashboards/:slug` — `organizationId` disambiguates a slug that matches more than one
 * organization's dashboard on the fleet pool (D5). */
export async function fetchDashboard(slug: string, organizationId?: string): Promise<DashboardDto> {
  const path = `/dashboards/${encodeURIComponent(slug)}${organizationQuery(organizationId)}`;
  return dashboardsFetch(path, dashboardDtoSchema, "dashboards/:slug");
}

/** `POST /dashboards`. A 403 here is `"You may not create a dashboard with this scope"`
 * (`dashboards.service.ts:295`) — the inline-403 render §6.2 requires depends on the thrown
 * `ApiError.status` surviving to the caller. */
export async function createDashboard(body: CreateDashboardPayload): Promise<DashboardDto> {
  return dashboardsFetch("/dashboards", dashboardDtoSchema, "dashboards", jsonInit("POST", body));
}

/** `PATCH /dashboards/:id`. */
export async function updateDashboard(id: string, body: UpdateDashboardPayload): Promise<DashboardDto> {
  return dashboardsFetch(
    `/dashboards/${encodeURIComponent(id)}`,
    dashboardDtoSchema,
    "dashboards/:id",
    jsonInit("PATCH", body),
  );
}

/** `DELETE /dashboards/:id`. */
export async function deleteDashboard(id: string): Promise<DashboardDeletedResponse> {
  return dashboardsFetch(
    `/dashboards/${encodeURIComponent(id)}`,
    dashboardDeletedResponseSchema,
    "dashboards/:id",
    { method: "DELETE" },
  );
}

/** `PUT /dashboards/:id/widgets` — replaces the whole widget set in one transaction.
 * `PutDashboardWidgetsPayload` is `dashboard-builder-form.ts`'s own write-body type (Unit 4),
 * reused here rather than restated. */
export async function putDashboardWidgets(
  id: string,
  body: PutDashboardWidgetsPayload,
): Promise<DashboardDto> {
  return dashboardsFetch(
    `/dashboards/${encodeURIComponent(id)}/widgets`,
    dashboardDtoSchema,
    "dashboards/:id/widgets",
    jsonInit("PUT", body),
  );
}
