import { NotFoundException } from "@nestjs/common";

import { alarmDetailsResponseSchema } from "@bms/shared";
import { z } from "zod";

import { parseStoredContract } from "../../common/parse-stored-contract";
import { cutToBound } from "../../common/text-bounds";
import { TOOL_RESULT_MAX_CHARS } from "../../llm/tool-result";
import { defineReadTool } from "./copilot-read-tool";
import { COPILOT_TOOL_LIST_MAX_ITEMS, COPILOT_TOOL_RECORD_OUT_OF_SCOPE } from "./copilot-tool-scope";

/** The most affected assets one answer names (the DTO's one unbounded list). */
export const COPILOT_ALARM_AFFECTED_ASSETS_MAX = COPILOT_TOOL_LIST_MAX_ITEMS;

/**
 * The JSON budget of one details result, below `TOOL_RESULT_MAX_CHARS` by the
 * turn's wrapping room (as `COPILOT_ALARM_KB_BUDGET`). The enrichment's six
 * texts and the philosophy's three are each authored up to 2,000 characters,
 * so each is cut to a fixed length (`textCut` says one was) and the affected
 * assets give way after that.
 */
export const COPILOT_ALARM_DETAILS_BUDGET = TOOL_RESULT_MAX_CHARS - 1_500;
const PHILOSOPHY_TEXT_MAX = 800;
const ENRICHMENT_TEXT_MAX = 400;
const ALARM_MESSAGE_MAX = 500;

const OUT_OF_SCOPE = { ok: false, error: COPILOT_TOOL_RECORD_OUT_OF_SCOPE } as const;

/**
 * `get_alarm_details` (`F4.276`) — `AlarmDetailsService.get`, the body of
 * `GET /alarms/:id/details`. An alarm id names no organization, so the tool
 * reads the caller's readable asset ids in each allowed organization, makes
 * **one** read over their union (never `null`, the whole fleet; an empty union
 * is refused with no read), and then checks that the organization the answer
 * names is the one that placed its asset — a disagreement is refused, so the
 * check fails closed. The service's "not found" is the one refusal; any other
 * failure is the tool's error. `rulePointKey` is the join key for
 * `get_recent_values`.
 */
export const getAlarmDetailsTool = defineReadTool({
  name: "get_alarm_details",
  description:
    "Read one alarm by id: asset, severity, message, state, rule threshold and current value, enrichment, class philosophy, " +
    "rulePointKey for get_recent_values. Take alarmId from list_alarms.",
  schema: z.object({ alarmId: z.string().uuid() }).strict(),
  async run({ access, alarmDetails }, args, ctx) {
    const placed = new Map<string, string>();
    for (const organizationId of ctx.allowedOrganizationIds) {
      for (const assetId of await access.readableAssetIdsInOrganization(ctx.user, organizationId)) {
        if (!placed.has(assetId)) placed.set(assetId, organizationId);
      }
    }
    if (placed.size === 0) return OUT_OF_SCOPE;
    let stored;
    try {
      stored = await alarmDetails.get(args.alarmId, [...placed.keys()]);
    } catch (error) {
      if (error instanceof NotFoundException) return OUT_OF_SCOPE;
      throw error;
    }
    const dto = parseStoredContract(alarmDetailsResponseSchema, stored, "copilot_tools.get_alarm_details.result");
    const organizationId = placed.get(dto.assetId);
    if (organizationId === undefined || organizationId !== dto.organizationId) return OUT_OF_SCOPE;
    let textCut = false;
    const cut = (value: string | null, max: number): string | null => {
      if (value === null || value.length <= max) return value;
      textCut = true;
      return cutToBound(value, max);
    };
    const { enrichment, classPhilosophy, ...head } = dto;
    const affected = enrichment?.affectedAssets ?? [];
    let affectedAssetsTruncated = affected.length > COPILOT_ALARM_AFFECTED_ASSETS_MAX;
    const kept = affected.slice(0, COPILOT_ALARM_AFFECTED_ASSETS_MAX);
    // The class philosophy (the "what to check") is placed before the
    // enrichment, so a backstop cut by `toolResultContent` loses it last.
    const alarm = {
      ...head,
      message: cut(head.message, ALARM_MESSAGE_MAX) ?? head.message,
      classPhilosophy:
        classPhilosophy === null
          ? null
          : {
              ...classPhilosophy,
              cause: cut(classPhilosophy.cause, PHILOSOPHY_TEXT_MAX),
              impact: cut(classPhilosophy.impact, PHILOSOPHY_TEXT_MAX),
              action: cut(classPhilosophy.action, PHILOSOPHY_TEXT_MAX),
            },
      enrichment:
        enrichment === null
          ? null
          : {
              ...enrichment,
              rootCause: cut(enrichment.rootCause, ENRICHMENT_TEXT_MAX),
              impact: cut(enrichment.impact, ENRICHMENT_TEXT_MAX),
              correctiveActions: cut(enrichment.correctiveActions, ENRICHMENT_TEXT_MAX),
              energyImpact: cut(enrichment.energyImpact, ENRICHMENT_TEXT_MAX),
              waterImpact: cut(enrichment.waterImpact, ENRICHMENT_TEXT_MAX),
              productionImpact: cut(enrichment.productionImpact, ENRICHMENT_TEXT_MAX),
              affectedAssets: kept,
            },
    };
    const result = () => ({ organizationId, affectedAssetsTruncated, textCut, alarm });
    // Every field at its cut can still pass the budget with 25 long asset
    // names: drop affected assets from the end until the result fits.
    while (kept.length > 0 && JSON.stringify(result()).length > COPILOT_ALARM_DETAILS_BUDGET) {
      kept.pop();
      affectedAssetsTruncated = true;
    }
    return { ok: true, result: result(), organizationIds: [organizationId] };
  },
});
