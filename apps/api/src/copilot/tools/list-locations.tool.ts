import { locationsListResponseSchema } from "@bms/shared";
import { z } from "zod";

import { parseStoredContract } from "../../common/parse-stored-contract";
import { CURSOR_PHRASE, listCursorSchema, offsetKeySchema, offsetPage, orderTiesById } from "./copilot-list-paging";
import { defineReadTool, pageOrganizations } from "./copilot-read-tool";
import { targetOrganizations } from "./copilot-tool-scope";

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
 *
 * `F4.291` (ADR 0099 Amendment 9 E5; owner ruling P6): it is where a model
 * finds a site's `locationId`, so a site past the 25th node must be
 * reachable: `search` (name or code, case-insensitive) filters before the cap
 * and the page, and `cursor` is an offset into the filtered rows (the service
 * orders by name; tied names are put in id order). No asset ids are read, so
 * it pages through `pageOrganizations`, not `readPerOrganization`.
 */
export const listLocationsTool = defineReadTool({
  name: "list_locations",
  description:
    "List locations (sites and the nodes of the location tree). Optional organizationId narrows the list; activeOnly true keeps active ones only; " +
    `search matches part of the name or code. truncated means there are more, with ${CURSOR_PHRASE}.`,
  schema: z
    .object({
      organizationId: z.string().uuid().optional(),
      activeOnly: z.boolean().optional(),
      search: z.string().min(1).max(64).optional(),
      cursor: listCursorSchema.optional(),
    })
    .strict(),
  async run({ locations }, args, ctx) {
    if (ctx.identity.role === "asset_group_admin") return { ok: false, error: COPILOT_LOCATIONS_ROLE_REFUSAL };
    const target = targetOrganizations(args.organizationId, ctx.allowedOrganizationIds);
    if (!target.ok) return target;
    const needle = args.search?.trim().toLowerCase() || undefined;
    const paging = { cursor: args.cursor, key: offsetKeySchema };
    return pageOrganizations(target.ids, paging, async (organizationId, room, resume) => {
      const page = parseStoredContract(
        locationsListResponseSchema,
        await locations.list(ctx.user, organizationId, args.activeOnly),
        "copilot_tools.list_locations.page",
      );
      if (page.items.some((item) => item.organizationId !== organizationId)) {
        return { refusal: COPILOT_LOCATIONS_WRONG_ORGANIZATION };
      }
      const rows = page.items.filter(
        (item) => needle === undefined || item.name.toLowerCase().includes(needle) || item.code.toLowerCase().includes(needle),
      );
      return offsetPage(orderTiesById(rows, (item) => item.name), resume, room);
    });
  },
});
