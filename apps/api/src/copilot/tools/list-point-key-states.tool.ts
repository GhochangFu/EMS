import { adminPointKeyStatesListResponseSchema } from "@bms/shared";
import { z } from "zod";

import { parseStoredContract } from "../../common/parse-stored-contract";
import { defineReadTool, fitFleetListResult } from "./copilot-read-tool";

/** The refusal for anyone but the global admin (owner ruling Q1 of ADR 0088 Amendment 3: the admin list is theirs alone). */
export const COPILOT_POINT_KEY_STATES_ROLE_REFUSAL =
  "State labels are fleet-wide master data: only a global administrator can list or change them.";

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
 *
 * **Fit + filter** (owner ruling 2026-11-05, ADR 0099 Amendment 13): no fixed row cap. A row is
 * about 110 characters of JSON and was measured at about 296 with the longest key and label, and
 * escaping inflates it further (a `"` or `\` is two characters, a control character six), so the
 * answer keeps as many rows as fit the tool-result budget (`fitFleetListResult`, the
 * `fitListResult` loop) and says `truncated` — first, so the 8,000-character cut never takes it —
 * when rows were left out; `pointKey` narrows the list.
 */
export const listPointKeyStatesTool = defineReadTool({
  name: "list_point_key_states",
  description:
    "List the fleet-wide state labels (id, pointKey, value, label, tone, seeded): which value of a switching point key " +
    "reads as which label and tone, ordered by point key then value. Global administrator only. A seeded row is " +
    "read-only: propose pointKeyState.update only for a row with seeded false. The list can be truncated (truncated " +
    "true): then filter by pointKey to see one key's rows.",
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
    return fitFleetListResult(rows.map(({ id, pointKey, value, label, tone, seeded }) => ({ id, pointKey, value, label, tone, seeded })));
  },
});
