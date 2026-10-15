import { assetRoleDtoSchema } from "@bms/shared";
import { z } from "zod";

import { parseStoredContract } from "../../common/parse-stored-contract";
import { defineReadTool } from "./copilot-read-tool";

/**
 * `list_asset_roles` (`F3.87` PR 2, plan D16, owner ruling Q4) — the active
 * unit roles a layout's units may bind by (`VocabulariesService.list`, which
 * serves active rows only). A fleet vocabulary, so it names no organization.
 * Before proposing a layout, the model checks each role it means to use here;
 * a missing one is offered as `assetRole.create` (the global admin) first.
 */
export const listAssetRolesTool = defineReadTool({
  name: "list_asset_roles",
  description:
    "List the active unit roles (code, label) a mimic layout's units bind assets by. A role that is not listed does not exist yet.",
  schema: z.object({}).strict(),
  async run({ vocabularies }) {
    // Only the role axis is read and checked; the other vocabularies never reach the model.
    const roles = parseStoredContract(z.array(assetRoleDtoSchema), (await vocabularies.list()).assetRoles, "copilot_tools.list_asset_roles.page");
    return {
      ok: true,
      result: { items: roles.filter((role) => role.active).map((role) => ({ code: role.code, label: role.label })) },
      organizationIds: [],
    };
  },
});
