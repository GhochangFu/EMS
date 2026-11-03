import { useState } from "react";

import { ViewExportError, type ViewExportFormat } from "../../api/view-exports";

/** A 400 from an export route: the row cap (`MAX_EXPORT_ROWS`) or a refused range. */
export const EXPORT_OVER_LIMIT_SENTENCE = "The export is above the row limit. Narrow the range or the points.";
/** Every other failure. */
export const EXPORT_FAILED_SENTENCE = "Export failed.";

type ExportMenuProps = {
  /** Runs one download of the view's current query in the chosen format; rejects on a refusal. */
  onExport: (format: ViewExportFormat) => Promise<void>;
};

const FORMATS: readonly { key: ViewExportFormat; label: string }[] = [
  { key: "csv", label: "CSV" },
  { key: "xlsx", label: "XLSX" },
];

/**
 * `F4.303` U7 (ADR 0108 Amendment 6 item 3) — "Export" on a view: a CSV and an XLSX button. Both
 * are `aria-busy` while a download runs, and a second click is ignored until it ends. A failure is
 * one of two fixed sentences picked by status — a 400 is the row limit, anything else "Export
 * failed." — and never the error's message (`F4.204`).
 */
export function ExportMenu({ onExport }: ExportMenuProps) {
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const run = async (format: ViewExportFormat): Promise<void> => {
    if (pending) {
      return;
    }
    setPending(true);
    setFailure(null);
    try {
      await onExport(format);
    } catch (err) {
      setFailure(err instanceof ViewExportError && err.status === 400 ? EXPORT_OVER_LIMIT_SENTENCE : EXPORT_FAILED_SENTENCE);
    } finally {
      setPending(false);
    }
  };

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span role="group" aria-label="Export" className="inline-flex items-center gap-1 text-xs">
        <span className="text-ink-muted" aria-hidden="true">
          Export:
        </span>
        {FORMATS.map((format) => (
          <button
            key={format.key}
            type="button"
            aria-busy={pending}
            className="rounded border border-line-strong px-2 py-1 text-xs"
            onClick={() => void run(format.key)}
          >
            {format.label}
          </button>
        ))}
      </span>
      {failure === null ? null : (
        <span role="alert" className="text-xs text-critical-ink">
          {failure}
        </span>
      )}
    </span>
  );
}
