/**
 * The section dashboard template admin surface (`F3.36` Part F, ADR 0049).
 *
 * Mirrors `asset-templates.ts`'s idiom exactly: `adminFetch` takes its schema
 * as a required argument (ADR 0030 decision 5), and no call site here casts a
 * response. `dashboardTemplatesListResponseSchema` and
 * `stockDashboardTemplatesListResponseSchema` did not exist before this unit —
 * the same gap `asset-templates.ts`'s own docblock records for its two routes,
 * closed the same way, in `envelopes.ts`.
 *
 * **No `try`/`catch` anywhere below, deliberately** — see `asset-templates.ts`'s
 * docblock. `adminFetch` throws `ApiError` carrying the raw response body, and
 * the caller renders it through `apiErrorMessage`.
 */
import {
  dashboardTemplateDtoSchema,
  dashboardTemplatesListResponseSchema,
  instantiateSectionTemplateResponseSchema,
  stockDashboardTemplatesListResponseSchema,
  templateDraftDeletedResponseSchema,
} from "@bms/shared/contracts";
import type {
  DashboardSectionCode,
  DashboardTemplateDto,
  DashboardTemplatesListResponse,
  DashboardWidgetSpec,
  InstantiateSectionTemplateResponse,
  StockDashboardTemplatesListResponse,
  TemplateDraftDeletedResponse,
  TemplateLifecycleStatus,
  WidgetPointRole,
} from "@bms/shared";

import { adminFetch } from "./client";

export type {
  DashboardTemplatesListResponse,
  InstantiateSectionTemplateResponse,
  StockDashboardTemplatesListResponse,
  TemplateDraftDeletedResponse,
};

/** `Content-Type` for every body-carrying call below. */
const jsonHeaders = { "Content-Type": "application/json" };

/**
 * A role-plus-point-key binding, the request shape of
 * `sectionTemplateBindingSchema`.
 *
 * Restated here rather than imported: `apps/api`'s write schema is not
 * importable from `apps/web` (ADR 0030 decision 3), so this is the request
 * shape and `@bms/shared`'s `TemplateWidgetResolutionDto` remains the response
 * shape — the two differ, and `pointRole`/`sortOrder` carry server defaults a
 * request may omit.
 */
export interface SectionTemplateBindingInput {
  assetRoleCode: string;
  pointKey: string;
  pointRole?: WidgetPointRole;
  sortOrder?: number;
}

/** A metric-catalog binding, the request shape of `sectionTemplateSourceSchema`. */
export interface SectionTemplateSourceInput {
  catalogKey: string;
  params?: Record<string, string | number | boolean>;
  sortOrder?: number;
}

/**
 * One template widget, the request shape of `sectionTemplateWidgetSchema`.
 *
 * `& DashboardWidgetSpec` for the same reason the response contract's
 * docblock gives: a template widget's type and config are unchanged from a
 * live dashboard widget's, and only the binding differs.
 */
export type SectionTemplateWidgetInput = {
  key: string;
  title?: string | null;
  gridX: number;
  gridY: number;
  gridW: number;
  gridH: number;
  bindings?: SectionTemplateBindingInput[];
  sources?: SectionTemplateSourceInput[];
} & DashboardWidgetSpec;

/** A template's whole authored canvas — the request shape of
 * `sectionTemplateContentSchema`. */
export interface SectionTemplateContentInput {
  widgets: SectionTemplateWidgetInput[];
}

export interface CreateDashboardTemplateInput {
  organizationId: string;
  code: string;
  name: string;
  section: DashboardSectionCode;
  description?: string | null;
  content?: SectionTemplateContentInput;
}

/** Draft edits only — no `organizationId` and no `code`; see
 * `UpdateAssetTemplateInput`'s docblock for the identical reasoning. */
export interface UpdateDashboardTemplateInput {
  name?: string;
  section?: DashboardSectionCode;
  description?: string | null;
  content?: SectionTemplateContentInput;
}

/** `POST /admin/dashboard-templates/:id/instantiate` — ADR 0049 decision 4. */
export interface InstantiateDashboardTemplateInput {
  assetGroupId: string;
  slug: string;
  name: string;
  description?: string | null;
}

/** Lists template versions. Both filters are optional, with no "all" member —
 * see `fetchAdminAssetTemplates`'s docblock for the identical shape. */
export async function fetchAdminDashboardTemplates(
  status?: TemplateLifecycleStatus,
  section?: DashboardSectionCode,
  organizationId?: string,
): Promise<DashboardTemplatesListResponse> {
  const params = new URLSearchParams();
  if (status) {
    params.set("status", status);
  }
  if (section) {
    params.set("section", section);
  }
  if (organizationId) {
    params.set("organizationId", organizationId);
  }
  const query = params.toString();
  return adminFetch(
    query ? `/admin/dashboard-templates?${query}` : "/admin/dashboard-templates",
    dashboardTemplatesListResponseSchema,
  );
}

/** One version with its full `content` — the list rows omit it. */
export async function fetchAdminDashboardTemplate(id: string): Promise<DashboardTemplateDto> {
  return adminFetch(`/admin/dashboard-templates/${id}`, dashboardTemplateDtoSchema);
}

export async function createAdminDashboardTemplate(
  input: CreateDashboardTemplateInput,
): Promise<DashboardTemplateDto> {
  return adminFetch("/admin/dashboard-templates", dashboardTemplateDtoSchema, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify(input),
  });
}

/** Updates a draft. `content` is replaced wholesale when present, not merged. */
export async function updateAdminDashboardTemplate(
  id: string,
  input: UpdateDashboardTemplateInput,
): Promise<DashboardTemplateDto> {
  return adminFetch(`/admin/dashboard-templates/${id}`, dashboardTemplateDtoSchema, {
    method: "PATCH",
    headers: jsonHeaders,
    body: JSON.stringify(input),
  });
}

export async function publishAdminDashboardTemplate(id: string): Promise<DashboardTemplateDto> {
  return adminFetch(`/admin/dashboard-templates/${id}/publish`, dashboardTemplateDtoSchema, {
    method: "POST",
  });
}

export async function archiveAdminDashboardTemplate(id: string): Promise<DashboardTemplateDto> {
  return adminFetch(`/admin/dashboard-templates/${id}/archive`, dashboardTemplateDtoSchema, {
    method: "POST",
  });
}

/** Opens a new draft from a published (or archived — Amendment 3) version. */
export async function createDraftFromAdminDashboardTemplate(
  id: string,
): Promise<DashboardTemplateDto> {
  return adminFetch(`/admin/dashboard-templates/${id}/draft`, dashboardTemplateDtoSchema, {
    method: "POST",
  });
}

/** Deletes a draft. The route refuses a published version outright. */
export async function deleteAdminDashboardTemplateDraft(
  id: string,
): Promise<TemplateDraftDeletedResponse> {
  return adminFetch(`/admin/dashboard-templates/${id}`, templateDraftDeletedResponseSchema, {
    method: "DELETE",
  });
}

/** `GET /admin/dashboard-templates/stock` — the six repository defaults
 * (ADR 0049 decision 3). Reads no database; this is code. */
export async function fetchAdminStockDashboardTemplates(): Promise<StockDashboardTemplatesListResponse> {
  return adminFetch("/admin/dashboard-templates/stock", stockDashboardTemplatesListResponseSchema);
}

/** Imports one stock entry into `organizationId`, landing as a new draft. */
export async function importAdminStockDashboardTemplate(
  code: string,
  organizationId: string,
): Promise<DashboardTemplateDto> {
  return adminFetch(
    `/admin/dashboard-templates/stock/${code}/import`,
    dashboardTemplateDtoSchema,
    { method: "POST", headers: jsonHeaders, body: JSON.stringify({ organizationId }) },
  );
}

/**
 * Instantiates a published template against one asset group.
 *
 * Response carries the resolution report (ADR 0049 Amendment 2 decision 1) —
 * every widget's `matchedMembers`, `boundPoints` and `outcome`, alongside the
 * dashboard that was created. The caller must render it; see
 * `dashboard-template-detail-page.tsx`.
 */
export async function instantiateAdminDashboardTemplate(
  id: string,
  input: InstantiateDashboardTemplateInput,
): Promise<InstantiateSectionTemplateResponse> {
  return adminFetch(
    `/admin/dashboard-templates/${id}/instantiate`,
    instantiateSectionTemplateResponseSchema,
    { method: "POST", headers: jsonHeaders, body: JSON.stringify(input) },
  );
}
