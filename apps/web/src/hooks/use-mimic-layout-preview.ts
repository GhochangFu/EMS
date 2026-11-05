import { useQuery } from "@tanstack/react-query";

import { fetchMimicLayoutPreview } from "../api/mimic-layouts";
import { MIMIC_REFRESH_MS } from "./use-mimic-nodes";

/**
 * Every preview read of one layout, whatever the group: a save invalidates this prefix, so the
 * preview redraws the layout just saved (plan C8).
 */
export function mimicLayoutPreviewQueryKey(layoutId: string, groupId?: string) {
  return groupId === undefined
    ? (["mimic-layouts", layoutId, "preview"] as const)
    : (["mimic-layouts", layoutId, "preview", groupId] as const);
}

/**
 * `F4.308` (ADR 0081 Amendment 2, plan C8) — the editor's "Preview with site" read: the saved
 * layout bound to `groupId`, refetched every `MIMIC_REFRESH_MS` as a dashboard mimic is. No read
 * starts until a group is chosen.
 */
export function useMimicLayoutPreview(layoutId: string, groupId: string | null) {
  return useQuery({
    queryKey: mimicLayoutPreviewQueryKey(layoutId, groupId ?? ""),
    queryFn: () => fetchMimicLayoutPreview(layoutId, groupId ?? ""),
    enabled: groupId !== null,
    refetchInterval: MIMIC_REFRESH_MS,
  });
}
