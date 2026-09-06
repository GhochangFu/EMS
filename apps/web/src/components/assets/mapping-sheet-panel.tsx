import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import type { MappingSheetCommitDto, MappingSheetPreviewDto } from "@bms/shared";

import {
  commitMappingSheet,
  downloadMappingSheet,
  previewMappingSheet,
} from "../../api/admin/asset-points";
import { SectionCard } from "../section-card";
import { StatusPill } from "../status-pill";
import { apiErrorMessage } from "../../lib/api-error-message";
import {
  MAPPING_SHEET_ERROR_LABELS,
  errorsByRow,
  formatMappingSheetCell,
  summarizeMappingCommit,
  summarizeMappingPreview,
} from "../../lib/mapping-sheet-preview";

/**
 * `F2.7` / ADR 0056 decisions 6 and 7 — export one location's `MAPPINGS`
 * workbook, preview a filled one, then commit it.
 *
 * The panel is wiring: every sentence, label and ordering rule it renders comes
 * from `lib/mapping-sheet-preview.ts`, which is where they are asserted without
 * a DOM.
 *
 * **Commit follows a preview of the same `File` object**, the rule
 * `telemetry-import-page.tsx` established for `F1.9`. The preview describes one
 * file; choosing another and pressing Commit would write something nobody
 * looked at. Identity, not the name: two exports of the same location are two
 * `File` objects with the same name and different contents.
 *
 * The panel takes a `locationId` and nothing else. The plan's file list names a
 * `user` prop, but the sibling `PointCalcOverridePanel` takes none and the
 * three routes are gated on `canManageLocation` — a role predicate here would
 * invent a permission rule the API does not mirror.
 */
type MappingSheetPanelProps = {
  /** The location whose sheet this is; `undefined` until one is chosen in the filter bar. */
  locationId: string | undefined;
};

export function MappingSheetPanel({ locationId }: MappingSheetPanelProps) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<{ file: File; dto: MappingSheetPreviewDto } | null>(null);
  const [commitResult, setCommitResult] = useState<MappingSheetCommitDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const downloadMutation = useMutation({
    mutationFn: async () => {
      if (!locationId) throw new Error("Choose a location first");
      return downloadMappingSheet(locationId);
    },
    onSuccess: ({ blob, filename }) => {
      setError(null);
      // The object URL and the synthetic click are the DOM half of the
      // download; the api module stays transport-only so it can be stubbed.
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
    },
    onError: (cause: Error) => setError(apiErrorMessage(cause)),
  });

  const previewMutation = useMutation({
    mutationFn: async () => {
      if (!locationId || !file) throw new Error("Choose a location and a file first");
      const dto = await previewMappingSheet(locationId, file);
      return { file, dto };
    },
    onSuccess: (result) => {
      setPreview(result);
      setCommitResult(null);
      setError(null);
    },
    onError: (cause: Error) => {
      // A failed re-preview must not leave the previous one on screen with
      // Commit still enabled — it describes a file this attempt replaced.
      setPreview(null);
      setError(apiErrorMessage(cause));
    },
  });

  const commitMutation = useMutation({
    mutationFn: async () => {
      if (!locationId || !file) throw new Error("Choose a location and a file first");
      return commitMappingSheet(locationId, file);
    },
    onSuccess: async (result) => {
      setCommitResult(result);
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ["admin", "asset-points"] });
    },
    onError: (cause: Error) => setError(apiErrorMessage(cause)),
  });

  const previewedDto = preview && preview.file === file ? preview.dto : null;
  const canCommit =
    previewedDto !== null && commitResult === null && !commitMutation.isPending;

  function chooseFile(next: File | null): void {
    setFile(next);
    setPreview(null);
    setCommitResult(null);
    setError(null);
  }

  return (
    <SectionCard
      title="Mapping sheet"
      subtitle="Export this location's tags as an Excel sheet, edit it offline, then preview and commit it"
      bodyClassName="p-3 space-y-3"
    >
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="rounded border border-gray-200 px-3 py-2 text-xs font-semibold text-bms-ink disabled:opacity-50"
          disabled={!locationId || downloadMutation.isPending}
          onClick={() => downloadMutation.mutate()}
        >
          {downloadMutation.isPending ? "Preparing…" : "Download mapping sheet"}
        </button>
        <label className="text-xs font-semibold text-bms-muted">
          Mapping sheet file
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.csv"
            aria-label="Mapping sheet file"
            className="mt-1 block text-sm"
            onChange={(event) => chooseFile(event.target.files?.[0] ?? null)}
          />
        </label>
        <button
          type="button"
          className="rounded bg-bms-green px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
          disabled={!locationId || !file || previewMutation.isPending}
          onClick={() => previewMutation.mutate()}
        >
          {previewMutation.isPending ? "Checking…" : "Preview"}
        </button>
        <button
          type="button"
          className="rounded bg-bms-green px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
          disabled={!canCommit}
          onClick={() => commitMutation.mutate()}
        >
          {commitMutation.isPending ? "Writing…" : "Commit"}
        </button>
      </div>

      {!locationId ? (
        <p className="text-xs text-bms-muted">
          Choose a location above — the sheet covers one location&apos;s assets.
        </p>
      ) : null}
      {error ? <p className="text-xs text-red-700">{error}</p> : null}

      {previewedDto ? (
        <div className="space-y-3">
          <p className="text-sm text-bms-ink">{summarizeMappingPreview(previewedDto)}</p>

          {previewedDto.creates.length > 0 ? (
            <table className="min-w-full text-sm" aria-label="Rows to create">
              <caption className="px-2 py-1 text-left text-xs font-semibold uppercase text-bms-muted">
                New mappings
              </caption>
              <thead>
                <tr className="border-b text-left text-xs uppercase text-bms-muted">
                  <th className="px-2 py-2">Row</th>
                  <th className="px-2 py-2">Asset</th>
                  <th className="px-2 py-2">Point key</th>
                  <th className="px-2 py-2">Source key</th>
                  <th className="px-2 py-2">RTU</th>
                  <th className="px-2 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {previewedDto.creates.map((create) => (
                  <tr key={`${create.assetCode}-${create.pointKey}`} className="border-b border-gray-100">
                    <td className="px-2 py-2">{create.row}</td>
                    <td className="px-2 py-2">{create.assetCode}</td>
                    <td className="px-2 py-2 font-mono">{create.pointKey}</td>
                    <td className="px-2 py-2 font-mono">{create.sourceDataKey}</td>
                    <td className="px-2 py-2">{create.rtuCode ?? "—"}</td>
                    <td className="px-2 py-2">
                      {/* Correction 36 — `FALSE` on a pre-fill row creates the
                          mapping inactive, so this is a real value and not
                          decoration. */}
                      <StatusPill
                        label={create.active ? "Active" : "Inactive"}
                        tone={create.active ? "ok" : "offline"}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}

          {previewedDto.updates.length > 0 ? (
            <table className="min-w-full text-sm" aria-label="Rows to update">
              <caption className="px-2 py-1 text-left text-xs font-semibold uppercase text-bms-muted">
                Changes to existing mappings
              </caption>
              <thead>
                <tr className="border-b text-left text-xs uppercase text-bms-muted">
                  <th className="px-2 py-2">Row</th>
                  <th className="px-2 py-2">Asset</th>
                  <th className="px-2 py-2">Point key</th>
                  <th className="px-2 py-2">Field</th>
                  <th className="px-2 py-2">From</th>
                  <th className="px-2 py-2">To</th>
                </tr>
              </thead>
              <tbody>
                {previewedDto.updates.flatMap((update) =>
                  update.changes.map((change) => (
                    <tr key={`${update.assetPointId}-${change.field}`} className="border-b border-gray-100">
                      <td className="px-2 py-2">{update.row}</td>
                      <td className="px-2 py-2">{update.assetCode}</td>
                      <td className="px-2 py-2 font-mono">{update.pointKey}</td>
                      <td className="px-2 py-2 font-mono">{change.field}</td>
                      <td className="px-2 py-2">{formatMappingSheetCell(change.from)}</td>
                      <td className="px-2 py-2 font-semibold">{formatMappingSheetCell(change.to)}</td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          ) : null}

          {previewedDto.errors.length > 0 ? (
            <MappingSheetProblems errors={previewedDto.errors} />
          ) : null}
        </div>
      ) : null}

      {commitResult ? (
        <div className="space-y-2 rounded border border-gray-200 bg-gray-50 p-3">
          <p className="text-sm font-semibold text-bms-ink">{summarizeMappingCommit(commitResult)}</p>
          {commitResult.skipped.length > 0 ? (
            <MappingSheetProblems errors={commitResult.skipped} />
          ) : null}
        </div>
      ) : null}
    </SectionCard>
  );
}

/**
 * One line per problem — the Excel row, the cell, what is wrong and the
 * server's own message, which is the half that names the value.
 *
 * The same table serves the preview's `errors[]` and the commit's `skipped[]`:
 * both are `MappingSheetErrorDto[]`, and a skipped row on commit is a row the
 * person still has to fix (design decision 7 / Q5).
 */
function MappingSheetProblems({
  errors,
}: {
  errors: MappingSheetPreviewDto["errors"];
}) {
  return (
    <table className="min-w-full text-sm" aria-label="Problems">
      <caption className="px-2 py-1 text-left text-xs font-semibold uppercase text-bms-muted">
        Rows that will not be written
      </caption>
      <thead>
        <tr className="border-b text-left text-xs uppercase text-bms-muted">
          <th className="px-2 py-2">Excel row</th>
          <th className="px-2 py-2">Column</th>
          <th className="px-2 py-2">Problem</th>
          <th className="px-2 py-2">Detail</th>
        </tr>
      </thead>
      <tbody>
        {errorsByRow(errors).flatMap((group) =>
          group.errors.map((problem) => (
            <tr key={`${group.row ?? "file"}-${problem.column ?? "-"}-${problem.code}`} className="border-b border-gray-100">
              {/* A file-level problem has no row and no column (`row: null`). */}
              <td className="px-2 py-2">{group.row === null ? "File" : group.row}</td>
              <td className="px-2 py-2 font-mono">{problem.column ?? "—"}</td>
              <td className="px-2 py-2">{MAPPING_SHEET_ERROR_LABELS[problem.code]}</td>
              <td className="px-2 py-2 text-bms-muted">{problem.message}</td>
            </tr>
          )),
        )}
      </tbody>
    </table>
  );
}
