import type { AccessibleScope } from "@bms/shared";

/**
 * `F3.34` — the pure dashboard-scope model (ADR 0047 Amendment 5, plan §4.2). `F3.63` (Amendment
 * 6) added the fourth, read-only `asset` kind (plan §4.1).
 *
 * Before `F3.34` the `kind` switch was written nine times across the three callers — the create
 * page (2), the edit page (4) and the duplicate dialog (3); the fields component keeps its own
 * switches, which are the rendering — and the two callers that prefill from a stored dashboard
 * read it TWO-way — so an asset-group dashboard prefilled as "organization" and a rename or a
 * duplicate silently widened it to the whole tenant. The helpers here are the single place the
 * arms live; every caller composes them.
 *
 * `assetId` (ADR 0067) has no form representation: the instantiator is its only writer in this
 * app (`PATCH /dashboards/:id` accepts it for a direct caller). Before `F3.63` a stored
 * asset-scoped row prefilled as organization-wide — a false organization radio — and a rename sent
 * two nulls that the server merged onto the kept `assetId` (one axis, so the save succeeded
 * silently), while choosing a location or a group made two axes and a 400 (Amendment 6 §Q2).
 * `scopeFromDashboard` now returns the read-only `asset` kind for such a row; `scopePatch`
 * omits both scope columns for it, so a rename cannot touch them. `scopeForDuplicate` still folds an asset-scoped source to
 * `organization` — duplicating one never offers the `asset` kind, because the create path and the
 * dialog cannot write `assetId` (Amendment 6 §Q2, last sentence).
 */

/** The three kinds a form can choose. `scopeColumns`, the create page and the duplicate dialog's
 * state are all typed to this, not to `DashboardScopeValue` — so a create/duplicate body that
 * carries `assetId` is a compile error, not a runtime branch nobody tests (plan §4.1 point 3). */
export type ChosenScopeValue =
  | { kind: "organization"; organizationId: string }
  | { kind: "location"; organizationId: string; locationId: string }
  | { kind: "assetGroup"; organizationId: string; assetGroupId: string };

/** `asset` is ADR 0067's kind: prefilled from a stored row, never chosen on a form. */
export type DashboardScopeValue = ChosenScopeValue | { kind: "asset"; organizationId: string; assetId: string };

/** A pared-down asset-group row (`F3.34`; `organizationId` added `F3.63`). Defined here rather
 * than in `dashboard-scope-fields.tsx`, which re-exports it, so that `scopeAssetGroupOptions`
 * below does not import a component from a lib. */
export type ScopeAssetGroupOption = {
  readonly id: string;
  readonly name: string;
  readonly organizationId: string;
  readonly locationName: string | null;
};

/** A pared-down asset row — just enough to label the read-only `asset` scope line. */
export type ScopeAssetOption = { readonly id: string; readonly name: string };

/** Prefill from a stored dashboard. Four-way: an asset-scoped row (ADR 0067, `assetId` set) is
 * checked first and returns the read-only `asset` kind (Amendment 6 §Q2) — the merged-singularity
 * guard means a row never carries `assetId` alongside a location or a group, so checking it first
 * changes nothing for the other three arms. */
export function scopeFromDashboard(dto: {
  organizationId: string;
  locationId: string | null;
  assetGroupId: string | null;
  assetId: string | null;
}): DashboardScopeValue {
  if (dto.assetId) {
    return { kind: "asset", organizationId: dto.organizationId, assetId: dto.assetId };
  }
  if (dto.locationId) {
    return { kind: "location", organizationId: dto.organizationId, locationId: dto.locationId };
  }
  if (dto.assetGroupId) {
    return { kind: "assetGroup", organizationId: dto.organizationId, assetGroupId: dto.assetGroupId };
  }
  return { kind: "organization", organizationId: dto.organizationId };
}

/** Prefill for the DUPLICATE dialog. Three-way, unlike `scopeFromDashboard`: the dialog's state is
 * `ChosenScopeValue`, so an asset-scoped source folds to `organization` (Amendment 6 §Q2, last
 * sentence) — the fold is implicit here, since the function never reads `assetId` at all. */
export function scopeForDuplicate(dto: {
  organizationId: string;
  locationId: string | null;
  assetGroupId: string | null;
}): ChosenScopeValue {
  if (dto.locationId) {
    return { kind: "location", organizationId: dto.organizationId, locationId: dto.locationId };
  }
  if (dto.assetGroupId) {
    return { kind: "assetGroup", organizationId: dto.organizationId, assetGroupId: dto.assetGroupId };
  }
  return { kind: "organization", organizationId: dto.organizationId };
}

/** True when the chosen kind has its id filled — what enables Save / Create / Duplicate. An
 * `asset` value is chosen when its `assetId` is filled, which a stored row always has: it is
 * never rendered as a form the author fills in, so the empty case is unreachable from the UI. */
export function isScopeChosen(value: DashboardScopeValue): boolean {
  switch (value.kind) {
    case "organization":
      return value.organizationId !== "";
    case "location":
      return value.locationId !== "";
    case "assetGroup":
      return value.assetGroupId !== "";
    case "asset":
      return value.assetId !== "";
  }
}

/** True when the value's location or group is one the form OFFERS — present in the list the
 * caller was fed by `useDashboardScopeOptions`. The edit page composes this into its Save block
 * (`F3.63` review): an `asset_group_admin` or a `location_admin` can OPEN a dashboard scoped to a
 * group or a location it does not hold (the read is organization-wide), and the select then has
 * no matching option while `isScopeChosen` is still true — so a rename enabled Save and the
 * PATCH ended in the server's 404. `organization` and `asset` are always offered: neither is
 * chosen from a list. While a list is still loading its ids are absent, so Save waits for it —
 * that is the intended direction; the alternative reads an empty list as "anything goes". Typed
 * structurally, not to the fields component's option rows: this lib must not import a component. */
export function isScopeOffered(
  value: DashboardScopeValue,
  offered: { locations: readonly { id: string }[]; assetGroups: readonly { id: string }[] },
): boolean {
  switch (value.kind) {
    case "organization":
    case "asset":
      return true;
    case "location":
      return offered.locations.some((location) => location.id === value.locationId);
    case "assetGroup":
      return offered.assetGroups.some((group) => group.id === value.assetGroupId);
  }
}

/** The two scope columns a write body carries — exactly one non-null, or both null. Structurally
 * `DuplicateDashboardTarget["scope"]` (`dashboard-duplicate.ts`), so the dialog passes it through.
 * Parameter narrowed to `ChosenScopeValue` (`F3.63`, plan §4.1 point 1) — the body is otherwise
 * unchanged from `F3.34`. `scopePatch` below is the `DashboardScopeValue` caller for the edit
 * page, which must OMIT the columns for an asset-scoped row rather than send two nulls. */
export function scopeColumns(value: ChosenScopeValue): {
  locationId: string | null;
  assetGroupId: string | null;
} {
  switch (value.kind) {
    case "organization":
      return { locationId: null, assetGroupId: null };
    case "location":
      return { locationId: value.locationId, assetGroupId: null };
    case "assetGroup":
      return { locationId: null, assetGroupId: value.assetGroupId };
  }
}

/** The edit page's PATCH-body helper (`F3.63`, Amendment 6 §Q2). For the three chosen kinds it is
 * `scopeColumns`, spread; for `asset` it is `{}` — the keys are OMITTED, not sent as `null`, so a
 * rename of an asset-scoped dashboard cannot touch its stored `assetId`-only scope. */
export function scopePatch(value: DashboardScopeValue): Partial<{ locationId: string | null; assetGroupId: string | null }> {
  if (value.kind === "asset") {
    return {};
  }
  return scopeColumns(value);
}

/** Whether the CURRENT form value differs from the stored scope columns — the edit page's dirty
 * check. An `asset` value is never dirty: its scope cannot be edited from this form. */
export function scopeChanged(
  value: DashboardScopeValue,
  stored: { locationId: string | null; assetGroupId: string | null },
): boolean {
  if (value.kind === "asset") {
    return false;
  }
  const columns = scopeColumns(value);
  return columns.locationId !== stored.locationId || columns.assetGroupId !== stored.assetGroupId;
}

/** Maps `/auth/me`'s `scope.assetGroups` (`accessAssetGroupSchema`) to the fields component's
 * option shape, for `asset_group_admin` (`F3.63`, Amendment 6 §Q1 point 2) — the group list comes
 * from this scope, never from `GET /admin/asset-groups`, which stays refused for the role.
 * `locationName` is resolved from `scope.locations` by `locationId`, `null` when the location is
 * absent from that array. `organizationId`, when given, keeps only that organization's groups —
 * the edit page and the dialog narrow by the dashboard's own organization. */
export function scopeAssetGroupOptions(scope: AccessibleScope, organizationId?: string): ScopeAssetGroupOption[] {
  return scope.assetGroups
    .filter((group) => organizationId === undefined || group.organizationId === organizationId)
    .map((group) => {
      const location = scope.locations.find((candidate) => candidate.id === group.locationId);
      return {
        id: group.id,
        name: group.name,
        organizationId: group.organizationId,
        locationName: location ? location.name : null,
      };
    });
}
