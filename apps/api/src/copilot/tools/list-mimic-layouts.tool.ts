import { mimicLayoutsListResponseSchema } from "@bms/shared";
import { z } from "zod";

import { parseStoredContract } from "../../common/parse-stored-contract";
import { defineReadTool } from "./copilot-read-tool";
import { COPILOT_TOOL_LIST_MAX_ITEMS, targetOrganizations } from "./copilot-tool-scope";

/**
 * `list_mimic_layouts` (`F3.87` PR 2, ADR 0099 Amendment 3 drafter choice 1)
 * — `MimicLayoutsService.list`, which reads every layout of the caller's
 * readable organizations; the tool keeps only the target organizations of
 * this turn, then cuts at `COPILOT_TOOL_LIST_MAX_ITEMS`.
 */
export const listMimicLayoutsTool = defineReadTool({
  name: "list_mimic_layouts",
  description:
    "List plant mimic layouts (id, name, slug, organization, unit count, version). Optional organizationId narrows the list. " +
    "get_mimic_layout reads one.",
  schema: z.object({ organizationId: z.string().uuid().optional() }).strict(),
  async run({ layouts }, args, ctx) {
    const target = targetOrganizations(args.organizationId, ctx.allowedOrganizationIds);
    if (!target.ok) return target;
    if (target.ids.length === 0) return { ok: true, result: { truncated: false, items: [] }, organizationIds: [] };
    const list = parseStoredContract(mimicLayoutsListResponseSchema, await layouts.list(ctx.user), "copilot_tools.list_mimic_layouts.page");
    const kept = list.items.filter((item) => target.ids.includes(item.organizationId));
    const items = kept.slice(0, COPILOT_TOOL_LIST_MAX_ITEMS).map((item) => ({
      id: item.id,
      name: item.name,
      slug: item.slug,
      organizationId: item.organizationId,
      unitCount: item.unitCount,
      version: item.version,
    }));
    return {
      ok: true,
      result: { truncated: kept.length > items.length, items },
      organizationIds: [...new Set(items.map((item) => item.organizationId))],
    };
  },
});
