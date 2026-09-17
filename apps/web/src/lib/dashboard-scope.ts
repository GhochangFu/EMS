/**
 * `F3.34` — the pure dashboard-scope model (ADR 0047 Amendment 5, plan §4.2).
 *
 * Before this row the `kind` switch was written nine times across the three callers — the
 * create page (2), the edit page (4) and the duplicate dialog (3); the fields component keeps
 * its own switches, which are the rendering — and the two callers that prefill from a
 * stored dashboard read it TWO-way — so an asset-group dashboard prefilled as "organization"
 * and a rename or a duplicate silently widened it to the whole tenant. The three helpers here
 * are the single place the fourth arm lives; every caller composes them.
 *
 * `assetId` (ADR 0067) has no form representation: the instantiator is its only writer in this
 * app (`PATCH /dashboards/:id` accepts it for a direct caller), and an
 * asset-scoped row prefills as organization exactly as it did before this row (plan §10 Q2,
 * folded into `F3.63`).
 */

export type DashboardScopeValue =
  | { kind: "organization"; organizationId: string }
  | { kind: "location"; organizationId: string; locationId: string }
  | { kind: "assetGroup"; organizationId: string; assetGroupId: string };

/** Prefill from a stored dashboard. Three-way; an asset-scoped row (ADR 0067) has no form
 * representation and prefills as organization, exactly as before this row. */
export function scopeFromDashboard(dto: {
  organizationId: string;
  locationId: string | null;
  assetGroupId: string | null;
}): DashboardScopeValue {
  if (dto.locationId) {
    return { kind: "location", organizationId: dto.organizationId, locationId: dto.locationId };
  }
  if (dto.assetGroupId) {
    return { kind: "assetGroup", organizationId: dto.organizationId, assetGroupId: dto.assetGroupId };
  }
  return { kind: "organization", organizationId: dto.organizationId };
}

/** True when the chosen kind has its id filled — what enables Save / Create / Duplicate. */
export function isScopeChosen(value: DashboardScopeValue): boolean {
  switch (value.kind) {
    case "organization":
      return value.organizationId !== "";
    case "location":
      return value.locationId !== "";
    case "assetGroup":
      return value.assetGroupId !== "";
  }
}

/** The two scope columns a write body carries — exactly one non-null, or both null. Structurally
 * `DuplicateDashboardTarget["scope"]` (`dashboard-duplicate.ts`), so the dialog passes it through. */
export function scopeColumns(value: DashboardScopeValue): {
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
