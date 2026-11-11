import { adminAssetDomainDtoSchema, adminAssetDomainsListResponseSchema } from "@bms/shared/contracts";
import type { AdminAssetDomainDto, AdminAssetDomainsListResponse } from "@bms/shared";

import { adminFetch } from "./client";

/**
 * `E3.1` (ADR 0122 decision 2.4, rulings P8 and R4) — the global admin's read of the
 * asset domains and the write of one domain's work-order reference prefix, at
 * `/admin/vocabularies/asset-domains`. Refused to every role but `admin`.
 */
export async function fetchAdminAssetDomains(): Promise<AdminAssetDomainsListResponse> {
  return adminFetch("/admin/vocabularies/asset-domains", adminAssetDomainsListResponseSchema);
}

/** Sets a domain's prefix, or clears it with `null` (later tickets then read `GEN`). The body is the prefix only. */
export async function updateAssetDomainPrefix(code: string, workOrderPrefix: string | null): Promise<AdminAssetDomainDto> {
  return adminFetch(`/admin/vocabularies/asset-domains/${encodeURIComponent(code)}`, adminAssetDomainDtoSchema, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workOrderPrefix }),
  });
}
