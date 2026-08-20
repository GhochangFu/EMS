import { useMutation } from "@tanstack/react-query";
import { useRef, useState } from "react";
import type { TelemetryImportCommitDto, TelemetryImportPreviewDto } from "@bms/shared";

import {
  commitTelemetryImport,
  previewTelemetryImport,
  type TelemetryImportRequestOptions,
} from "../../api/admin/telemetry-import";
import { MasterDataLayout } from "../../components/admin/master-data-layout";
import { PageHeader } from "../../components/page-header";
import { SectionCard } from "../../components/section-card";
import {
  groupRejectionsByReason,
  summarizeCommit,
  summarizePreview,
} from "../../lib/telemetry-import-preview";
import type { AuthUser } from "../../stores/auth-store";

type TelemetryImportPageProps = { user: AuthUser };

/** Admin screen for CSV/Excel telemetry bulk import (`F1.9`) — preview, then an explicit commit. */
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
    onError: (err: Error) => setError(err.message),
  });

  const commitMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Choose a file first");
      return commitTelemetryImport(file, { sourceKind, conflictPolicy });
    },
    onSuccess: (result) => {
      setCommitResult(result);
      setError(null);
    },
    onError: (err: Error) => setError(err.message),
  });

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
        <p className="text-xs text-bms-muted">
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
          <label className="text-xs font-semibold text-bms-muted">
            Source kind
            <select
              className="mt-1 block rounded border px-3 py-1.5 text-sm"
              value={sourceKind}
              onChange={(event) =>
                setSourceKind(event.target.value as TelemetryImportRequestOptions["sourceKind"])
              }
            >
              <option value="unmapped">Unmapped (default)</option>
              <option value="manual">Manual</option>
            </select>
          </label>
          <label className="text-xs font-semibold text-bms-muted">
            On conflict
            <select
              className="mt-1 block rounded border px-3 py-1.5 text-sm"
              value={conflictPolicy}
              onChange={(event) =>
                setConflictPolicy(event.target.value as TelemetryImportRequestOptions["conflictPolicy"])
              }
            >
              <option value="reject">Reject (default)</option>
              <option value="overwrite">Overwrite</option>
            </select>
          </label>
          <button
            type="button"
            className="rounded bg-bms-green px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
            disabled={!file || previewMutation.isPending}
            onClick={() => previewMutation.mutate()}
          >
            {previewMutation.isPending ? "Checking…" : "Preview"}
          </button>
          {file || preview || commitResult ? (
            <button
              type="button"
              className="rounded border px-3 py-2 text-xs font-semibold text-bms-muted"
              onClick={reset}
            >
              Start over
            </button>
          ) : null}
        </div>
        {error ? <div className="text-xs text-red-700">{error}</div> : null}
      </SectionCard>

      {preview ? (
        <SectionCard title="2. Preview" bodyClassName="p-4 space-y-3">
          <p className="text-sm text-bms-ink">{summarizePreview(preview)}</p>
          {preview.rejected.length > 0 ? (
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-bms-muted">
                  <th className="px-2 py-2">Rows</th>
                  <th className="px-2 py-2">Reason</th>
                </tr>
              </thead>
              <tbody>
                {groupRejectionsByReason(preview.rejected).map((group) => (
                  <tr key={group.reason} className="border-b border-gray-100">
                    <td className="px-2 py-2 font-mono">{group.rowNumbers.join(", ")}</td>
                    <td className="px-2 py-2">{group.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          <button
            type="button"
            className="rounded bg-bms-green px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
            disabled={preview.acceptedCount === 0 || commitMutation.isPending || commitResult !== null}
            onClick={() => commitMutation.mutate()}
          >
            {commitResult ? "Committed" : commitMutation.isPending ? "Committing…" : "Commit"}
          </button>
        </SectionCard>
      ) : null}

      {commitResult ? (
        <SectionCard title="3. Result" bodyClassName="p-4 space-y-3">
          <p className="text-sm text-bms-ink">{summarizeCommit(commitResult)}</p>
          {commitResult.rejected.length > 0 ? (
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-bms-muted">
                  <th className="px-2 py-2">Rows</th>
                  <th className="px-2 py-2">Reason</th>
                </tr>
              </thead>
              <tbody>
                {groupRejectionsByReason(commitResult.rejected).map((group) => (
                  <tr key={group.reason} className="border-b border-gray-100">
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
