import { HttpException } from "@nestjs/common";
import { escalationDefaultsResponseSchema, escalationProfilesListResponseSchema } from "@bms/shared";
import { z } from "zod";

import { parseStoredContract } from "../../common/parse-stored-contract";
import { collectByOrganization, defineReadTool, listResult } from "./copilot-read-tool";
import { COPILOT_TOOL_LIST_MAX_ITEMS, targetOrganizations } from "./copilot-tool-scope";
import { COPILOT_NOTIFICATIONS_ROLE_REFUSAL, mayListNotifications } from "./list-notification-channels.tool";

/** What the tool reads, parsed once: the profiles, and each readable organization's severity map. */
const escalationReadSchema = z.object({
  profiles: escalationProfilesListResponseSchema,
  defaults: z.array(escalationDefaultsResponseSchema),
});

/**
 * `list_escalation_profiles` (`F4.279`, ADR 0099 Amendment 8 D7; owner ruling
 * Q9) — the Escalation page's own reads: `EscalationProfilesService.list`,
 * called once, and `getDefaults` per organization, so the model can name a
 * profile and see the severity map it would change. A profile of an
 * organization outside the turn's allowed set is dropped; rows are grouped by
 * organization, `search` (code or name) narrows **before** the 25-item cap.
 *
 * A map the caller may not read (`getDefaults`' own 403) is left out of that
 * organization's entry rather than refusing the read whole. A ladder names its
 * channels by id; `list_notification_channels` names them.
 */
export const listEscalationProfilesTool = defineReadTool({
  name: "list_escalation_profiles",
  description:
    "List escalation profiles (id, code, name, and each ladder step's afterMinutes and channelIds) and, per " +
    "organization, the severity map (severity → profileId). Optional organizationId and search (code or name) " +
    "narrow the list; truncated means there are more.",
  schema: z
    .object({
      organizationId: z.string().uuid().optional(),
      search: z.string().min(1).max(64).optional(),
    })
    .strict(),
  async run({ escalationProfiles }, args, ctx) {
    if (!mayListNotifications(ctx.identity.role)) return { ok: false, error: COPILOT_NOTIFICATIONS_ROLE_REFUSAL };
    const target = targetOrganizations(args.organizationId, ctx.allowedOrganizationIds);
    if (!target.ok) return target;
    const profiles = await escalationProfiles.list(ctx.user);
    const defaults: unknown[] = [];
    for (const organizationId of target.ids) {
      try {
        defaults.push(await escalationProfiles.getDefaults(ctx.user, organizationId));
      } catch (err) {
        if (!(err instanceof HttpException)) throw err;
      }
    }
    const read = parseStoredContract(
      escalationReadSchema,
      { profiles: { items: profiles }, defaults },
      "copilot_tools.list_escalation_profiles.page",
    );
    const needle = args.search?.toLowerCase();
    const out = collectByOrganization<Record<string, unknown>>();
    let room = COPILOT_TOOL_LIST_MAX_ITEMS;
    let truncated = false;
    for (const organizationId of target.ids) {
      const matching = read.profiles.items.filter(
        (item) =>
          item.organizationId === organizationId &&
          (needle === undefined || item.code.toLowerCase().includes(needle) || item.name.toLowerCase().includes(needle)),
      );
      if (matching.length > room) truncated = true;
      const map = read.defaults.find((entry) => entry.organizationId === organizationId);
      room -= out.add(
        organizationId,
        matching.map((item) => ({
          id: item.id,
          code: item.code,
          name: item.name,
          steps: item.steps.map((step) => ({ stepNo: step.stepNo, afterMinutes: step.afterMinutes, channelIds: step.channelIds })),
        })),
        room,
        map === undefined ? undefined : { defaults: map.items },
      );
    }
    return listResult(out, truncated);
  },
});
