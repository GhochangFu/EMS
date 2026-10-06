import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import type { OrganizationsListResponse } from "@bms/shared";

import { fetchAdminOrganizations } from "../api/admin/organizations";

// One reference for "no data yet", so the effect below does not re-run on every render (F4.209 NO_ROWS).
const NO_ORGANIZATIONS: OrganizationsListResponse["items"] = [];

/**
 * `F4.212` — the organization choice the two mimic admin pages share (the layout editor and the
 * symbol libraries). One read of the active organizations under one query key, so the entry is
 * shared with any other admin page; one organization (an organization admin's own) is chosen
 * at once, several leave the choice to the user.
 */
export function useOrganizationChoice(): {
  organizations: OrganizationsListResponse["items"];
  organizationId: string;
  setOrganizationId: (id: string) => void;
} {
  const [organizationId, setOrganizationId] = useState("");

  const orgsQ = useQuery({
    queryKey: ["admin", "organizations", "true"],
    queryFn: () => fetchAdminOrganizations("true"),
  });
  const organizations = orgsQ.data?.items ?? NO_ORGANIZATIONS;

  // One organization (an organization admin's own) is the only choice; select it.
  useEffect(() => {
    const only = organizations.length === 1 ? organizations[0] : undefined;
    if (organizationId === "" && only !== undefined) {
      setOrganizationId(only.id);
    }
  }, [organizations, organizationId]);

  return { organizations, organizationId, setOrganizationId };
}
