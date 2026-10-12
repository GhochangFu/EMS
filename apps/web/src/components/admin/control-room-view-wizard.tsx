import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useMemo, useState } from "react";
import type { AdminLocationDto, PutSiteControlRoomViewBody } from "@bms/shared";
import { type CatalogEntry, catalogEntry } from "@bms/shared/copilot";

import { adminAssetGroupsQueryKey, fetchAdminAssetGroups } from "../../api/admin/asset-groups";
import { fetchSiteControlRoomView, putSiteControlRoomView } from "../../api/admin/locations";
import { fetchDashboards } from "../../api/dashboards";
import { apiErrorMessage } from "../../lib/api-error-message";
import {
  isEligibleSiteViewDashboard,
  siteViewDraftChanged,
  siteViewDraftFromSetting,
  siteViewPayloadFromDraft,
  type SiteViewDraft,
} from "../../lib/site-control-room-view";
import { WizardShell } from "../wizard/wizard-shell";
import { ControlRoomViewField } from "./control-room-view-field";

/** The catalog entry, or a build defect (the `calc-parameters-page.tsx` rule). */
function wizardEntry(id: string): CatalogEntry {
  const entry = catalogEntry(id);
  if (!entry) throw new Error(`F3.86: the catalog has no entry "${id}"`);
  return entry;
}

/**
 * A draft as the wizard's values: the `PUT` body (`siteViewPayloadFromDraft`).
 * A `dashboard` draft with no dashboard chosen yet is `{ kind: "dashboard" }`,
 * so Review shows the schema's own sentence ("A dashboard view needs a
 * dashboardId") instead of the wizard throwing on render.
 */
function bodyOf(draft: SiteViewDraft): Record<string, unknown> {
  if (draft.kind === "dashboard" && !draft.dashboardId) return { kind: "dashboard" };
  return siteViewPayloadFromDraft(draft);
}

/** Values from outside the field (a copilot `fill_step`) as a draft. */
function draftOf(values: Record<string, unknown>, fallback: SiteViewDraft): SiteViewDraft {
  const kind = values.kind;
  if (kind !== "generated" && kind !== "dashboard" && kind !== "builtin") return fallback;
  return { kind, dashboardId: kind === "dashboard" && typeof values.dashboardId === "string" ? values.dashboardId : null };
}

type ControlRoomViewWizardProps = {
  location: Pick<AdminLocationDto, "id" | "name" | "organizationId">;
  /** Plan OQ1/OQ3 — only the global `admin` may set a built-in view or replace one. */
  canSetBuiltin: boolean;
  onClose: () => void;
};

/**
 * `F3.86` PR 3d (ADR 0099 decision 6, ruling Q7(b), plan §5.5) — a site's
 * Control Room view is the `location.controlRoomView.set` stepper: View, then
 * Review with the stored setting as Now. It left the location Edit form, whose
 * Save sent a second write; one wizard is one write. The inputs are
 * `ControlRoomViewField`, unchanged, and its three reads moved here from the
 * locations page.
 *
 * A non-admin over a stored built-in view sees it read-only and is offered no
 * Submit: the route answers 403 to any body from that role (OQ3). Submit sends
 * the plain `PUT`, with no `X-Copilot-Change` header — and only for a changed
 * view: an unchanged one (untouched, or changed back) closes the wizard with no
 * request, as the Edit form's Save did.
 */
export function ControlRoomViewWizard({ location, canSetBuiltin, onClose }: ControlRoomViewWizardProps) {
  const queryClient = useQueryClient();
  /** `null` until the admin touches the field: an untouched field shows the stored setting. */
  const [draft, setDraft] = useState<SiteViewDraft | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The setting's key sits under `["admin", "locations"]`, so the page's own invalidations reach it.
  const viewQ = useQuery({
    queryKey: ["admin", "locations", location.id, "control-room-view"],
    queryFn: () => fetchSiteControlRoomView(location.id),
  });
  const dashboardsQ = useQuery({
    queryKey: ["dashboards", "list", location.organizationId],
    queryFn: () => fetchDashboards(location.organizationId),
  });
  const groupsQ = useQuery({
    queryKey: adminAssetGroupsQueryKey(location.id),
    queryFn: () => fetchAdminAssetGroups(location.id),
  });
  const stored = viewQ.data ? siteViewDraftFromSetting(viewQ.data) : null;
  const eligibleDashboards = useMemo(() => {
    const groupIds = new Set(
      (groupsQ.data?.items ?? []).filter((group) => group.locationId === location.id).map((group) => group.id),
    );
    return (dashboardsQ.data?.items ?? []).filter((dashboard) =>
      isEligibleSiteViewDashboard(dashboard, location.id, groupIds),
    );
  }, [location.id, dashboardsQ.data?.items, groupsQ.data?.items]);

  const putM = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      putSiteControlRoomView(location.id, body as PutSiteControlRoomViewBody),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin", "locations"] }),
        queryClient.invalidateQueries({ queryKey: ["control-room", "site-view", location.id] }),
      ]);
      onClose();
    },
    onError: (cause: unknown) => setError(apiErrorMessage(cause)),
  });

  const entry = wizardEntry("location.controlRoomView.set");
  const field = (value: SiteViewDraft, onChange: (next: SiteViewDraft) => void, storedView: SiteViewDraft) => (
    <ControlRoomViewField
      value={value}
      onChange={onChange}
      dashboards={eligibleDashboards}
      dashboardsLoaded={!dashboardsQ.isPending && !groupsQ.isPending}
      touched={draft !== null}
      stored={storedView}
      canSetBuiltin={canSetBuiltin}
    />
  );

  let content: ReactNode;
  if (stored === null) {
    content = (
      <p className="text-xs text-ink-muted">
        {viewQ.isError ? "The Control Room view could not be loaded." : "Loading the Control Room view…"}
      </p>
    );
  } else if (stored.kind === "builtin" && !canSetBuiltin) {
    content = (
      <>
        {field(stored, () => undefined, stored)}
        <p className="text-xs text-ink-muted">Only the global administrator can change a built-in view.</p>
        <div className="flex justify-end">
          <button type="button" onClick={onClose} className="surface-button px-3 py-1.5">
            Close
          </button>
        </div>
      </>
    );
  } else {
    const storedView = stored;
    const values = bodyOf(draft ?? storedView);
    content = (
      <WizardShell
        entry={wizardEntry("location.controlRoomView.set")}
        values={values}
        onChange={(next) => {
          setError(null);
          setDraft(draftOf(next, draft ?? storedView));
        }}
        renderStep={() =>
          field(draft ?? storedView, (next) => {
            setError(null);
            setDraft(next);
          }, storedView)
        }
        onSubmit={(body) => {
          // An unchanged view is not put: a `generated` PUT stores a view row, and any row makes
          // the site's "Make site layout" answer 409 (`site-layout.service.ts`, `has_view`).
          if (!siteViewDraftChanged(storedView, draft ?? storedView)) {
            onClose();
            return;
          }
          putM.mutate(body);
        }}
        onCancel={onClose}
        submitting={putM.isPending}
        submitError={error}
        current={bodyOf(storedView)}
        summary={entry.summary({ body: values, params: { id: location.id }, targetName: location.name, organizationName: "" })}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/40 p-4">
      <div role="dialog" aria-labelledby="control-room-view-wizard-title" className="w-full max-w-lg space-y-3 surface-dialog p-4">
        <h2 id="control-room-view-wizard-title" className="font-condensed text-lg font-bold">
          {entry.title}: {location.name}
        </h2>
        {content}
      </div>
    </div>
  );
}
