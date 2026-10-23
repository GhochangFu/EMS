import { encodePointRef, pointValuesAtInstantResponseSchema } from "@bms/shared";
import { z } from "zod";

import { parseStoredContract } from "../../common/parse-stored-contract";
import { atInstantIsInRange, pointKeySchema } from "../../telemetry/telemetry.schema";
import { defineReadTool } from "./copilot-read-tool";
import { COPILOT_TOOL_RECORD_OUT_OF_SCOPE, organizationOfAsset } from "./copilot-tool-scope";

/** The most point keys one `get_values_at_instant` call names. */
export const COPILOT_AT_INSTANT_MAX_POINT_KEYS = 10;

export const COPILOT_TOOL_INSTANT_OUT_OF_RANGE =
  "That instant is outside the range this read accepts: not before 1970-01-01T00:00:00Z and not more than one day after now.";

/**
 * `get_values_at_instant` (`F4.274`) — `TelemetryService.pointValuesAt`, the
 * `GET /telemetry/points/at-instant` read: for each key, the last sample at or
 * before `at`. The instant is range-checked against the turn's clock (the
 * route's `atInstantIsInRange`), then the asset is placed, before any read.
 * The answer is the controller's shape, zipped back to the keys by position.
 */
export const getValuesAtInstantTool = defineReadTool({
  name: "get_values_at_instant",
  description: "Read each point key's last value at or before an instant (ISO 8601 with an offset) on one asset. No sample: time and value are null.",
  schema: z
    .object({
      assetId: z.string().uuid(),
      pointKeys: z.array(pointKeySchema).min(1).max(COPILOT_AT_INSTANT_MAX_POINT_KEYS),
      at: z.string().datetime({ offset: true }),
    })
    .strict(),
  async run({ access, telemetry }, args, ctx) {
    if (!atInstantIsInRange(args.at, ctx.now.getTime())) return { ok: false, error: COPILOT_TOOL_INSTANT_OUT_OF_RANGE };
    const organizationId = await organizationOfAsset(access, ctx.user, ctx.allowedOrganizationIds, args.assetId);
    if (organizationId === null) return { ok: false, error: COPILOT_TOOL_RECORD_OUT_OF_SCOPE };
    const values = await telemetry.pointValuesAt(
      args.pointKeys.map((pointKey) => ({ assetId: args.assetId, pointKey })),
      new Date(args.at),
    );
    const answer = parseStoredContract(
      pointValuesAtInstantResponseSchema,
      {
        at: args.at,
        items: args.pointKeys.map((pointKey, i) => ({
          pointRef: encodePointRef(args.assetId, pointKey),
          time: values[i]?.time ?? null,
          value: values[i]?.value ?? null,
          unit: values[i]?.unit ?? null,
        })),
      },
      "copilot_tools.get_values_at_instant.result",
    );
    return {
      ok: true,
      result: {
        organizationId,
        assetId: args.assetId,
        at: answer.at,
        items: answer.items.map((item, i) => ({ pointKey: args.pointKeys[i], time: item.time, value: item.value, unit: item.unit })),
      },
      organizationIds: [organizationId],
    };
  },
});
