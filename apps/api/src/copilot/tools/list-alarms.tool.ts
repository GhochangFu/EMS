import { alarmsListResponseSchema } from "@bms/shared";
import { z } from "zod";

import { parseStoredContract } from "../../common/parse-stored-contract";
import { collectByOrganization, defineReadTool } from "./copilot-read-tool";
import {
  COPILOT_TOOL_LIST_MAX_ITEMS,
  COPILOT_TOOL_RECORD_OUT_OF_SCOPE,
  organizationOfAsset,
  targetOrganizations,
} from "./copilot-tool-scope";

/**
 * `list_alarms` — the alarms list (`AlarmsService.list`), one call per
 * organization with that organization's readable asset ids, so the service
 * never sees `assetIds: null`. An `assetId` is placed in an organization
 * first (`organizationOfAsset`).
 */
export const listAlarmsTool = defineReadTool({
  name: "list_alarms",
  description:
    "List alarms, newest first. state 'active' (default) or 'all'. Optional organizationId and assetId narrow the list. " +
    "The result groups alarms by organization; truncated means there are more.",
  schema: z
    .object({
      organizationId: z.string().uuid().optional(),
      assetId: z.string().uuid().optional(),
      state: z.enum(["active", "all"]).default("active"),
    })
    .strict(),
  async run({ access, alarms }, args, ctx) {
    const target = targetOrganizations(args.organizationId, ctx.allowedOrganizationIds);
    if (!target.ok) return target;
    let organizations = target.ids;
    if (args.assetId !== undefined) {
      const owner = await organizationOfAsset(access, ctx.user, organizations, args.assetId);
      if (owner === null) return { ok: false, error: COPILOT_TOOL_RECORD_OUT_OF_SCOPE };
      organizations = [owner];
    }
    const out = collectByOrganization<z.infer<typeof alarmsListResponseSchema>["items"][number]>();
    let room = COPILOT_TOOL_LIST_MAX_ITEMS;
    let truncated = false;
    for (const organizationId of organizations) {
      if (room <= 0) {
        truncated = true;
        break;
      }
      const assetIds =
        args.assetId !== undefined ? [args.assetId] : await access.readableAssetIdsInOrganization(ctx.user, organizationId);
      if (assetIds.length === 0) {
        out.add(organizationId, [], room);
        continue;
      }
      const page = parseStoredContract(
        alarmsListResponseSchema,
        await alarms.list({ limit: room, assetIds, state: args.state, organizationId }),
        "copilot_tools.list_alarms.page",
      );
      room -= out.add(organizationId, page.items, room);
      if (page.nextCursor !== null) truncated = true;
    }
    return { ok: true, result: { organizations: out.organizations, truncated }, organizationIds: out.read };
  },
});
