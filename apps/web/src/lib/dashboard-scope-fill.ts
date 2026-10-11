import { scopeColumns, type ChosenScopeValue } from "./dashboard-scope";

const isId = (value: unknown): value is string => typeof value === "string" && value !== "";

/**
 * `F3.85` PR 9 review fix (C3) — the chosen scope a copilot `fill_step` of a dashboard wizard's
 * Scope step describes. The shell merges a fill over the form's values (`applyFill`), so `next`
 * still holds the columns of the scope the form had: a fill of `{ locationId: L }` onto a group
 * scope arrives as `{ locationId: L, assetGroupId: G }`. The kind is therefore read from the
 * column the fill CHANGED: a changed group id makes a group scope, a changed location id a
 * location scope (a group wins only when both changed), and two nulls the organization-wide
 * scope. A fill that changes neither keeps the kind. `organizationId` is taken when it is a
 * string (the create wizard's Scope step lists it; the edit wizard's does not).
 */
export function chosenScopeFromFill(current: ChosenScopeValue, next: Readonly<Record<string, unknown>>): ChosenScopeValue {
  const organizationId = typeof next.organizationId === "string" ? next.organizationId : current.organizationId;
  const before = scopeColumns(current);
  const groupChanged = next.assetGroupId !== before.assetGroupId;
  const locationChanged = next.locationId !== before.locationId;
  if (groupChanged && isId(next.assetGroupId)) {
    return { kind: "assetGroup", organizationId, assetGroupId: next.assetGroupId };
  }
  if (locationChanged && isId(next.locationId)) {
    return { kind: "location", organizationId, locationId: next.locationId };
  }
  if ((groupChanged || locationChanged) && next.locationId === null && next.assetGroupId === null) {
    return { kind: "organization", organizationId };
  }
  return { ...current, organizationId };
}
