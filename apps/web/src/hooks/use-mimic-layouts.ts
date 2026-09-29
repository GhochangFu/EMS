import { useQuery } from "@tanstack/react-query";

import { fetchMimicLayouts } from "../api/mimic-layouts";

/**
 * `F3.32c` U5 (ADR 0081, plan D1) — the organization's mimic layout library, read once and
 * cached under one key: every caller (the builder's Layout select today, the editor's library
 * page in U6) shares the one list rather than each issuing its own `GET /mimic-layouts`.
 *
 * No `organizationId` parameter — `GET /api/v1/mimic-layouts` org-filters from the session
 * itself (plan §3 route table), so there is no narrower key to keep separate per caller.
 */
export function useMimicLayouts() {
  return useQuery({ queryKey: ["mimic-layouts"], queryFn: fetchMimicLayouts });
}
