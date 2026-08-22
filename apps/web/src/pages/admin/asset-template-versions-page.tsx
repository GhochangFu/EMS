/**
 * The Versions / migration view (`F2.6`, ADR 0039 decision 8).
 *
 * **A route, not a sixth tab.** ADR 0038 names exactly five tabs and
 * `tests/adr-0038-template-authoring-ui.test.ts` scans `lib/template-tabs.ts`
 * to keep it that way, so adding one here would break a gate that exists for a
 * good reason (D-3). Migration is also not authoring: it acts on *assets*, and
 * the five tabs are all about the template's own shape.
 *
 * Presentation only. Every rule that could be wrong is in
 * `lib/template-version-migration.ts`, because `apps/web`'s Vitest project runs
 * `environment: "node"` over `src/**\/*.test.ts` and the coverage gate reaches
 * `src/lib/**` and nothing above it — a `.tsx` is untestable and uncovered
 * here.
 *
 * No `try`/`catch` around the calls: `adminFetch` throws `new Error(text)` with
 * the raw body, and `apiErrorMessage` is what turns that into the sentence,
 * exactly as `asset-template-detail-page.tsx` does.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";

import { fetchAdminAssets } from "../../api/admin/assets";
import {
  fetchAdminAssetTemplate,
  fetchAdminAssetTemplateVersions,
  migrateAdminAssetTemplateAssets,
  previewAdminAssetTemplateMigration,
  type TemplateMigrationPreviewResponse,
  type TemplateMigrationResultResponse,
} from "../../api/admin/asset-templates";
import { MasterDataLayout } from "../../components/admin/master-data-layout";
import { PageHeader } from "../../components/page-header";
import { SectionCard } from "../../components/section-card";
import { StatusPill } from "../../components/status-pill";
import { apiErrorMessage } from "../../lib/api-error-message";
import { statusTone } from "../../lib/template-lifecycle";
import {
  assetsInServiceLabel,
  deltaLines,
  isMigrationTarget,
  migrateActionState,
  migrationCandidates,
  partitionSelection,
  refusalMessages,
  sourceVersionsInPreview,
  versionSummaryLabel,
} from "../../lib/template-version-migration";
import type { AuthUser } from "../../stores/auth-store";

type Props = { user: AuthUser };

export function AssetTemplateVersionsPage({ user }: Props) {
  const { templateId } = useParams();
  const queryClient = useQueryClient();

  const [targetId, setTargetId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [preview, setPreview] = useState<TemplateMigrationPreviewResponse | null>(null);
  const [result, setResult] = useState<TemplateMigrationResultResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const templateQ = useQuery({
    queryKey: ["admin", "asset-template", templateId],
    queryFn: () => fetchAdminAssetTemplate(templateId ?? ""),
    enabled: Boolean(templateId),
  });
  const versionsQ = useQuery({
    queryKey: ["admin", "asset-template-versions", templateId],
    queryFn: () => fetchAdminAssetTemplateVersions(templateId ?? ""),
    enabled: Boolean(templateId),
  });
  // Every asset in the org, so the picker can offer the ones on other versions.
  // Scoping it to one version would hide exactly the assets a migration is for.
  const assetsQ = useQuery({
    queryKey: ["admin", "assets", "all"],
    queryFn: () => fetchAdminAssets("all"),
  });

  const versions = versionsQ.data?.items ?? [];
  const candidates = migrationCandidates(assetsQ.data?.items ?? [], versions);

  // A new selection or target invalidates the preview it was computed from.
  // Leaving a stale one on screen is how a migration gets applied against a
  // delta nobody looked at.
  function reset() {
    setPreview(null);
    setResult(null);
    setError(null);
  }

  const previewM = useMutation({
    mutationFn: () => previewAdminAssetTemplateMigration(targetId ?? "", selected),
    onSuccess: (next) => {
      setPreview(next);
      setError(null);
    },
    onError: (cause: Error) => {
      setPreview(null);
      setError(apiErrorMessage(cause));
    },
  });

  const migrateM = useMutation({
    mutationFn: () => migrateAdminAssetTemplateAssets(targetId ?? "", selected),
    onSuccess: (next) => {
      setResult(next);
      setPreview(null);
      setSelected([]);
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["admin", "asset-template-versions"] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "assets"] });
    },
    onError: (cause: Error) => setError(apiErrorMessage(cause)),
  });

  const action = migrateActionState(selected, preview);
  const refusals = refusalMessages(preview);
  const spanned = sourceVersionsInPreview(preview);
  const split = partitionSelection(selected, preview);
  const busy = previewM.isPending || migrateM.isPending;

  if (templateQ.isLoading || versionsQ.isLoading) {
    return (
      <MasterDataLayout user={user}>
        <p className="text-sm text-bms-muted">Loading versions…</p>
      </MasterDataLayout>
    );
  }
  if (templateQ.error || versionsQ.error) {
    return (
      <MasterDataLayout user={user}>
        <p className="text-sm text-red-700">
          {apiErrorMessage((templateQ.error ?? versionsQ.error) as Error)}
        </p>
      </MasterDataLayout>
    );
  }

  const template = templateQ.data;

  return (
    <MasterDataLayout user={user}>
      <PageHeader
        eyebrow={template ? `${template.organizationCode} · ${template.code}` : "Versions"}
        title={template ? `${template.name} · versions` : "Template versions"}
        subtitle={
          <span>
            {versions.length} version{versions.length === 1 ? "" : "s"} ·{" "}
            {assetsInServiceLabel(versions)}
          </span>
        }
        actions={
          <Link
            to={`/admin/asset-templates/${templateId ?? ""}`}
            className="rounded border border-gray-200 px-3 py-1.5 text-xs font-semibold text-bms-muted"
          >
            Back to template
          </Link>
        }
      />

      <SectionCard title="Versions">
        <ul className="divide-y divide-gray-100">
          {versions.map((version) => (
            <li key={version.id} className="flex items-center justify-between gap-3 py-2">
              <span className="flex items-center gap-2 text-sm">
                <StatusPill label={version.status} tone={statusTone(version.status)} />
                <span>{versionSummaryLabel(version)}</span>
                <span className="text-xs text-bms-muted">{version.pointCount} points</span>
              </span>
              {isMigrationTarget(version) ? (
                <button
                  type="button"
                  onClick={() => {
                    setTargetId(version.id);
                    reset();
                  }}
                  className={`rounded px-3 py-1 text-xs font-semibold ${
                    targetId === version.id
                      ? "bg-bms-green text-white"
                      : "border border-gray-200 text-bms-muted"
                  }`}
                >
                  {targetId === version.id ? "Migration target" : "Migrate to this version"}
                </button>
              ) : (
                // Decision 1: publishing is what freezes the shape assets pin.
                <span className="text-xs text-bms-muted">not a migration target</span>
              )}
            </li>
          ))}
        </ul>
      </SectionCard>

      {targetId ? (
        <SectionCard
          title="Assets to migrate"
          subtitle="Assets already on this version are excluded by the server and reported below."
        >
          <ul className="max-h-64 space-y-1 overflow-y-auto">
            {candidates.map((asset) => (
              <li key={asset.id}>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selected.includes(asset.id)}
                    onChange={(event) => {
                      setSelected((prev) =>
                        event.target.checked
                          ? [...prev, asset.id]
                          : prev.filter((id) => id !== asset.id),
                      );
                      reset();
                    }}
                  />
                  <span>
                    {asset.code} · {asset.name}
                  </span>
                  {/* Decision 8: the view lists which assets sit on which
                      version. Without this the operator picks blind and the
                      server teaches them by refusing. */}
                  <span className="text-xs text-bms-muted">
                    {asset.templateVersion === null ? "unpinned" : `v${asset.templateVersion}`}
                  </span>
                </label>
              </li>
            ))}
            {candidates.length === 0 ? (
              <li className="text-sm text-bms-muted">
                No assets are built from this template.
              </li>
            ) : null}
          </ul>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy || selected.length === 0}
              onClick={() => previewM.mutate()}
              className="rounded border border-gray-200 px-3 py-1.5 text-xs font-semibold text-bms-muted disabled:opacity-60"
            >
              Preview migration
            </button>
            <button
              type="button"
              disabled={busy || !action.enabled}
              onClick={() => migrateM.mutate()}
              className="rounded bg-bms-green px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
            >
              Migrate
            </button>
            {!action.enabled ? (
              <span className="text-xs text-bms-muted">{action.message}</span>
            ) : null}
          </div>
        </SectionCard>
      ) : null}

      {error ? (
        <SectionCard>
          <p className="text-sm text-red-700">{error}</p>
        </SectionCard>
      ) : null}

      {preview ? (
        <SectionCard
          title={
            `Preview · to v${preview.toVersion}` +
            (spanned.length > 1
              ? ` · from v${spanned.join(", v")}`
              : spanned.length === 1
                ? ` · from v${spanned[0]}`
                : "")
          }
          subtitle={
            `${split.willMigrate.length} will migrate` +
            (split.alreadyOnTarget.length > 0
              ? ` · ${split.alreadyOnTarget.length} already on this version`
              : "")
          }
        >
          {refusals.length > 0 ? (
            <div className="rounded border border-red-200 bg-red-50 p-3">
              <p className="text-xs font-semibold text-red-800">
                This migration is refused. Nothing will be written.
              </p>
              <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-red-800">
                {/* Verbatim from the API — it names the point key, the asset
                    code, the unresolved tokens or the two domain codes, and a
                    client-side sentence per reason would lose all of it. */}
                {/* `index` unconditionally: `buildPlan` pushes one refusal per
                    asset per point, so several entries legitimately share the
                    same reason and point key. Keying on the pair collides and
                    lets React show one asset's sentence in another's place. */}
                {refusals.map((refusal, index) => (
                  <li key={`${index}-${refusal.reason}-${refusal.pointKey ?? ""}`}>
                    {refusal.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {preview.deltas.map((delta) => (
            <div key={`${delta.fromVersion}-${delta.toVersion}`} className="mt-3">
              <h3 className="text-xs font-semibold text-bms-muted">
                v{delta.fromVersion} → v{delta.toVersion}
              </h3>
              <ul className="mt-1 space-y-1 text-sm">
                {deltaLines(delta).map((line) => (
                  <li key={`${line.kind}-${line.pointKey}`}>
                    <span className="font-mono text-xs">{line.pointKey}</span>{" "}
                    <span className="text-bms-muted">{line.detail}</span>
                  </li>
                ))}
                {deltaLines(delta).length === 0 ? (
                  <li className="text-bms-muted">No point changes between these versions.</li>
                ) : null}
              </ul>
            </div>
          ))}
        </SectionCard>
      ) : null}

      {result ? (
        <SectionCard
          title={`Migrated ${result.assetCount} asset${result.assetCount === 1 ? "" : "s"} to v${result.toVersion}`}
          subtitle={
            `${result.pointsCreated} telemetry point${result.pointsCreated === 1 ? "" : "s"} ` +
            "created. Stored values are unchanged — a migration never recomputes history."
          }
        >
          {result.skippedPoints.length > 0 ? (
            <ul className="mt-2 list-disc pl-4 text-xs text-bms-muted">
              {/* Reported rather than silent: "2 points added, 1 row created"
                  is otherwise indistinguishable from a bug. */}
              {result.skippedPoints.map((skipped) => (
                <li key={`${skipped.assetId}-${skipped.pointKey}`}>
                  {skipped.assetCode}: optional point {skipped.pointKey} was skipped — its source
                  key could not be resolved.
                </li>
              ))}
            </ul>
          ) : null}
        </SectionCard>
      ) : null}
    </MasterDataLayout>
  );
}
