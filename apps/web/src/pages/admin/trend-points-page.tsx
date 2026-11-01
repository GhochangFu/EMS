import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { AdminPointKeyDto, TrendPointSegmentDto } from "@bms/shared";
import { TREND_POINTS_PER_SEGMENT_MAX } from "@bms/shared/contracts";

import { fetchAdminOrganizations } from "../../api/admin/organizations";
import { fetchAdminPointKeys } from "../../api/admin/point-keys";
import { fetchOrgTrendPoints, putOrgTrendPointSegment } from "../../api/admin/trend-points";
import { MasterDataLayout } from "../../components/admin/master-data-layout";
import { PageHeader } from "../../components/page-header";
import { SectionCard } from "../../components/section-card";
import { StatusPill } from "../../components/status-pill";
import { canEditTrendPoints } from "../../lib/admin-access";
import { apiErrorMessage } from "../../lib/api-error-message";
import type { AuthUser } from "../../stores/auth-store";

type TrendPointsAdminPageProps = { user: AuthUser };

/** The organizations list the Locations page reads; one cache entry for both screens. */
const ORGANIZATIONS_KEY = ["admin", "organizations", "all"] as const;
/** This page's own read of the active point-key catalog, the source of every Add picker. */
const CATALOG_KEY = ["admin", "trend-points", "catalog"] as const;

function trendPointsKey(organizationId: string) {
  return ["admin", "trend-points", "organization", organizationId] as const;
}

/**
 * `F4.300` (ADR 0108 decision 3, plan C3/C4/C10) — the organization-level
 * screen for the key trend points of each segment.
 *
 * A segment is a `bms.asset_domains` row, read from the DTO: the page names no
 * segment of its own, so a segment the catalog gains later appears here with no
 * release. Each card edits one segment's list for the chosen organization; Save
 * replaces the list (`PUT …/trend-points/:domain`), and "Reset to catalog" sends
 * an empty list, which removes the override so the catalog default applies.
 *
 * **It fails closed at the page.** The tab is hidden from every role but `admin`
 * and `organization_admin`, but a typed URL still reaches this route through
 * `AdminRoute`, which admits every master-data role. For the others the page
 * renders one status line and mounts no query (the API would answer 403 anyway).
 */
export function TrendPointsAdminPage({ user }: TrendPointsAdminPageProps) {
  return (
    <MasterDataLayout user={user}>
      <PageHeader
        eyebrow="Administration"
        title="Trend Points"
        subtitle="The key trend points of each segment, per organization"
      />
      {canEditTrendPoints(user.role) ? (
        <TrendPointsEditor />
      ) : (
        <p role="status" className="text-sm text-ink-muted">
          Trend points are set by an organization administrator or a global administrator.
        </p>
      )}
    </MasterDataLayout>
  );
}

function TrendPointsEditor() {
  const [chosen, setChosen] = useState<string>("");

  const orgsQ = useQuery({
    queryKey: ORGANIZATIONS_KEY,
    queryFn: () => fetchAdminOrganizations("all"),
  });
  const organizations = orgsQ.data?.items ?? [];
  // A scoped administrator's list holds only its own organizations; the first is the default.
  const organizationId = chosen || organizations[0]?.id || "";

  const trendQ = useQuery({
    queryKey: trendPointsKey(organizationId),
    queryFn: () => fetchOrgTrendPoints(organizationId),
    enabled: organizationId !== "",
  });

  const catalogQ = useQuery({
    queryKey: CATALOG_KEY,
    queryFn: () => fetchAdminPointKeys("true"),
  });
  const catalog = catalogQ.data?.items ?? [];

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="trend-points-organization" className="block text-xs font-semibold text-ink-muted">
          Organization
        </label>
        <select
          id="trend-points-organization"
          className="mt-1 surface-field px-3 py-2 text-sm"
          value={organizationId}
          onChange={(event) => setChosen(event.target.value)}
        >
          {organizations.map((organization) => (
            <option key={organization.id} value={organization.id}>
              {organization.code} — {organization.name}
            </option>
          ))}
        </select>
      </div>

      {orgsQ.isError ? (
        <p role="alert" className="text-sm text-critical-ink">
          {apiErrorMessage(orgsQ.error)}
        </p>
      ) : null}
      {trendQ.isError ? (
        <p role="alert" className="text-sm text-critical-ink">
          {apiErrorMessage(trendQ.error)}
        </p>
      ) : null}

      {trendQ.data
        ? trendQ.data.segments.map((segment) => (
            <SegmentCard
              // A new organization or a saved list starts the draft again from the server.
              key={`${organizationId}:${segment.domain}:${segment.source}:${segment.updatedAt ?? ""}`}
              organizationId={organizationId}
              segment={segment}
              catalog={catalog.filter((item) => item.domain === segment.domain)}
              otherCatalog={catalog.filter((item) => item.domain !== segment.domain)}
            />
          ))
        : null}
    </div>
  );
}

type SegmentCardProps = {
  organizationId: string;
  segment: TrendPointSegmentDto;
  /** The active catalog codes of this segment's domain. */
  catalog: readonly AdminPointKeyDto[];
  /**
   * The active catalog codes filed under any other domain. ADR 0108 decision
   * 3.4 takes any catalog code in a segment's list, and `F4.300` U4c (owner
   * ruling 2026-11-01) needs it: Electrical keeps `load_pct` and `battery_v`
   * for a DG set after those codes moved to the `ups` segment.
   */
  otherCatalog: readonly AdminPointKeyDto[];
};

function SegmentCard({ organizationId, segment, catalog, otherCatalog }: SegmentCardProps) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<string[]>(() => segment.points.map((item) => item.code));
  const [pick, setPick] = useState("");
  const [error, setError] = useState<string | null>(null);

  const names = new Map<string, string>();
  for (const item of [...otherCatalog, ...segment.catalogDefaults, ...segment.points, ...catalog]) {
    names.set(item.code, item.name);
  }
  const addable = catalog.filter((item) => !draft.includes(item.code));
  const addableElsewhere = otherCatalog.filter((item) => !draft.includes(item.code));
  const pickerId = `trend-points-add-${segment.domain}`;

  async function refresh(): Promise<void> {
    setError(null);
    await queryClient.invalidateQueries({ queryKey: trendPointsKey(organizationId) });
  }

  const saveM = useMutation({
    mutationFn: (pointKeys: readonly string[]) =>
      putOrgTrendPointSegment(organizationId, segment.domain, pointKeys),
    onSuccess: refresh,
    onError: (err: unknown) => setError(apiErrorMessage(err)),
  });

  const resetM = useMutation({
    mutationFn: () => putOrgTrendPointSegment(organizationId, segment.domain, []),
    onSuccess: refresh,
    onError: (err: unknown) => setError(apiErrorMessage(err)),
  });

  function move(index: number, by: -1 | 1): void {
    const target = index + by;
    if (target < 0 || target >= draft.length) return;
    const next = [...draft];
    [next[index], next[target]] = [next[target] as string, next[index] as string];
    setDraft(next);
  }

  function add(): void {
    if (pick === "" || draft.includes(pick) || draft.length >= TREND_POINTS_PER_SEGMENT_MAX) return;
    setDraft([...draft, pick]);
    setPick("");
  }

  const isOrganization = segment.source === "organization";
  // An unchanged catalog card has nothing to save: a Save would pin today's
  // catalog list as an override, and later catalog changes would stop
  // reaching this organization (review finding 4).
  const unchangedCatalog =
    !isOrganization &&
    draft.length === segment.points.length &&
    draft.every((code, index) => code === segment.points[index]?.code);

  return (
    <div data-segment={segment.domain}>
      <SectionCard
        title={segment.label}
        subtitle={
          isOrganization && segment.catalogDefaults.length > 0
            ? `Catalog default: ${segment.catalogDefaults.map((item) => item.code).join(", ")}`
            : undefined
        }
        actions={
          <StatusPill
            label={isOrganization ? "Organization" : "Catalog default"}
            tone={isOrganization ? "info" : "offline"}
          />
        }
        bodyClassName="p-3 space-y-3"
      >
        {draft.length === 0 ? (
          <p className="text-sm text-ink-muted">No trend points in this segment.</p>
        ) : (
          <ol className="space-y-1">
            {draft.map((code, index) => (
              <li key={code} className="flex items-center justify-between gap-3 text-sm">
                <span>
                  <span className="font-mono">{code}</span>
                  {names.has(code) ? <span className="ml-2 text-ink-muted">{names.get(code)}</span> : null}
                </span>
                <span className="flex gap-2">
                  <button
                    type="button"
                    className="text-xs font-semibold text-accent-strong disabled:opacity-60"
                    aria-label={`Move ${code} up`}
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    Up
                  </button>
                  <button
                    type="button"
                    className="text-xs font-semibold text-accent-strong disabled:opacity-60"
                    aria-label={`Move ${code} down`}
                    disabled={index === draft.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    Down
                  </button>
                  <button
                    type="button"
                    className="text-xs font-semibold text-ink-muted"
                    aria-label={`Remove ${code}`}
                    onClick={() => setDraft(draft.filter((item) => item !== code))}
                  >
                    Remove
                  </button>
                </span>
              </li>
            ))}
          </ol>
        )}

        {draft.length < TREND_POINTS_PER_SEGMENT_MAX ? (
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label htmlFor={pickerId} className="block text-xs font-semibold text-ink-muted">
                {`Add a point to ${segment.label}`}
              </label>
              <select
                id={pickerId}
                className="mt-1 surface-field px-3 py-2 text-sm"
                value={pick}
                onChange={(event) => setPick(event.target.value)}
              >
                <option value="">Choose a point</option>
                {addable.map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.code} — {item.name}
                  </option>
                ))}
                {addableElsewhere.length > 0 ? (
                  <optgroup label="Other segments">
                    {addableElsewhere.map((item) => (
                      <option key={item.code} value={item.code}>
                        {item.code} — {item.name}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
              </select>
            </div>
            <button type="button" className="surface-button px-3 py-2 text-xs" onClick={add}>
              Add
            </button>
          </div>
        ) : (
          <p className="text-xs text-ink-muted">
            {`The list holds the maximum of ${TREND_POINTS_PER_SEGMENT_MAX} points.`}
          </p>
        )}

        {error ? (
          <p role="alert" className="text-sm text-critical-ink">
            {error}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="surface-button-primary bg-accent px-3 py-2 text-xs font-semibold text-on-accent disabled:opacity-60"
            disabled={saveM.isPending || unchangedCatalog}
            aria-busy={saveM.isPending}
            onClick={() => saveM.mutate(draft)}
          >
            {saveM.isPending ? "Saving…" : "Save"}
          </button>
          {isOrganization ? (
            <button
              type="button"
              className="surface-button px-3 py-2 text-xs font-semibold disabled:opacity-60"
              disabled={resetM.isPending}
              aria-busy={resetM.isPending}
              onClick={() => resetM.mutate()}
            >
              {resetM.isPending ? "Resetting…" : "Reset to catalog"}
            </button>
          ) : null}
        </div>
      </SectionCard>
    </div>
  );
}
