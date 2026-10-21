import type { DashboardDto } from "@bms/shared";

/**
 * The edit page of a dashboard — where a created dashboard lives from now on,
 * and (`F4.245`) where a renamed one moves to after a copilot slug fill is
 * saved. One declaration for both builder pages.
 */
export function editPath(dto: Pick<DashboardDto, "slug" | "organizationId">): string {
  return `/admin/dashboards/${dto.slug}?organizationId=${dto.organizationId}`;
}
