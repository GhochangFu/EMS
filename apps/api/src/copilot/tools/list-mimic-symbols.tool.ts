import { mimicSymbolLibrariesResponseSchema } from "@bms/shared";
import { z } from "zod";

import { parseStoredContract } from "../../common/parse-stored-contract";
import { defineReadTool } from "./copilot-read-tool";
import { targetOrganizations } from "./copilot-tool-scope";

/**
 * `list_mimic_symbols` (`F3.87` PR 2, ADR 0099 Amendment 3 drafter choice 1,
 * plan D10) — the symbols a new unit may draw, per target organization:
 * the global libraries that are active and that the organization did not
 * switch off, and the organization's own active libraries with their active
 * symbols. Keys, labels and groups only — never a shape or an SVG body. The
 * global libraries' symbols are the bundle's, not stored: the tool names the
 * library and its retired keys, and the model draws from `core` (and the
 * other chosen libraries) by the keys the system prompt and the editor use.
 */
export const listMimicSymbolsTool = defineReadTool({
  name: "list_mimic_symbols",
  description:
    "List the symbol libraries a new mimic unit may draw from, per organization: the global libraries switched on " +
    "(with their retired keys), and the organization's own libraries with each active symbol's key, label and group. " +
    "Optional organizationId narrows the list.",
  schema: z.object({ organizationId: z.string().uuid().optional() }).strict(),
  async run({ symbolLibraries }, args, ctx) {
    const target = targetOrganizations(args.organizationId, ctx.allowedOrganizationIds);
    if (!target.ok) return target;
    const organizations = [];
    for (const organizationId of target.ids) {
      const libraries = parseStoredContract(
        mimicSymbolLibrariesResponseSchema,
        await symbolLibraries.list(ctx.user, organizationId),
        "copilot_tools.list_mimic_symbols.page",
      );
      organizations.push({
        organizationId,
        global: libraries.global
          .filter((library) => library.active && library.enabled)
          .map((library) => ({ code: library.code, label: library.label, retiredKeys: library.inactiveSymbolKeys })),
        organization: libraries.organization
          .filter((library) => library.active && library.organizationId === organizationId)
          .map((library) => ({
            key: library.key,
            label: library.label,
            symbols: library.symbols
              .filter((symbol) => symbol.active)
              .map((symbol) => ({ key: symbol.key, label: symbol.label, group: symbol.group })),
          })),
      });
    }
    return { ok: true, result: { organizations }, organizationIds: [...target.ids] };
  },
});
