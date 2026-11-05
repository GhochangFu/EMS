import { adminPointKeyStatesListResponseSchema } from "@bms/shared";
import { z } from "zod";

import { parseStoredContract } from "../../common/parse-stored-contract";
import { defineReadTool } from "./copilot-read-tool";
import { COPILOT_TOOL_LIST_MAX_ITEMS } from "./copilot-tool-scope";

/** The refusal for anyone but the global admin (owner ruling Q1 of ADR 0088 Amendment 3: the admin list is theirs alone). */
export const COPILOT_POINT_KEY_STATES_ROLE_REFUSAL =
  "State labels are fleet-wide master data: only a global administrator can list or change them.";

/**
 * The rows one answer carries: the list tools' 25. A row is about 110 characters of JSON and at
 * most about 260 (a 128-character key, a 32-character label), so 25 stay inside the
 * 7,500-character result budget (`COPILOT_TOOL_RESULT_BUDGET_CHARS`) the cut at 8,000 would
 * otherwise break; a longer list says `truncated` (serialized first), and `pointKey` narrows it.
 */
export const POINT_KEY_STATES_TOOL_MAX_ITEMS = COPILOT_TOOL_LIST_MAX_ITEMS;

/**
 * `list_point_key_states` (`F4.309` PR 3, ADR 0099 Amendment 13 decision 3, ruling Q1) — every
 * state label (`bms.point_key_states`): which value of a switching point key reads as which label
 * and tone on the mimic and the state legend, with `seeded` (a `POINT_KEY_STATE_SEED` pair, which
 * is read-only). The model finds the id of a row to edit here.
 *
 * **The admin list's own read** (`PointKeyStatesAdminService.list`, `GET /admin/point-key-states`),
 * on its path and behind its own `requireGlobalAdmin`; the tool refuses any other role before the
 * call, so a tenant administrator's turn reads nothing. It reads only and writes no audit row (the
 * service's `list` writes none). A fleet vocabulary, so it names no organization.
 */
export const listPointKeyStatesTool = defineReadTool({
  name: "list_point_key_states",
  description:
    "List the fleet-wide state labels (id, pointKey, value, label, tone, seeded): which value of a switching point key " +
    "reads as which label and tone, ordered by point key then value. Global administrator only. A seeded row is " +
    "read-only: propose pointKeyState.update only for a row with seeded false. Optional pointKey narrows the list.",
  schema: z.object({ pointKey: z.string().min(1).max(128).optional() }).strict(),
  async run({ pointKeyStates }, args, ctx) {
    if (ctx.identity.role !== "admin") return { ok: false, error: COPILOT_POINT_KEY_STATES_ROLE_REFUSAL };
    const page = parseStoredContract(
      adminPointKeyStatesListResponseSchema,
      await pointKeyStates.list(ctx.user),
      "copilot_tools.list_point_key_states.page",
    );
    const rows = page.items
      .filter((item) => args.pointKey === undefined || item.pointKey === args.pointKey)
      // The service orders so too; the tool holds the order it states whatever the source.
      .sort((a, b) => (a.pointKey === b.pointKey ? a.value - b.value : a.pointKey < b.pointKey ? -1 : 1));
    return {
      ok: true,
      result: {
        // `F4.291` live check: `truncated` before the rows, so a cut can never take it.
        truncated: rows.length > POINT_KEY_STATES_TOOL_MAX_ITEMS,
        items: rows.slice(0, POINT_KEY_STATES_TOOL_MAX_ITEMS).map(({ id, pointKey, value, label, tone, seeded }) => ({
          id,
          pointKey,
          value,
          label,
          tone,
          seeded,
        })),
      },
      organizationIds: [],
    };
  },
});
