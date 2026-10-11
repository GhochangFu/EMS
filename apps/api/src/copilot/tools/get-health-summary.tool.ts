import { healthSummaryResponseSchema, MAX_WIDGET_WINDOW_MINUTES } from "@bms/shared";
import { z } from "zod";

import { parseStoredContract } from "../../common/parse-stored-contract";
import { defineReadTool } from "./copilot-read-tool";
import { targetOrganizations } from "./copilot-tool-scope";

/** The `/asset-health/summary` route's default window (`assetHealthQuerySchema`). */
const DEFAULT_HEALTH_WINDOW_MINUTES = 1_440;

/**
 * `get_health_summary` — `AssetHealthService.summary`, one call per
 * organization with `readableAssetIdsInOrganization` (an array, never the
 * `null` that `readableAssetIds` gives the global admin and that the service
 * reads as "every asset").
 */
export const getHealthSummaryTool = defineReadTool({
  name: "get_health_summary",
  description:
    "Read the asset health summary (the plant and enterprise donut) per organization over a window in minutes (default 1440). " +
    "Optional organizationId narrows it.",
  schema: z
    .object({
      organizationId: z.string().uuid().optional(),
      windowMinutes: z.number().int().positive().max(MAX_WIDGET_WINDOW_MINUTES).optional(),
    })
    .strict(),
  async run({ access, health }, args, ctx) {
    const target = targetOrganizations(args.organizationId, ctx.allowedOrganizationIds);
    if (!target.ok) return target;
    const organizations: Array<{ organizationId: string; summary: z.infer<typeof healthSummaryResponseSchema> }> = [];
    for (const organizationId of target.ids) {
      const assetIds = await access.readableAssetIdsInOrganization(ctx.user, organizationId);
      const summary = parseStoredContract(
        healthSummaryResponseSchema,
        await health.summary(assetIds, undefined, args.windowMinutes ?? DEFAULT_HEALTH_WINDOW_MINUTES, ctx.now),
        "copilot_tools.get_health_summary.result",
      );
      organizations.push({ organizationId, summary });
    }
    return { ok: true, result: { organizations }, organizationIds: organizations.map((o) => o.organizationId) };
  },
});
