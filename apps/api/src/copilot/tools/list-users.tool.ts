import { adminUsersListResponseSchema } from "@bms/shared";
import { z } from "zod";

import { parseStoredContract } from "../../common/parse-stored-contract";
import { collectByOrganization, defineReadTool, listResult } from "./copilot-read-tool";
import { COPILOT_TOOL_LIST_MAX_ITEMS, targetOrganizations } from "./copilot-tool-scope";

/**
 * `list_users` (`F4.284`, ADR 0106 decision 6; owner ruling DC1) — the users a
 * work order may be assigned to, so the model can name `assignedTo`. The Users
 * page's own read (`UsersService.list`, its own manager gate: a role it refuses
 * is refused here too), called once.
 *
 * Each row is `id`, `displayName` and `role` only: **an email address never
 * reaches the model**. A global admin (no home organization) is never listed — the
 * copilot never assigns one (DC1) — and nor is a row of an organization outside the
 * turn's allowed set, or a disabled account. `search` (display name) narrows
 * **before** the 25-item cap.
 */
export const listUsersTool = defineReadTool({
  name: "list_users",
  description:
    "List the users of an organization a work order can be assigned to (id, displayName, role); addresses are " +
    "never shown. Optional organizationId and search (display name) narrow the list; truncated means there are more.",
  schema: z
    .object({
      organizationId: z.string().uuid().optional(),
      search: z.string().min(1).max(64).optional(),
    })
    .strict(),
  async run({ users }, args, ctx) {
    const target = targetOrganizations(args.organizationId, ctx.allowedOrganizationIds);
    if (!target.ok) return target;
    const page = parseStoredContract(adminUsersListResponseSchema, await users.list(ctx.user), "copilot_tools.list_users.page");
    const needle = args.search?.toLowerCase();
    const out = collectByOrganization<{ id: string; displayName: string; role: string }>();
    let room = COPILOT_TOOL_LIST_MAX_ITEMS;
    let truncated = false;
    for (const organizationId of target.ids) {
      const matching = page.items.filter(
        (item) =>
          item.organizationId === organizationId &&
          item.disabledAt === null &&
          (needle === undefined || item.displayName.toLowerCase().includes(needle)),
      );
      if (matching.length > room) truncated = true;
      room -= out.add(
        organizationId,
        matching.map((item) => ({ id: item.id, displayName: item.displayName, role: item.role })),
        room,
      );
    }
    return listResult(out, truncated);
  },
});
