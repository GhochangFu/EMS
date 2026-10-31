import { notificationChannelsListResponseSchema } from "@bms/shared";
import { z } from "zod";

import { parseStoredContract } from "../../common/parse-stored-contract";
import { collectByOrganization, defineReadTool, listResult } from "./copilot-read-tool";
import { COPILOT_TOOL_LIST_MAX_ITEMS, targetOrganizations } from "./copilot-tool-scope";

/**
 * `ChannelsService.list` and `EscalationProfilesService.list` answer `[]` to a
 * `location_admin` and 403 to an `asset_group_admin` (the read gate is the write
 * gate, `canManageNotificationChannel`), so both tools refuse the two roles up
 * front — the `list_locations` refusal pattern.
 */
export const COPILOT_NOTIFICATIONS_ROLE_REFUSAL =
  "Your role cannot list notification channels or escalation profiles; an organization admin manages them.";

/** The two roles the channel and escalation routes admit. */
export const mayListNotifications = (role: string): boolean => role === "admin" || role === "organization_admin";

/**
 * `list_notification_channels` (`F4.279`, ADR 0099 Amendment 8 D7, D5, Q13) —
 * the Channels page's own read (`ChannelsService.list`), called once. A
 * fleet-wide channel (`organizationId === null`) is dropped, as is any row of
 * an organization outside the turn's allowed set; rows are grouped by
 * organization, `search` (code or name) narrows **before** the 25-item cap.
 *
 * **`config` is never returned** (D5, D7): an email address or a webhook URL
 * stays off the model. A row carries `recipientCount` (how many email addresses
 * `config.to` holds), `hasUrl` and `hasSecret` instead; the
 * Confirm card shows the addresses in full from the server's own read.
 */
export const listNotificationChannelsTool = defineReadTool({
  name: "list_notification_channels",
  description:
    "List notification channels (id, code, name, kind, enabled, hasSecret, recipientCount, hasUrl); addresses and " +
    "URLs are never shown. Disabled channels are included, so an enable can name one. Optional organizationId and " +
    "search (code or name) narrow the list; truncated means there are more.",
  schema: z
    .object({
      organizationId: z.string().uuid().optional(),
      search: z.string().min(1).max(64).optional(),
    })
    .strict(),
  async run({ channels }, args, ctx) {
    if (!mayListNotifications(ctx.identity.role)) return { ok: false, error: COPILOT_NOTIFICATIONS_ROLE_REFUSAL };
    const target = targetOrganizations(args.organizationId, ctx.allowedOrganizationIds);
    if (!target.ok) return target;
    const page = parseStoredContract(
      notificationChannelsListResponseSchema,
      { items: await channels.list(ctx.user) },
      "copilot_tools.list_notification_channels.page",
    );
    const needle = args.search?.toLowerCase();
    const out = collectByOrganization<Record<string, unknown>>();
    let room = COPILOT_TOOL_LIST_MAX_ITEMS;
    let truncated = false;
    for (const organizationId of target.ids) {
      const matching = page.items.filter(
        (item) =>
          item.organizationId === organizationId &&
          (needle === undefined || item.code.toLowerCase().includes(needle) || item.name.toLowerCase().includes(needle)),
      );
      if (matching.length > room) truncated = true;
      room -= out.add(
        organizationId,
        matching.map((item) => {
          const to = Array.isArray(item.config.to) ? item.config.to : [];
          const hasUrl = typeof item.config.url === "string" && item.config.url !== "";
          return {
            id: item.id,
            code: item.code,
            name: item.name,
            kind: item.kind,
            enabled: item.enabled,
            hasSecret: item.hasSecret,
            recipientCount: to.length,
            hasUrl,
          };
        }),
        room,
      );
    }
    return listResult(out, truncated);
  },
});
