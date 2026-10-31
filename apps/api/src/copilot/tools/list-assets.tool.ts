import { assetListResponseSchema } from "@bms/shared";
import { z } from "zod";

import { parseStoredContract } from "../../common/parse-stored-contract";
import { CURSOR_PHRASE, LOCATION_ID_PHRASE, listCursorSchema, offsetKeySchema, offsetPage, orderTiesById } from "./copilot-list-paging";
import { defineReadTool, readPerOrganization } from "./copilot-read-tool";

/**
 * `list_assets` — `AssetsService.listAll`, one call per organization with
 * that organization's readable asset ids (never `null`, never no filter).
 *
 * `F4.291` (ADR 0099 Amendment 9 E5): on `readPerOrganization`, so a
 * `locationId` narrows it to the caller's readable assets of that site's
 * subtree, and a `cursor` pages past the 25-item cap (an offset into the
 * organization's filtered rows; the service orders by site name and code,
 * ties put in id order). `search` still filters before the cap and the page
 * (the `F4.274` live-check rule).
 */
export const listAssetsTool = defineReadTool({
  name: "list_assets",
  description:
    `List assets (id, code, name, site, location, domain). Optional organizationId or ${LOCATION_ID_PHRASE} narrows the list; ` +
    `optional search matches part of the name or code. Grouped by organization; truncated means there are more, with ${CURSOR_PHRASE}.`,
  schema: z
    .object({
      organizationId: z.string().uuid().optional(),
      locationId: z.string().uuid().optional(),
      search: z.string().min(1).max(64).optional(),
      cursor: listCursorSchema.optional(),
    })
    .strict(),
  async run(services, args, ctx) {
    // `F4.274` live check: the filter runs before the 25-item cap, so a named asset past the 25th is found.
    const needle = args.search?.trim().toLowerCase() || undefined;
    const matches = (row: { name: string; code: string }): boolean =>
      needle === undefined || row.name.toLowerCase().includes(needle) || row.code.toLowerCase().includes(needle);
    const scope = { organizationId: args.organizationId, locationId: args.locationId, paging: { cursor: args.cursor, key: offsetKeySchema } };
    return readPerOrganization(services, ctx, scope, async (organizationId, assetIds, room, resume) => {
      const rows = parseStoredContract(
        assetListResponseSchema,
        await services.assets.listAll([...assetIds], organizationId),
        "copilot_tools.list_assets.rows",
      ).filter(matches);
      return offsetPage(
        orderTiesById(rows, (row) => `${row.siteName}\u0000${row.code}`),
        resume,
        room,
      );
    });
  },
});
