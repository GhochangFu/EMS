import { locationsListResponseSchema } from "@bms/shared";
import { z } from "zod";

import { parseStoredContract } from "../../common/parse-stored-contract";
import { collectByOrganization, defineReadTool } from "./copilot-read-tool";
import { COPILOT_TOOL_LIST_MAX_ITEMS, targetOrganizations } from "./copilot-tool-scope";

/** `LocationsAdminService.list` is master-data only; this role is a copilot role that cannot call it. */
export const COPILOT_LOCATIONS_ROLE_REFUSAL =
  "Your role cannot list locations here. list_assets names the location of each asset you can read.";

/** A row whose organization is not the one asked for: the tool fails closed rather than pass it on. */
export const COPILOT_LOCATIONS_WRONG_ORGANIZATION = "The location list returned a row from another organization.";

/**
 * `list_locations` — `LocationsAdminService.list`, one call per organization
 * (its `organizationId` argument is always set). That service is the
 * master-data read: it allows `admin`, `organization_admin` and
 * `location_admin`, scoped by their location grants, and refuses
 * `asset_group_admin` with a 403 — so this tool refuses that role up front.
 */
export const listLocationsTool = defineReadTool({
  name: "list_locations",
  description:
    "List locations (sites and the nodes of the location tree). Optional organizationId narrows the list; activeOnly true keeps active ones only.",
  schema: z
    .object({
      organizationId: z.string().uuid().optional(),
      activeOnly: z.boolean().optional(),
    })
    .strict(),
  async run({ locations }, args, ctx) {
    if (ctx.identity.role === "asset_group_admin") return { ok: false, error: COPILOT_LOCATIONS_ROLE_REFUSAL };
    const target = targetOrganizations(args.organizationId, ctx.allowedOrganizationIds);
    if (!target.ok) return target;
    const out = collectByOrganization<z.infer<typeof locationsListResponseSchema>["items"][number]>();
    let room = COPILOT_TOOL_LIST_MAX_ITEMS;
    let truncated = false;
    for (const organizationId of target.ids) {
      if (room <= 0) {
        truncated = true;
        break;
      }
      const page = parseStoredContract(
        locationsListResponseSchema,
        await locations.list(ctx.user, organizationId, args.activeOnly),
        "copilot_tools.list_locations.page",
      );
      if (page.items.some((item) => item.organizationId !== organizationId)) {
        return { ok: false, error: COPILOT_LOCATIONS_WRONG_ORGANIZATION };
      }
      if (page.items.length > room) truncated = true;
      room -= out.add(organizationId, page.items, room);
    }
    return { ok: true, result: { organizations: out.organizations, truncated }, organizationIds: out.read };
  },
});
