import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";

import type { DashboardDto, UserRole } from "@bms/shared";

import { fetchAdminLocations } from "../../api/admin/locations";
import { createDashboard, fetchDashboard, fetchDashboards, putDashboardWidgets } from "../../api/dashboards";
import { apiErrorMessage } from "../../lib/api-error-message";
import { duplicatePayload, freeSlug, type DuplicateDashboardTarget } from "../../lib/dashboard-duplicate";
import { DashboardScopeFields, type DashboardScopeValue } from "./dashboard-scope-fields";

export type DuplicateDashboardDialogProps = {
  /** The dashboard being copied — a slug and the organization it is known to belong to, the same
   * two values every caller already holds (a list row, or the detail route's own params). */
  sourceSlug: string;
  sourceOrganizationId: string;
  role: UserRole;
  onClose: () => void;
};

/**
 * Raised when `POST /dashboards` succeeds but `PUT /:id/widgets` fails. Carries the created,
 * widget-less dashboard so the dialog can offer a way into the builder rather than a compensating
 * `DELETE` — plan §8 Unit 9 / §15 Q5: a visible half-made copy is recoverable, and a rollback that
 * can itself fail is a second failure path this row does not add.
 */
export class DuplicateWidgetsCopyFailure extends Error {
  readonly created: DashboardDto;

  constructor(created: DashboardDto, cause: unknown) {
    super(apiErrorMessage(cause));
    this.name = "DuplicateWidgetsCopyFailure";
    this.created = created;
  }
}

/**
 * `F3.1d` Unit 9 — duplicates a dashboard into a scope the caller may already write to (ADR 0047
 * Amendment 2 ruling 3). Composes Unit 4's pure `freeSlug`/`duplicatePayload`
 * (`lib/dashboard-duplicate.ts`) with the two live calls plan §8 Unit 9 specifies, in order:
 * `POST /dashboards`, then `PUT /:id/widgets` — it does not restate either rule.
 *
 * **The organization is never offered as a choice.** The copy always lands in the source's own
 * organization: `DashboardScopeFields` is fed a synthesized one-item organization list, the same
 * "nothing to choose" idiom `dashboard-builder-edit-page.tsx` uses, because a dashboard's tenant is
 * fixed at creation and `assertBoundPointsInOrganization` requires it to match the copied
 * bindings' own organization. The scope itself — organization-wide vs. a location within it — IS
 * a choice, restricted the same way the builder restricts it (`DashboardScopeFields` already reads
 * `canCreateOrganizationWideDashboard`).
 *
 * **Not atomic, and this dialog does not hide that.** If the widget copy fails, the dashboard
 * already created stays (`DuplicateWidgetsCopyFailure`). No compensating `DELETE` is issued — the
 * error renders inline, right here, with a link into the builder on the now-empty dashboard, so an
 * automatic navigate never carries the user away before they have read what happened.
 *
 * **A copy carries the source's bindings.** `0050` does not constrain a dashboard's bindings by
 * its scope, so a site dashboard copied into another site keeps the first site's points —
 * retargeting them is manual, and the warning below says so.
 */
export function DuplicateDashboardDialog({
  sourceSlug,
  sourceOrganizationId,
  role,
  onClose,
}: DuplicateDashboardDialogProps) {
  const navigate = useNavigate();

  const sourceQ = useQuery({
    queryKey: ["dashboards", "detail", sourceSlug, sourceOrganizationId],
    queryFn: () => fetchDashboard(sourceSlug, sourceOrganizationId),
  });
  const source = sourceQ.data;

  // Task 0.2: `DashboardsService.list` filters on `organizationId` only, and
  // `readableOrganizationIds` never narrows below it — so this pool is collision-complete for
  // the source's own organization, which is where the copy always lands.
  const siblingsQ = useQuery({
    queryKey: ["dashboards", "list", sourceOrganizationId],
    queryFn: () => fetchDashboards(sourceOrganizationId),
    enabled: source !== undefined,
  });

  const locationsQ = useQuery({
    queryKey: ["admin", "locations", "for-dashboard-duplicate", sourceOrganizationId],
    queryFn: () => fetchAdminLocations("true", sourceOrganizationId),
    enabled: source !== undefined,
  });

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [scope, setScope] = useState<DashboardScopeValue>({
    kind: "location",
    organizationId: sourceOrganizationId,
    locationId: "",
  });
  const [prefilled, setPrefilled] = useState(false);

  // Runs once, when both the source DTO and the sibling-slug pool have loaded — mirrors
  // `dashboard-builder-edit-page.tsx`'s own `useEffect(() => { if (dto) {...} }, [dto])` idiom.
  useEffect(() => {
    if (!source || !siblingsQ.data || prefilled) {
      return;
    }
    setName(`${source.name} (copy)`);
    setSlug(freeSlug(source.slug, siblingsQ.data.items.map((item) => item.slug)));
    setScope(
      source.locationId
        ? { kind: "location", organizationId: source.organizationId, locationId: source.locationId }
        : { kind: "organization", organizationId: source.organizationId },
    );
    setPrefilled(true);
  }, [source, siblingsQ.data, prefilled]);

  const duplicateM = useMutation({
    mutationFn: async (): Promise<DashboardDto> => {
      if (!source) {
        throw new Error("The source dashboard has not loaded yet");
      }
      const target: DuplicateDashboardTarget = {
        organizationId: source.organizationId,
        scope:
          scope.kind === "location"
            ? { locationId: scope.locationId, assetGroupId: null }
            : { locationId: null, assetGroupId: null },
        slug: slug.trim(),
        name: name.trim(),
      };
      const payload = duplicatePayload(source, target);
      const created = await createDashboard(payload.create);
      try {
        await putDashboardWidgets(created.id, payload.widgets);
      } catch (cause) {
        // The dashboard above already exists — deliberately not rolled back (plan §15 Q5).
        throw new DuplicateWidgetsCopyFailure(created, cause);
      }
      return created;
    },
    onSuccess: (created) => {
      onClose();
      navigate(`/admin/dashboards/${created.slug}?organizationId=${created.organizationId}`);
    },
  });

  const widgetsFailure = duplicateM.error instanceof DuplicateWidgetsCopyFailure ? duplicateM.error : null;
  const otherFailure = duplicateM.isError && !widgetsFailure ? apiErrorMessage(duplicateM.error) : null;

  const scopeChosen = scope.kind === "organization" ? scope.organizationId !== "" : scope.locationId !== "";
  const blocked = !source || name.trim() === "" || slug.trim() === "" || !scopeChosen || duplicateM.isPending;

  return (
    <div
      role="dialog"
      aria-label="Duplicate dashboard"
      className="space-y-3 rounded border border-gray-200 bg-white p-4"
    >
      <h2 className="text-sm font-semibold text-bms-ink">Duplicate dashboard</h2>

      <p className="rounded border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-900">
        This copy keeps every point binding from the source dashboard. If you place it in a
        different location, retarget each binding manually afterwards — duplicating does not move
        or re-map them.
      </p>

      {sourceQ.isLoading ? <p className="text-xs text-bms-muted">Loading the source dashboard…</p> : null}
      {sourceQ.isError ? (
        <p className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-800">
          {apiErrorMessage(sourceQ.error)}
        </p>
      ) : null}

      {source ? (
        <>
          <label className="block space-y-1 text-xs">
            <span className="font-semibold uppercase tracking-wide text-bms-muted">Name</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="w-full rounded border border-gray-200 px-2 py-1.5 text-xs"
            />
          </label>
          <label className="block space-y-1 text-xs">
            <span className="font-semibold uppercase tracking-wide text-bms-muted">Slug</span>
            <input
              value={slug}
              onChange={(event) => setSlug(event.target.value)}
              className="w-full rounded border border-gray-200 px-2 py-1.5 text-xs"
            />
          </label>

          <DashboardScopeFields
            role={role}
            value={scope}
            onChange={setScope}
            organizations={[{ id: source.organizationId, name: "This dashboard's organization" }]}
            locations={locationsQ.data?.items ?? []}
          />

          {widgetsFailure ? (
            <div className="space-y-1 rounded border border-red-200 bg-red-50 p-2 text-xs text-red-800">
              <p>
                &ldquo;{widgetsFailure.created.name}&rdquo; was created, but its widgets could not
                be copied: {widgetsFailure.message}
              </p>
              <Link
                to={`/admin/dashboards/${widgetsFailure.created.slug}?organizationId=${widgetsFailure.created.organizationId}`}
                onClick={onClose}
                className="font-semibold underline"
              >
                Open it in the builder to finish
              </Link>
            </div>
          ) : null}
          {otherFailure ? (
            <p className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-800">{otherFailure}</p>
          ) : null}

          <div className="flex items-center gap-2 pt-2">
            <button
              type="button"
              disabled={blocked}
              onClick={() => duplicateM.mutate()}
              className="rounded bg-bms-green px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
            >
              {duplicateM.isPending ? "Duplicating…" : "Duplicate"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-gray-300 px-3 py-1.5 text-xs font-semibold text-bms-ink"
            >
              Cancel
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
