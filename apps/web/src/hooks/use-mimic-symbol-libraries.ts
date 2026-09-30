import { useQuery } from "@tanstack/react-query";

import { fetchMimicSymbolLibraries } from "../api/mimic-symbol-libraries";

/** The catalog's cache key: one entry per organization, `"all"` for the unscoped read. */
export function mimicSymbolLibrariesQueryKey(organizationId?: string): readonly [string, string] {
  return ["mimic-symbol-libraries", organizationId ?? "all"];
}

/**
 * `F3.32f` slice 3 (ADR 0086 decisions 4 and 7) — the symbol-library catalog for one
 * organization, or for every organization the caller reads when `organizationId` is absent (the
 * attributions page). A caller that needs an organization and does not know it yet passes
 * `enabled: false`, so no unscoped read starts in its place.
 */
export function useMimicSymbolLibraries(organizationId?: string, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: mimicSymbolLibrariesQueryKey(organizationId),
    queryFn: () => fetchMimicSymbolLibraries(organizationId),
    enabled: options.enabled ?? true,
  });
}
