/**
 * The asset-template admin surface (`F2.5`, ADR 0038).
 *
 * Nine routes that existed since `F2.1` and had no web client at all — the API
 * was driven by tests and by `curl`. `adminFetch` takes its schema as a
 * required argument, so a client for a route with no response envelope cannot
 * be written; that is why the two missing envelopes only surfaced here (Unit 2)
 * rather than when the routes shipped.
 *
 * **No `try`/`catch` anywhere below, deliberately.** `adminFetch` throws
 * `new Error(text)` with the *raw* response body, and the 403 body carries the
 * message the UI has to render verbatim ("Organization is outside your access
 * scope", ADR 0038 decision 10). Wrapping it would replace a specific,
 * actionable message with a generic one.
 */
import {
  adminAssetTemplateDtoSchema,
  assetInstantiationResultDtoSchema,
  assetTemplatesListResponseSchema,
  stockAssetTemplatesListResponseSchema,
  templateDraftDeletedResponseSchema,
  templateMigrationPreviewResponseSchema,
  templateMigrationResultResponseSchema,
  templateVersionsListResponseSchema,
} from "@bms/shared/contracts";
import type {
  AdminAssetTemplateDto,
  AdminTemplatePointDto,
  AssetInstantiationResultDto,
  AssetTemplatesListResponse,
  AssetTemplateStatus,
  CalcDialect,
  CalcTrigger,
  StockAssetTemplatesListResponse,
  TemplateDraftDeletedResponse,
  TemplateMigrationPreviewResponse,
  TemplateMigrationResultResponse,
  TemplatePointKind,
  TemplateVersionsListResponse,
} from "@bms/shared";

import { adminFetch } from "./client";

export type {
  AssetTemplatesListResponse,
  StockAssetTemplatesListResponse,
  TemplateDraftDeletedResponse,
  TemplateMigrationPreviewResponse,
  TemplateMigrationResultResponse,
  TemplateVersionsListResponse,
};

/**
 * `meta.tier`'s vocabulary — derived from the read-side DTO rather than
 * restated, so a fourth tier added to the shared contract reaches here without
 * a second edit.
 */
export type TemplatePointTier = NonNullable<NonNullable<AdminTemplatePointDto["meta"]>["tier"]>;

/**
 * One point in a create or update body.
 *
 * Restated here rather than imported: the API's `templatePointBodySchema` lives
 * in `apps/api`, which `apps/web` may not import from. The *response* shape
 * comes from `@bms/shared` as `AdminTemplatePointDto`; this is the request
 * shape, and the two differ — a request has no `id`, `templateId` or
 * `createdAt`, and its optional fields carry defaults the server fills in.
 *
 * The five nullable calc fields are all present because
 * `templatePointsBodySchema` replaces the whole array on every `PATCH`. A
 * client that omits one from its type deletes that value from every point it
 * sends back.
 *
 * **`meta` is optional and, when present, closed** — `{ tier }` and nothing
 * else, matching `templatePointBodySchema.meta` (`F2.13`). It is not nullable
 * on the wire: a point with no tier omits the key, and `replacePoints` writes
 * the column's own `{}` default. Sending `null` or `{}` is a 400.
 */
export interface TemplatePointInput {
  pointKey: string;
  label?: string | null;
  unit?: string | null;
  kind?: TemplatePointKind;
  sourceDataKeyPattern?: string | null;
  formula?: string | null;
  formulaDialect?: CalcDialect | null;
  calcTrigger?: CalcTrigger | null;
  calcIntervalSeconds?: number | null;
  maxInputAgeSeconds?: number | null;
  required?: boolean;
  sortOrder?: number;
  meta?: { tier: TemplatePointTier };
}

export interface CreateAssetTemplateInput {
  organizationId: string;
  code: string;
  name: string;
  assetType: string;
  domain: string;
  description?: string | null;
  content?: Record<string, unknown>;
  points?: TemplatePointInput[];
}

/**
 * Draft edits only. No `code` and no `organizationId`: they are the identity a
 * published version's pin resolves through, and `version` is assigned by the
 * version-bump rule, never by a caller.
 */
export interface UpdateAssetTemplateInput {
  name?: string;
  assetType?: string;
  domain?: string;
  description?: string | null;
  content?: Record<string, unknown>;
  points?: TemplatePointInput[];
}

export interface InstantiateAssetInput {
  code: string;
  name: string;
  siteName?: string;
  sourceDataKeyVars?: Record<string, string>;
}

/**
 * The instantiation payload — a union, not two optional fields.
 *
 * The server rejects both-or-neither in a `superRefine`, so a flat
 * `{ rtuId?: string; locationId?: string }` would typecheck for a call that is
 * guaranteed to 400. `never` on the unused arm moves that failure to compile
 * time.
 *
 * Note that `apps/api`'s `InstantiateAssetsBody` is **not** this shape: that
 * schema ends in a `.transform()`, so its inferred type is the post-parse
 * `{ target: { kind, … } }`. This is the wire shape.
 */
export type InstantiateAssetsInput =
  | { rtuId: string; locationId?: never; assets: InstantiateAssetInput[] }
  | { locationId: string; rtuId?: never; assets: InstantiateAssetInput[] };

/** `Content-Type` for every body-carrying call below. */
const jsonHeaders = { "Content-Type": "application/json" };

/**
 * Lists template versions.
 *
 * Both filters are genuinely optional and neither has a default. Unlike
 * `asset-points.ts`'s `active`, `status` has no "all" member —
 * `templateStatusQuerySchema` is `z.enum(["draft","published","archived"])` and
 * the controller parses the raw string, so sending `status=all` is a 400.
 * Omitting the parameter is how "any status" is expressed.
 */
export async function fetchAdminAssetTemplates(
  status?: AssetTemplateStatus,
  organizationId?: string,
): Promise<AssetTemplatesListResponse> {
  const params = new URLSearchParams();
  if (status) {
    params.set("status", status);
  }
  if (organizationId) {
    params.set("organizationId", organizationId);
  }
  const query = params.toString();
  return adminFetch(
    query ? `/admin/asset-templates?${query}` : "/admin/asset-templates",
    assetTemplatesListResponseSchema,
  );
}

/** One version with its full `points` array — the list rows omit them. */
export async function fetchAdminAssetTemplate(id: string): Promise<AdminAssetTemplateDto> {
  return adminFetch(`/admin/asset-templates/${id}`, adminAssetTemplateDtoSchema);
}

export async function createAdminAssetTemplate(
  input: CreateAssetTemplateInput,
): Promise<AdminAssetTemplateDto> {
  return adminFetch("/admin/asset-templates", adminAssetTemplateDtoSchema, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify(input),
  });
}

/**
 * Updates a draft.
 *
 * `points` and `content` are replaced wholesale when present, not merged. The
 * caller owns the merge; see Unit 6.
 */
export async function updateAdminAssetTemplate(
  id: string,
  input: UpdateAssetTemplateInput,
): Promise<AdminAssetTemplateDto> {
  return adminFetch(`/admin/asset-templates/${id}`, adminAssetTemplateDtoSchema, {
    method: "PATCH",
    headers: jsonHeaders,
    body: JSON.stringify(input),
  });
}

export async function publishAdminAssetTemplate(id: string): Promise<AdminAssetTemplateDto> {
  return adminFetch(`/admin/asset-templates/${id}/publish`, adminAssetTemplateDtoSchema, {
    method: "POST",
  });
}

export async function archiveAdminAssetTemplate(id: string): Promise<AdminAssetTemplateDto> {
  return adminFetch(`/admin/asset-templates/${id}/archive`, adminAssetTemplateDtoSchema, {
    method: "POST",
  });
}

/** Builds assets from a published version. All of the batch, or none of it. */
export async function instantiateFromAdminAssetTemplate(
  id: string,
  input: InstantiateAssetsInput,
): Promise<AssetInstantiationResultDto> {
  return adminFetch(`/admin/asset-templates/${id}/instantiate`, assetInstantiationResultDtoSchema, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify(input),
  });
}

/**
 * Opens a new draft from a published version (ADR 0015 immutability).
 *
 * A published version never changes, so "edit this template" is this call
 * followed by `updateAdminAssetTemplate` on the draft it returns.
 */
export async function createDraftFromAdminAssetTemplate(
  id: string,
): Promise<AdminAssetTemplateDto> {
  return adminFetch(`/admin/asset-templates/${id}/draft`, adminAssetTemplateDtoSchema, {
    method: "POST",
  });
}

/** Deletes a draft. The route refuses a published version outright. */
export async function deleteAdminAssetTemplateDraft(
  id: string,
): Promise<TemplateDraftDeletedResponse> {
  return adminFetch(`/admin/asset-templates/${id}`, templateDraftDeletedResponseSchema, {
    method: "DELETE",
  });
}

/**
 * `F2.13` — `GET /admin/asset-templates/stock`: the repository's stock
 * catalog (ADR 0052 decision 4). Master-data role required; the route is
 * declared before `GET :id` on the server, which is why it does not 400 as an
 * invalid uuid.
 */
export async function fetchAdminStockAssetTemplates(): Promise<StockAssetTemplatesListResponse> {
  return adminFetch("/admin/asset-templates/stock", stockAssetTemplatesListResponseSchema);
}

/**
 * `F2.13` — imports one stock entry into `organizationId`, landing as a new
 * stamped draft at the next version (ADR 0052 decision 4). The response is
 * the draft with its points, the same shape `createAdminAssetTemplate` returns.
 */
export async function importAdminStockAssetTemplate(
  code: string,
  organizationId: string,
): Promise<AdminAssetTemplateDto> {
  return adminFetch(
    `/admin/asset-templates/stock/${encodeURIComponent(code)}/import`,
    adminAssetTemplateDtoSchema,
    { method: "POST", headers: jsonHeaders, body: JSON.stringify({ organizationId }) },
  );
}

/**
 * `F2.6` — every version of this template's code (ADR 0039 decision 8).
 *
 * `id` is any version of the code; the route resolves the code from it and
 * returns the whole family, newest first, with the asset count that says which
 * of them is still in service.
 */
export async function fetchAdminAssetTemplateVersions(
  id: string,
): Promise<TemplateVersionsListResponse> {
  return adminFetch(`/admin/asset-templates/${id}/versions`, templateVersionsListResponseSchema);
}

/**
 * Decision 2 — "no blind apply". Writes nothing.
 *
 * `targetVersionId` is the version being migrated **to**; the source version is
 * read per asset by the server, so a selection spanning several versions of one
 * code is handled rather than assumed away.
 *
 * `POST` and not `GET` because the selection is a body. A long list of asset
 * ids in a query string would also be the wrong place for them.
 */
export async function previewAdminAssetTemplateMigration(
  targetVersionId: string,
  assetIds: string[],
): Promise<TemplateMigrationPreviewResponse> {
  return adminFetch(
    `/admin/asset-templates/${targetVersionId}/migration-preview`,
    templateMigrationPreviewResponseSchema,
    { method: "POST", headers: jsonHeaders, body: JSON.stringify({ assetIds }) },
  );
}

/**
 * Decision 1 — the explicit, audited act.
 *
 * The preview is **not** echoed back. The server re-runs it and refuses if it is
 * not clean, so sending one would offer a second opinion it must then decide
 * whether to believe.
 */
export async function migrateAdminAssetTemplateAssets(
  targetVersionId: string,
  assetIds: string[],
): Promise<TemplateMigrationResultResponse> {
  return adminFetch(
    `/admin/asset-templates/${targetVersionId}/migrate`,
    templateMigrationResultResponseSchema,
    { method: "POST", headers: jsonHeaders, body: JSON.stringify({ assetIds }) },
  );
}
