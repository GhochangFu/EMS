import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";

import { fetchAdminAssetSummary } from "../../api/admin/assets";
import { fetchAdminLocationSummary } from "../../api/admin/locations";
import { fetchAdminOrganizationSummary } from "../../api/admin/organizations";
import { fetchAdminRtuSummary } from "../../api/admin/rtus";
import type { AuthUser } from "../../stores/auth-store";
import { Breadcrumb } from "../breadcrumb";

type AdminBreadcrumbProps = {
  user: AuthUser;
};

/** Renders hierarchy breadcrumb links from route params. */
export function AdminBreadcrumb({ user: _user }: AdminBreadcrumbProps) {
  const { orgId, locationId, rtuId, assetId } = useParams();

  const orgQ = useQuery({
    queryKey: ["admin", "organization-summary", orgId],
    queryFn: () => fetchAdminOrganizationSummary(orgId ?? ""),
    enabled: Boolean(orgId),
  });

  const locationQ = useQuery({
    queryKey: ["admin", "location-summary", locationId],
    queryFn: () => fetchAdminLocationSummary(locationId ?? ""),
    enabled: Boolean(locationId),
  });

  const rtuQ = useQuery({
    queryKey: ["admin", "rtu-summary", rtuId],
    queryFn: () => fetchAdminRtuSummary(rtuId ?? ""),
    enabled: Boolean(rtuId),
  });

  const assetQ = useQuery({
    queryKey: ["admin", "asset-summary", assetId],
    queryFn: () => fetchAdminAssetSummary(assetId ?? ""),
    enabled: Boolean(assetId),
  });

  const orgLabel =
    orgQ.data?.name ??
    locationQ.data?.organizationName ??
    rtuQ.data?.organizationCode ??
    assetQ.data?.organizationCode ??
    null;
  const resolvedOrgId =
    orgId ?? locationQ.data?.organizationId ?? rtuQ.data?.organizationId ?? assetQ.data?.organizationId;

  const crumbs: { label: string; to?: string }[] = [
    { label: "Organizations", to: "/admin/organizations" },
  ];

  if (resolvedOrgId && orgLabel) {
    crumbs.push({
      label: orgLabel,
      to: `/admin/organizations/${resolvedOrgId}/locations`,
    });
  }

  if (locationId && locationQ.data) {
    crumbs.push({
      label: locationQ.data.name,
      to: `/admin/locations/${locationId}/rtus`,
    });
  }

  if (locationId && rtuId && rtuQ.data) {
    crumbs.push({
      label: rtuQ.data.displayName,
      to: `/admin/locations/${locationId}/rtus/${rtuId}/assets`,
    });
  }

  if (assetId && assetQ.data) {
    crumbs.push({
      label: assetQ.data.name,
      to: `/admin/assets/${assetId}/points`,
    });
  }

  // F4.341 (ADR 0118 Amendment 1 A6): the one breadcrumb component.
  return <Breadcrumb steps={crumbs} />;
}
