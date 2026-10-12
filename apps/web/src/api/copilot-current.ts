import { calcParameterDtoSchema } from "@bms/shared/contracts";
import type { CopilotPendingChangeDto } from "@bms/shared";
import { catalogEntry, catalogParamsOf } from "@bms/shared/copilot";

import { fetchAdminAssetCalcPoints } from "./admin/asset-points";
import { adminFetch } from "./admin/client";
import { fetchAdminDashboardTemplate } from "./admin/dashboard-templates";
import { fetchSiteControlRoomView } from "./admin/locations";
import { fetchDashboards } from "./dashboards";

/**
 * `F3.85` PR 8 (plan §10.3, decision 4.9) — the record an edit card compares
 * with, read when the card renders: the values the change would replace.
 *
 * `null` for a create and for an entry with no body fields (there is nothing
 * to compare), and when the record cannot be found in the caller's read
 * scope. The card then shows the values it sends and no "before" column.
 * Each read goes through the route the record's own page uses, so it needs
 * no permission the page does not.
 */
export async function fetchCopilotCurrent(change: CopilotPendingChangeDto): Promise<Record<string, unknown> | null> {
  const entry = catalogEntry(change.catalogId);
  const params = entry ? catalogParamsOf(entry, change.path) : null;
  if (!entry || !params) return null;
  switch (entry.id) {
    case "dashboard.update": {
      // No by-id read exists; the list carries the editable fields.
      const found = (await fetchDashboards()).items.find((item) => item.id === params.id);
      return found
        ? {
            name: found.name,
            slug: found.slug,
            description: found.description,
            locationId: found.locationId,
            assetGroupId: found.assetGroupId,
            assetId: found.assetId,
          }
        : null;
    }
    case "dashboardTemplate.update": {
      const template = await fetchAdminDashboardTemplate(params.id as string);
      return { name: template.name, section: template.section, description: template.description, content: template.content };
    }
    case "calcParameter.update": {
      const parameter = await adminFetch(`/admin/calc-parameters/${encodeURIComponent(params.id as string)}`, calcParameterDtoSchema);
      return { value: parameter.value, effectiveFrom: parameter.effectiveFrom, effectiveTo: parameter.effectiveTo };
    }
    case "calcOverride.set": {
      const points = await fetchAdminAssetCalcPoints(params.assetId as string);
      const point = points.items.find((item) => item.pointKey === params.pointKey);
      return point ? { ...point.override } : null;
    }
    // `F3.86` PR 3d: the stored setting, through the route the locations page reads it with.
    case "location.controlRoomView.set": {
      const setting = await fetchSiteControlRoomView(params.id as string);
      return { kind: setting.kind, dashboardId: setting.dashboardId, builtinKey: setting.builtinKey };
    }
    default:
      return null;
  }
}
