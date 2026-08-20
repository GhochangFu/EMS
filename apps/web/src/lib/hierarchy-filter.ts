/**
 * Whether the asset level's own dependency (`rtuId` if `"rtu"` is one of the
 * requested levels, `locationId` otherwise) is satisfied. A gateway-less
 * asset has no `rtuId` at all, so requiring one unconditionally would make
 * the asset level permanently unreachable on a screen that omits `"rtu"`
 * from `levels` — exactly Manual Entry's (F1.8) case.
 */
export function isAssetLevelReady(
  showRtu: boolean,
  selection: { locationId?: string; rtuId?: string },
): boolean {
  return showRtu ? Boolean(selection.rtuId) : Boolean(selection.locationId);
}
