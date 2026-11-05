import { ForbiddenException } from "@nestjs/common";
import { type AdminAssetTemplateSummaryDto, assetTemplateStatusSchema, assetTemplatesListResponseSchema } from "@bms/shared";
import { z } from "zod";

import { parseStoredContract } from "../../common/parse-stored-contract";
import { defineReadTool, fitFleetListResult } from "./copilot-read-tool";

/** `F4.315` PR A review: every allowed organization answered the list's 403 (or the caller is no master-data user). */
export const COPILOT_ASSET_TEMPLATES_REFUSAL =
  "Asset templates are master data you may not list: you manage none of this conversation's organizations.";

/**
 * `list_asset_templates` (`F4.315` PR A, ADR 0099 Amendment 14 decision 1, ruling Q1) — the
 * asset template versions of the conversation's allowed organizations: `id`, `code`, `version`,
 * `name`, `domain`, `assetType`, `status`, `organizationCode`. The model finds the version id an
 * `assetTemplate.adopt` names here, instead of asking the user to paste it.
 *
 * **The admin list's own read** (`AssetTemplatesAdminService.list`, `GET /admin/asset-templates`),
 * once per allowed organization, with its own `requireMasterDataUser` and `canManageOrganization`:
 * an organization the caller may not manage is the list's 403, and is skipped (its answer for that
 * organization); every organization forbidden is {@link COPILOT_ASSET_TEMPLATES_REFUSAL}, not an
 * empty list; any other error is re-thrown. It reads only and writes no audit row (the
 * service's `list` writes none). `status` defaults to `published`, the versions an adoption can
 * name; `code` is an exact or prefix match, case-insensitive; `domain` is exact.
 *
 * **Fit**: the rows are cut to the tool-result budget (`fitFleetListResult`, `truncated` first),
 * and the result names the organizations whose rows it keeps (the turn's provenance).
 */
export const listAssetTemplatesTool = defineReadTool({
  name: "list_asset_templates",
  description:
    "List asset template versions (id, code, version, name, domain, assetType, status, organizationCode). status " +
    "defaults to published. Filter by code (exact or prefix) or domain. The id is assetTemplate.adopt's version id. " +
    "If truncated is true, filter by code.",
  schema: z
    .object({
      code: z.string().min(1).max(64).optional(),
      domain: z.string().min(1).max(64).optional(),
      status: assetTemplateStatusSchema.optional(),
    })
    .strict(),
  async run({ assetTemplates }, args, ctx) {
    const rows: AdminAssetTemplateSummaryDto[] = [];
    let forbidden = 0;
    for (const organizationId of ctx.allowedOrganizationIds) {
      const page = await assetTemplates.list(ctx.user, organizationId, args.status ?? "published").catch((error: unknown) => {
        if (error instanceof ForbiddenException) return null;
        throw error;
      });
      if (page === null) {
        forbidden += 1;
        continue;
      }
      rows.push(...parseStoredContract(assetTemplatesListResponseSchema, page, "copilot_tools.list_asset_templates.page").items);
    }
    if (forbidden > 0 && forbidden === ctx.allowedOrganizationIds.length) return { ok: false, error: COPILOT_ASSET_TEMPLATES_REFUSAL };
    const code = args.code?.toLowerCase();
    const kept = rows
      .filter((row) => code === undefined || row.code.toLowerCase().startsWith(code))
      .filter((row) => args.domain === undefined || row.domain === args.domain)
      .sort(
        (a, b) =>
          compare(a.organizationCode, b.organizationCode) || compare(a.code, b.code) || b.version - a.version,
      );
    const fitted = fitFleetListResult(
      kept.map(({ id, code, version, name, domain, assetType, status, organizationCode }) => ({
        id,
        code,
        version,
        name,
        domain,
        assetType,
        status,
        organizationCode,
      })),
    );
    if (!fitted.ok) return fitted;
    const count = (fitted.result.items as unknown[]).length;
    return { ...fitted, organizationIds: [...new Set(kept.slice(0, count).map((row) => row.organizationId))] };
  },
});

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
