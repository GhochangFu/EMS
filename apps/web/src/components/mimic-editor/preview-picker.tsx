import { useQuery } from "@tanstack/react-query";
import { useId } from "react";

import { adminAssetGroupsQueryKey, fetchAdminAssetGroups } from "../../api/admin/asset-groups";
import { fetchAdminLocations } from "../../api/admin/locations";

/** What the preview is bound to: a site, then one of its asset groups; `""` until chosen. */
export type PreviewChoice = { readonly locationId: string; readonly groupId: string };

export type MimicPreviewPickerProps = {
  /** The stored layout's organization; `null` for a new, unsaved layout (nothing to preview). */
  organizationId: string | null;
  /** `null` while the preview is off. */
  value: PreviewChoice | null;
  onChange: (next: PreviewChoice | null) => void;
};

/** The editor inspector's field classes. */
const FIELD = "mt-1 w-full surface-field px-2 py-1 text-xs font-normal";
const LABEL = "block text-xs font-semibold text-ink-muted";

/**
 * `F4.308` (ADR 0081 Amendment 2 decisions 6–7, plan C12) — the "Preview with site" control: the
 * toggle, a site picker over every active location of the layout's organization (owner ruling
 * Q2 (a)), then an asset group of that site. A new layout has no saved geometry to preview, so
 * its toggle is disabled and says why.
 */
export function MimicPreviewPicker({ organizationId, value, onChange }: MimicPreviewPickerProps) {
  const on = value !== null;
  const reasonId = useId();
  const locationId = value?.locationId ?? "";

  const locationsQ = useQuery({
    queryKey: ["admin", "locations", "true", organizationId ?? ""],
    queryFn: () => fetchAdminLocations("true", organizationId ?? undefined),
    enabled: on && organizationId !== null,
  });
  const groupsQ = useQuery({
    queryKey: adminAssetGroupsQueryKey(locationId),
    queryFn: () => fetchAdminAssetGroups(locationId),
    enabled: on && locationId !== "",
  });
  const groups = groupsQ.data?.items ?? [];

  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-xs text-ink">
        <input
          type="checkbox"
          checked={on}
          disabled={organizationId === null}
          aria-describedby={organizationId === null ? reasonId : undefined}
          onChange={() => onChange(on ? null : { locationId: "", groupId: "" })}
        />
        Preview with site
      </label>
      {organizationId === null ? (
        <p id={reasonId} className="text-xs text-ink-muted">
          Save the layout to preview it
        </p>
      ) : null}
      {on ? (
        <div className="grid grid-cols-2 gap-2">
          <label className={LABEL}>
            Site
            <select
              aria-label="Site"
              value={locationId}
              onChange={(event) => onChange({ locationId: event.target.value, groupId: "" })}
              className={FIELD}
            >
              <option value="">Select a site…</option>
              {(locationsQ.data?.items ?? []).map((location) => (
                <option key={location.id} value={location.id}>
                  {`${location.code} — ${location.name}`}
                </option>
              ))}
            </select>
          </label>
          {locationsQ.isError ? (
            <p role="alert" className="text-xs text-critical-ink">
              The sites could not be read.
            </p>
          ) : null}
          {locationId === "" ? null : groupsQ.isError ? (
            <p role="alert" className="text-xs text-critical-ink">
              The asset groups could not be read.
            </p>
          ) : groupsQ.isSuccess && groups.length === 0 ? (
            <p className="text-xs text-ink-muted">No asset group at this site</p>
          ) : (
            <label className={LABEL}>
              Asset group
              <select
                aria-label="Asset group"
                value={value?.groupId ?? ""}
                onChange={(event) => onChange({ locationId, groupId: event.target.value })}
                className={FIELD}
              >
                <option value="">Select an asset group…</option>
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {`${group.code} — ${group.name}`}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      ) : null}
    </div>
  );
}
