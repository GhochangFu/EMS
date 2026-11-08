import { mqttPayloadFormatsListResponseSchema } from "@bms/shared";
import { z } from "zod";

import { parseStoredContract } from "../../common/parse-stored-contract";
import { defineReadTool, fitFleetListResult } from "./copilot-read-tool";

/** The refusal for anyone but the global admin (ADR 0116 decision 5: the catalog and its test route are theirs alone). */
export const COPILOT_PAYLOAD_FORMATS_ROLE_REFUSAL =
  "MQTT payload formats are platform-wide: only a global administrator can list, test or change them.";

/**
 * `list_payload_formats` (`F4.334` PR 5, ADR 0099 Amendment 17 decision 2, ruling Q2) — the MQTT
 * payload format catalog (`bms.mqtt_payload_formats`): each format's `code`, `name`,
 * `description`, `builtin` and `rtuCount`, the RTUs whose connection config names it.
 *
 * **Global admin only**, refused before any read, as the catalog's writes and test route are.
 * The list is the admin list's own read (`MqttPayloadFormatsAdminService.list`); the counts are
 * tenant data, so they come from `rtuCountsInOrganizations` over the turn's
 * `allowedOrganizationIds` alone (one `withTenant` read each, never a fleet-wide read), and the
 * result names those organizations as its provenance. Reads only; writes no audit row.
 *
 * No definition body in the list (the house limit, drafter's choice); `code` answers that one
 * format **with** its `definition`. The rows are fitted to the tool-result budget
 * (`fitFleetListResult`, `truncated` first).
 */
export const listPayloadFormatsTool = defineReadTool({
  name: "list_payload_formats",
  description:
    "List MQTT payload formats (code, name, description, builtin, rtuCount). Global admin only. Pass code for one with its definition.",
  schema: z.object({ code: z.string().min(1).max(64).optional() }).strict(),
  async run({ mqttPayloadFormats }, args, ctx) {
    if (ctx.identity.role !== "admin") return { ok: false, error: COPILOT_PAYLOAD_FORMATS_ROLE_REFUSAL };
    const rows = parseStoredContract(
      mqttPayloadFormatsListResponseSchema,
      await mqttPayloadFormats.list(ctx.user),
      "copilot_tools.list_payload_formats.page",
    );
    const usage = await mqttPayloadFormats.rtuCountsInOrganizations(ctx.user, ctx.allowedOrganizationIds);
    const items = rows
      .filter((row) => args.code === undefined || row.code === args.code)
      .map(({ code, name, description, builtin, definition }) => ({
        code,
        name,
        description,
        builtin,
        // Own keys only: a code such as `constructor` must not read the prototype.
        rtuCount: Object.prototype.hasOwnProperty.call(usage.counts, code) ? (usage.counts[code] ?? 0) : 0,
        ...(args.code === undefined ? {} : { definition }),
      }));
    const fitted = fitFleetListResult(items);
    return fitted.ok ? { ...fitted, organizationIds: usage.organizationIds } : fitted;
  },
});
