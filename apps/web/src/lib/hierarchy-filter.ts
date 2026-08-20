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

/**
 * The organization id `HierarchyFilterBar`'s location/RTU/asset levels must
 * key off. A locked org's `<select>` is `disabled`, so it never fires
 * `onChange` and `selection.organizationId` is never set for a scoped user —
 * every query gated on `selection.organizationId` directly would stay
 * disabled for the lifetime of their session.
 */
export function resolveEffectiveOrganizationId(
  orgLocked: boolean,
  selectionOrgId: string | undefined,
  lockedOrgId: string | undefined,
): string {
  if (selectionOrgId) {
    return selectionOrgId;
  }
  if (orgLocked && lockedOrgId) {
    return lockedOrgId;
  }
  return "";
}
