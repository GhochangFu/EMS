import { alarmSeverityCodeSchema, alarmsListResponseSchema } from "@bms/shared";
import { z } from "zod";

import { parseStoredContract } from "../../common/parse-stored-contract";
import { CURSOR_PHRASE, LOCATION_ID_PHRASE, listCursorSchema } from "./copilot-list-paging";
import { defineReadTool, readPerOrganization } from "./copilot-read-tool";
import { COPILOT_TOOL_RECORD_OUT_OF_SCOPE, organizationOfAsset, targetOrganizations } from "./copilot-tool-scope";
import { refineInstantRange, resolveInstantRange, timeRangeFields } from "./copilot-time-range";

/** The shape `AlarmsService`'s keyset cursor decodes to (`alarms.service.ts`, `encodeCursor`). */
const alarmKeysetSchema = z.object({ t: z.string().datetime(), id: z.string().uuid() }).strict();

/**
 * `F4.291` — the resume key of `list_alarms`: the service's own keyset cursor,
 * checked here because `AlarmsService.list` decodes it with no guard (a mangled
 * one throws a `SyntaxError` or reaches SQL as an invalid date). A key that is
 * not one the service encoded makes the whole cursor `COPILOT_TOOL_BAD_CURSOR`.
 */
export const alarmCursorKeySchema = z
  .string()
  .min(1)
  .max(256)
  .refine((raw) => {
    try {
      return alarmKeysetSchema.safeParse(JSON.parse(Buffer.from(raw, "base64url").toString("utf-8"))).success;
    } catch {
      return false;
    }
  });

export const COPILOT_ALARMS_ASSET_OR_LOCATION = "name assetId or locationId, not both";

/**
 * `list_alarms` — the alarms list (`AlarmsService.list`), one call per
 * organization with that organization's readable asset ids, so the service
 * never sees `assetIds: null`. An `assetId` is placed in an organization
 * first (`organizationOfAsset`).
 *
 * `F4.291` (ADR 0099 Amendment 9 E5): on `readPerOrganization`. A
 * `locationId` reads the caller's readable assets of that site's subtree; a
 * `cursor` carries the service's keyset cursor `(raised_at, id)` for the
 * organization it stopped in, so a page never repeats or skips an alarm.
 * `assetId` and `locationId` together are refused by the schema.
 *
 * `F4.291` PR 2 (E5(b); owner ruling P3): `severity` (a code), and a raised
 * range — `lastDays` (resolved on the turn's clock) or `from`/`to` (either
 * may be given alone), never both — passed to `AlarmsService.list` as
 * `raisedFrom` (inclusive) / `raisedTo` (exclusive). The range is checked
 * before any read.
 */
export const listAlarmsTool = defineReadTool({
  name: "list_alarms",
  description:
    `List alarms, newest first. state 'active' (default) or 'all'. Optional organizationId, assetId or ${LOCATION_ID_PHRASE} narrows the list; ` +
    "severity, and lastDays (1-31) or from/to (ISO instants) on the raised time, filter it. " +
    `Grouped by organization; truncated means there are more, with ${CURSOR_PHRASE}.`,
  schema: z
    .object({
      organizationId: z.string().uuid().optional(),
      assetId: z.string().uuid().optional(),
      locationId: z.string().uuid().optional(),
      state: z.enum(["active", "all"]).default("active"),
      severity: alarmSeverityCodeSchema.optional(),
      ...timeRangeFields,
      cursor: listCursorSchema.optional(),
    })
    .strict()
    .superRefine((args, issue) => {
      if (args.assetId !== undefined && args.locationId !== undefined) {
        issue.addIssue({ code: z.ZodIssueCode.custom, path: ["locationId"], message: COPILOT_ALARMS_ASSET_OR_LOCATION });
      }
      refineInstantRange(args, issue, {});
    }),
  async run(services, args, ctx) {
    const range = resolveInstantRange(args, ctx.now);
    if (!range.ok) return range;
    let organizationId = args.organizationId;
    if (args.assetId !== undefined) {
      const target = targetOrganizations(args.organizationId, ctx.allowedOrganizationIds);
      if (!target.ok) return target;
      const owner = await organizationOfAsset(services.access, ctx.user, target.ids, args.assetId);
      if (owner === null) return { ok: false, error: COPILOT_TOOL_RECORD_OUT_OF_SCOPE };
      organizationId = owner;
    }
    const scope = { organizationId, locationId: args.locationId, paging: { cursor: args.cursor, key: alarmCursorKeySchema } };
    return readPerOrganization(services, ctx, scope, async (organization, assetIds, room, resume) => {
      const page = parseStoredContract(
        alarmsListResponseSchema,
        await services.alarms.list({
          limit: room,
          assetIds: args.assetId !== undefined ? [args.assetId] : [...assetIds],
          state: args.state,
          organizationId: organization,
          ...(args.severity !== undefined ? { severity: args.severity } : {}),
          ...(range.from !== undefined ? { raisedFrom: range.from } : {}),
          ...(range.to !== undefined ? { raisedTo: range.to } : {}),
          ...(resume !== undefined ? { cursor: resume } : {}),
        }),
        "copilot_tools.list_alarms.page",
      );
      return page.nextCursor === null ? { items: page.items } : { items: page.items, more: true, nextKey: page.nextCursor };
    });
  },
});
