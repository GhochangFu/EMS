import { useMutation } from "@tanstack/react-query";
import { useRef, useState } from "react";
import type { TelemetryImportCommitDto, TelemetryImportPreviewDto } from "@bms/shared";
import { catalogEntry } from "@bms/shared/copilot";

import {
  commitTelemetryImport,
  previewTelemetryImport,
  type TelemetryImportRequestOptions,
} from "../../api/admin/telemetry-import";
import { MasterDataLayout } from "../../components/admin/master-data-layout";
import { PageHeader } from "../../components/page-header";
import { SectionCard } from "../../components/section-card";
import { WizardShell } from "../../components/wizard/wizard-shell";
import { apiErrorMessage } from "../../lib/api-error-message";
import {
  groupRejectionsByReason,
  summarizeCommit,
  summarizePreview,
} from "../../lib/telemetry-import-preview";
import type { AuthUser } from "../../stores/auth-store";

type TelemetryImportPageProps = { user: AuthUser };

/**
 * Admin screen for CSV/Excel telemetry bulk import (`F1.9`) — preview, then an explicit commit.
 *
 * `F4.283` (ADR 0099 Amendment 8): the commit is the `telemetry.import` wizard — one Options step
 * (source kind, conflict policy), then Review and Submit. The file sits beside the wizard and is
 * never a wizard value (the `SymbolUploadWizard` rule); the page keeps `overwrite`, which the
 * copilot never proposes (Q21).
 */
export function TelemetryImportPage({ user }: TelemetryImportPageProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [sourceKind, setSourceKind] = useState<TelemetryImportRequestOptions["sourceKind"]>("unmapped");
  const [conflictPolicy, setConflictPolicy] =
    useState<TelemetryImportRequestOptions["conflictPolicy"]>("reject");
  const [preview, setPreview] = useState<TelemetryImportPreviewDto | null>(null);
  const [commitResult, setCommitResult] = useState<TelemetryImportCommitDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const previewMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Choose a file first");
      return previewTelemetryImport(file, { sourceKind, conflictPolicy });
    },
    onSuccess: (result) => {
      setPreview(result);
      setCommitResult(null);
      setError(null);
    },
    onError: (err: unknown) => {
      // A failed re-preview (new file, changed options) must not leave the
      // PRIOR preview on screen with Commit still enabled — that preview
      // describes a file/options combination this attempt just replaced.
      setPreview(null);
      setError(apiErrorMessage(err));
    },
  });

  const commitMutation = useMutation({
    mutationFn: async (options: TelemetryImportRequestOptions) => {
      if (!file) throw new Error("Choose a file first");
      return commitTelemetryImport(file, options);
    },
    onSuccess: (result) => {
      setCommitResult(result);
      setError(null);
    },
    onError: (err: unknown) => setError(apiErrorMessage(err)),
  });

  // The old Commit button's gate, kept on the wizard (`F4.283` review): no commit without a preview,
  // none when the preview accepted no row, and no second commit of the same file.
  const commitBlocked = preview === null || preview.acceptedCount === 0 || commitResult !== null;

  const reset = () => {
    setFile(null);
    setPreview(null);
    setCommitResult(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <MasterDataLayout user={user}>
      <PageHeader
        eyebrow="Administration"
        title="Import Telemetry"
        subtitle="Bulk-load hand-collected or third-party readings from a CSV or Excel file"
      />
      <SectionCard title="1. Choose a file" bodyClassName="p-4 space-y-3">
        <p className="text-xs text-ink-muted">
          Columns: <code className="font-mono">asset_code</code> or{" "}
          <code className="font-mono">asset_id</code>, <code className="font-mono">point_key</code>,{" "}
          <code className="font-mono">value</code>, <code className="font-mono">unit</code> (optional),{" "}
          <code className="font-mono">time</code>. Up to 5 MB, up to 20,000 rows.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx"
            className="text-sm"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setPreview(null);
              setCommitResult(null);
              setError(null);
            }}
          />
          <button
            type="button"
            className="surface-button-primary bg-accent px-3 py-2 text-xs font-semibold text-on-accent disabled:opacity-50"
            disabled={!file || previewMutation.isPending}
            aria-busy={previewMutation.isPending}
            onClick={() => previewMutation.mutate()}
          >
            {previewMutation.isPending ? "Checking…" : "Preview"}
          </button>
          {file || preview || commitResult ? (
            <button
              type="button"
              className="surface-button px-3 py-2"
              onClick={reset}
            >
              Start over
            </button>
          ) : null}
        </div>
        {error ? <div className="text-xs text-critical-ink">{error}</div> : null}
      </SectionCard>

      <SectionCard title="Options and commit" bodyClassName="p-4 space-y-3">
        {commitBlocked ? (
          <p className="text-xs text-ink-muted">
            {commitResult !== null
              ? "This file is committed. Start over to import another."
              : preview === null
                ? "Preview the file before you commit it."
                : "The preview accepted no row, so there is nothing to commit."}
          </p>
        ) : null}
        <WizardShell
          entry={catalogEntry("telemetry.import")!}
          params={{}}
          values={{ sourceKind, conflictPolicy }}
          onChange={(next) => {
            if (next.sourceKind === "unmapped" || next.sourceKind === "manual") setSourceKind(next.sourceKind);
            if (next.conflictPolicy === "reject" || next.conflictPolicy === "overwrite") setConflictPolicy(next.conflictPolicy);
          }}
          renderStep={() => (
            <div className="flex flex-wrap items-end gap-3">
                <label className="text-xs font-semibold text-ink-muted">
                  Source kind
                  <select
                    className="mt-1 block surface-field px-3 py-1.5 text-sm"
                    value={sourceKind}
                    onChange={(event) =>
                      setSourceKind(event.target.value as TelemetryImportRequestOptions["sourceKind"])
                    }
                  >
                    <option value="unmapped">Unmapped (default)</option>
                    <option value="manual">Manual</option>
                  </select>
                </label>
                <label className="text-xs font-semibold text-ink-muted">
                  On conflict
                  <select
                    className="mt-1 block surface-field px-3 py-1.5 text-sm"
                    value={conflictPolicy}
                    onChange={(event) =>
                      setConflictPolicy(event.target.value as TelemetryImportRequestOptions["conflictPolicy"])
                    }
                  >
                    <option value="reject">Reject (default)</option>
                    <option value="overwrite">Overwrite</option>
                  </select>
                </label>
            </div>
          )}
          nextDisabled={commitBlocked}
          onSubmit={(body) => {
            if (commitBlocked || commitMutation.isPending) return;
            commitMutation.mutate({
              sourceKind: body.sourceKind === "manual" ? "manual" : "unmapped",
              conflictPolicy: body.conflictPolicy === "overwrite" ? "overwrite" : "reject",
            });
          }}
          onCancel={reset}
          submitting={commitMutation.isPending}
          submitError={commitMutation.error ? apiErrorMessage(commitMutation.error) : null}
        />
      </SectionCard>

      {preview ? (
        <SectionCard title="2. Preview" bodyClassName="p-4 space-y-3">
          <p className="text-sm text-ink">{summarizePreview(preview)}</p>
          {preview.rejected.length > 0 ? (
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-ink-muted">
                  <th className="px-2 py-2">Rows</th>
                  <th className="px-2 py-2">Reason</th>
                </tr>
              </thead>
              <tbody>
                {groupRejectionsByReason(preview.rejected).map((group) => (
                  <tr key={group.reason} className="border-b border-well-deep">
                    <td className="px-2 py-2 font-mono">{group.rowNumbers.join(", ")}</td>
                    <td className="px-2 py-2">{group.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </SectionCard>
      ) : null}

      {commitResult ? (
        <SectionCard title="3. Result" bodyClassName="p-4 space-y-3">
          <p className="text-sm text-ink">{summarizeCommit(commitResult)}</p>
          {commitResult.rejected.length > 0 ? (
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-ink-muted">
                  <th className="px-2 py-2">Rows</th>
                  <th className="px-2 py-2">Reason</th>
                </tr>
              </thead>
              <tbody>
                {groupRejectionsByReason(commitResult.rejected).map((group) => (
                  <tr key={group.reason} className="border-b border-well-deep">
                    <td className="px-2 py-2 font-mono">{group.rowNumbers.join(", ")}</td>
                    <td className="px-2 py-2">{group.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </SectionCard>
      ) : null}
    </MasterDataLayout>
  );
}
