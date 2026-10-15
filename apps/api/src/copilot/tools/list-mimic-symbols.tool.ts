import { mimicSymbolLibrariesResponseSchema } from "@bms/shared";
import { z } from "zod";

import { parseStoredContract } from "../../common/parse-stored-contract";
import { defineReadTool } from "./copilot-read-tool";
import { targetOrganizations } from "./copilot-tool-scope";
import { MIMIC_LAYOUT_PAGE_BUDGET } from "./get-mimic-layout.tool";

type SymbolRow = { readonly key: string; readonly label: string; readonly group: string };
type OrganizationLibraries = {
  organizationId: string;
  global: Array<{ code: string; label: string; retiredKeys: string[] }>;
  organization: Array<{ key: string; label: string; symbols: SymbolRow[] }>;
};

/**
 * `list_mimic_symbols` (`F3.87` PR 2, ADR 0099 Amendment 3 drafter choice 1,
 * plan D10) — the symbols a new unit may draw, per target organization:
 * the global libraries that are active and that the organization did not
 * switch off, and the organization's own active libraries with their active
 * symbols. Keys, labels and groups only — never a shape or an SVG body. The
 * global libraries' symbols are the bundle's, not stored: the tool names the
 * library and its retired keys.
 *
 * The result stays inside the same JSON budget as a `get_mimic_layout` page:
 * an organization library holds up to 500 symbols, so a full list would reach
 * the model cut mid-row. Symbols past the budget are dropped whole and
 * `truncated` says so; `organizationId` narrows the list.
 */
export const listMimicSymbolsTool = defineReadTool({
  name: "list_mimic_symbols",
  description:
    "List the symbol libraries a new mimic unit may draw from, per organization: the global libraries switched on " +
    "(with their retired keys), and the organization's own libraries with each active symbol's key, label and group. " +
    "Optional organizationId narrows the list; truncated means more symbols exist than were listed.",
  schema: z.object({ organizationId: z.string().uuid().optional() }).strict(),
  async run({ symbolLibraries }, args, ctx) {
    const target = targetOrganizations(args.organizationId, ctx.allowedOrganizationIds);
    if (!target.ok) return target;
    const organizations: OrganizationLibraries[] = [];
    let size = 0;
    let truncated = false;
    const fits = (value: unknown): boolean => {
      const added = JSON.stringify(value).length + 1;
      if (size + added > MIMIC_LAYOUT_PAGE_BUDGET) {
        truncated = true;
        return false;
      }
      size += added;
      return true;
    };
    for (const organizationId of target.ids) {
      const libraries = parseStoredContract(
        mimicSymbolLibrariesResponseSchema,
        await symbolLibraries.list(ctx.user, organizationId),
        "copilot_tools.list_mimic_symbols.page",
      );
      const entry: OrganizationLibraries = {
        organizationId,
        global: libraries.global
          .filter((library) => library.active && library.enabled)
          .map((library) => ({ code: library.code, label: library.label, retiredKeys: library.inactiveSymbolKeys })),
        organization: [],
      };
      if (!fits({ ...entry, organization: [] })) break;
      organizations.push(entry);
      for (const library of libraries.organization) {
        if (!library.active || library.organizationId !== organizationId) continue;
        const kept: OrganizationLibraries["organization"][number] = { key: library.key, label: library.label, symbols: [] };
        if (!fits(kept)) break;
        entry.organization.push(kept);
        for (const symbol of library.symbols) {
          if (!symbol.active) continue;
          const row = { key: symbol.key, label: symbol.label, group: symbol.group };
          if (!fits(row)) break;
          kept.symbols.push(row);
        }
      }
    }
    return { ok: true, result: { organizations, truncated }, organizationIds: organizations.map((entry) => entry.organizationId) };
  },
});
