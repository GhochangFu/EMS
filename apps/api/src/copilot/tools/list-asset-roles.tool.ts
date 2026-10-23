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
 *
 * `F4.282`: an unlisted code is absent or retired. A retired code is taken, so
 * a create of it answers 409 at Confirm; it is reactivated
 * (`assetRole.reactivate`, whose resolver finds a retired row and refuses an
 * absent one), and only a refused reactivate means the role is absent.
 */
export const listAssetRolesTool = defineReadTool({
  name: "list_asset_roles",
  description:
    "List the active unit roles (code, label) a mimic layout's units bind assets by. A role that is not listed is absent " +
    "or retired: a global administrator proposes assetRole.reactivate for it first, and assetRole.create only if that is refused.",
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
