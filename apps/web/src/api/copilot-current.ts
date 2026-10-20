import { calcParameterDtoSchema, templatePointBodySchema } from "@bms/shared/contracts";
import type { CopilotPendingChangeDto } from "@bms/shared";
import { bodyFieldsOf, catalogEntry, catalogParamsOf } from "@bms/shared/copilot";

import { fetchAdminAssetCalcPoints, fetchAdminAssetPoints } from "./admin/asset-points";
import { fetchAdminAssetTemplate } from "./admin/asset-templates";
import { fetchAdminAssets } from "./admin/assets";
import { adminFetch } from "./admin/client";
import { fetchAdminDashboardTemplate } from "./admin/dashboard-templates";
import { fetchAdminLocations, fetchSiteControlRoomView } from "./admin/locations";
import { fetchAdminRtus } from "./admin/rtus";
import { fetchDashboards } from "./dashboards";
import { fetchMimicLayout } from "./mimic-layouts";

/** `F4.246`: a template point's write keys, derived once from the write schema — never a hand-typed list. */
const TEMPLATE_POINT_WRITE_KEYS = bodyFieldsOf(templatePointBodySchema);

const writeShapeOfPoint = (point: Readonly<Record<string, unknown>>): Record<string, unknown> =>
  Object.fromEntries(TEMPLATE_POINT_WRITE_KEYS.filter((key) => key in point).map((key) => [key, point[key]]));

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
    // `F4.246`: the version's detail read (the template page's own), as `updateAssetTemplateBodySchema`'s
    // six fields. Each point keeps exactly the write body's keys — the Points tab's round-trip rule —
    // so the DTO's `id`, `templateId` and `createdAt` never reach the Now column.
    case "assetTemplate.update": {
      const template = await fetchAdminAssetTemplate(params.id as string);
      return {
        name: template.name,
        assetType: template.assetType,
        domain: template.domain,
        description: template.description,
        content: template.content,
        points: template.points.map(writeShapeOfPoint),
      };
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
    // `F3.86` PR 3a review: the by-id reads answer a summary only; the list carries the
    // editable fields (the `dashboard.update` rule), read with inactive rows included.
    case "location.update": {
      const found = (await fetchAdminLocations("all")).items.find((item) => item.id === params.id);
      return found
        ? {
            code: found.code,
            slug: found.slug,
            name: found.name,
            type: found.type,
            parentId: found.parentId,
            province: found.province,
            capital: found.capital,
            latitude: found.latitude,
            longitude: found.longitude,
            timezone: found.timezone,
            meta: found.meta,
          }
        : null;
    }
    case "rtu.update": {
      const found = (await fetchAdminRtus("all")).items.find((item) => item.id === params.id);
      return found
        ? {
            code: found.code,
            displayName: found.displayName,
            sourceType: found.sourceType,
            domain: found.domain,
            externalRtuId: found.externalRtuId,
            rtuCode: found.rtuCode,
            mqttTopic: found.mqttTopic,
            stationCode: found.stationCode,
            stationName: found.stationName,
            ingestEnabled: found.ingestEnabled,
            meta: found.meta,
          }
        : null;
    }
    // `F3.86` PR 3b: the same rule — the asset summary carries no editable field, and no
    // by-id read of a point mapping exists; each list is read with inactive rows included.
    case "asset.update": {
      const found = (await fetchAdminAssets("all")).items.find((item) => item.id === params.id);
      return found
        ? {
            code: found.code,
            name: found.name,
            siteName: found.siteName,
            locationId: found.locationId,
            rtuId: found.rtuId,
            domain: found.domain,
            waterBalanceRole: found.waterBalanceRole,
            rating: found.rating,
            tripCause: found.tripCause,
            meta: found.meta,
          }
        : null;
    }
    case "assetPoint.update": {
      const found = (await fetchAdminAssetPoints("all")).items.find((item) => item.id === params.id);
      // What the row stores, never the template's effective value (`asset-point-form.ts`'s rule).
      return found
        ? {
            pointKey: found.pointKey,
            sourceDataKey: found.sourceDataKey,
            sensorCode: found.sensorCode,
            unit: found.unit,
            rtuId: found.rtuId,
            scaleMultiplier: found.scaleMultiplier,
            scaleOffset: found.scaleOffset,
            engMin: found.engMin,
            engMax: found.engMax,
            qualityPolicy: found.qualityPolicy,
          }
        : null;
    }
    // `F3.87` PR 5 / owner ruling Q5: the live version only, for the card's "Confirm will give 409"
    // note, and the organization whose symbols the preview draws. The node diff never reads it: it
    // reads the baseline the row stored at propose time.
    case "mimicLayout.replace": {
      const layout = await fetchMimicLayout(params.id as string);
      return { version: layout.version, organizationId: layout.organizationId };
    }
    default:
      return null;
  }
}
