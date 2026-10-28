import { rulesResponseSchema } from "@bms/shared";
import { z } from "zod";

import { parseStoredContract } from "../../common/parse-stored-contract";
import { CURSOR_PHRASE, LOCATION_ID_PHRASE, listCursorSchema, offsetKeySchema, offsetPage, orderTiesById } from "./copilot-list-paging";
import { defineReadTool, readPerOrganization } from "./copilot-read-tool";

/**
 * `list_rules` (`F4.278`, ADR 0099 Amendment 8 D7) — the Rule Engine's rule list
 * (`RulesService.listRules`, the page's own read), one call per organization
 * with that organization's readable asset ids (`readPerOrganization`), so the
 * service never sees `null` (the whole fleet) or `[]`. Archived and disabled
 * rules are included, so a publish, enable or archive can name one. `search`
 * (name or code, case-insensitive) and `assetId` narrow each organization's rows
 * **before** the 25-item cap (the `F4.274` live-check rule). An asset-less
 * time-window rule is not listed for a scoped admin — the page's own `assetIds`
 * rule.
 *
 * `F4.291` (ADR 0099 Amendment 9 E5): `locationId` reads the rules of the
 * caller's readable assets of that site's subtree; `cursor` is an offset into
 * the filtered rows. The service orders by `enabled desc, category, name`,
 * which ties (two rules of one name), so a run of tied rows is put in id order
 * before the slice and a page never repeats or skips one.
 */
export const listRulesTool = defineReadTool({
  name: "list_rules",
  description:
    "List alarm rules (id, code, name, type, lifecycle, enabled, asset, point, operator, threshold). Archived and " +
    `disabled rules are included, so a publish, enable or archive can name one. Optional organizationId, ${LOCATION_ID_PHRASE}, ` +
    `search (name or code) and assetId narrow the list; truncated means there are more, with ${CURSOR_PHRASE}.`,
  schema: z
    .object({
      organizationId: z.string().uuid().optional(),
      locationId: z.string().uuid().optional(),
      search: z.string().min(1).max(64).optional(),
      assetId: z.string().uuid().optional(),
      cursor: listCursorSchema.optional(),
    })
    .strict(),
  async run(services, args, ctx) {
    const needle = args.search?.toLowerCase();
    const scope = { organizationId: args.organizationId, locationId: args.locationId, paging: { cursor: args.cursor, key: offsetKeySchema } };
    return readPerOrganization(services, ctx, scope, async (_organizationId, assetIds, room, resume) => {
      const page = parseStoredContract(
        rulesResponseSchema,
        await services.rules.listRules([...assetIds]),
        "copilot_tools.list_rules.page",
      );
      const matching = page.items.filter(
        (rule) =>
          (needle === undefined || rule.name.toLowerCase().includes(needle) || rule.code.toLowerCase().includes(needle)) &&
          (args.assetId === undefined || rule.assetId === args.assetId),
      );
      const ordered = orderTiesById(matching, (rule) => `${rule.enabled}\u0000${rule.category}\u0000${rule.name}`);
      const { items, ...rest } = offsetPage(ordered, resume, room);
      return {
        ...rest,
        items: items.map((rule) => ({
          id: rule.id,
          code: rule.code,
          name: rule.name,
          ruleType: rule.ruleType,
          lifecycleStatus: rule.lifecycleStatus,
          enabled: rule.enabled,
          assetId: rule.assetId,
          assetCode: rule.assetCode,
          pointKey: rule.pointKey,
          operator: rule.operator,
          thresholdValue: rule.thresholdValue,
          severity: rule.severity,
          clearHoldSeconds: rule.clearHoldSeconds,
          condition: rule.condition,
        })),
      };
    });
  },
});
