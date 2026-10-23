import { systemStatusResponseSchema } from "@bms/shared";
import { z } from "zod";

import { parseStoredContract } from "../../common/parse-stored-contract";
import { defineReadTool } from "./copilot-read-tool";
import { targetOrganizations } from "./copilot-tool-scope";

/**
 * `get_system_status` (`F4.277`) — `SystemStatusService.read`, the body of
 * `GET /system/status` (open to every signed-in role). The queue and storage
 * states are platform state, the same for every caller (ADR 0075), and the
 * service probes Redis and the object store on every call, so the tool makes
 * **one** read over the union of the readable asset ids of the organizations
 * the turn may read — never `null`, which is the whole fleet. An empty union
 * still reads `[]` (no SQL): the platform components, `percent: null`.
 * `organizationIds` names the organizations that contributed an asset.
 */
export const getSystemStatusTool = defineReadTool({
  name: "get_system_status",
  description:
    "Read the system status: queue, storage and field-data states, one verdict (operational/degraded), and data quality, " +
    "the share of readable assets that reported in the last 150 s. Use for 'is ingest healthy?'. not_monitored: no MQTT asset in scope.",
  schema: z.object({ organizationId: z.string().uuid().optional() }).strict(),
  async run({ access, systemStatus }, args, ctx) {
    const target = targetOrganizations(args.organizationId, ctx.allowedOrganizationIds);
    if (!target.ok) return target;
    const assetIds = new Set<string>();
    const contributed: string[] = [];
    for (const organizationId of target.ids) {
      const readable = await access.readableAssetIdsInOrganization(ctx.user, organizationId);
      if (readable.length === 0) continue;
      contributed.push(organizationId);
      for (const id of readable) assetIds.add(id);
    }
    const status = parseStoredContract(
      systemStatusResponseSchema,
      await systemStatus.read([...assetIds]),
      "copilot_tools.get_system_status.result",
    );
    return { ok: true, result: { organizationIds: contributed, status }, organizationIds: contributed };
  },
});
