import { CARRY_ONLY_SENTENCE, sizeLabel, unscrubbedSentence } from "../../lib/copilot-attachments";
import { renderedPageCount } from "../../lib/copilot-pdf-page";

/**
 * `F3.87` PR 8 (ADR 0099 Amendment 3 A4, A7) — the dock's attachment panel,
 * moved out of `copilot-dock.tsx` by `F4.283` to keep it under the AGENTS.md
 * §4.5 cap: the A7 sentence, the files to attach and the PDF render status.
 * The markup is unchanged; the Attach button is `attach-button.tsx`.
 *
 * `F4.283` (Amendment 8 Q20; owner ruling 2026-10-24, drafter choice 8): the
 * sentence gains a line for a CSV or XLSX, which stays in this browser.
 */
export function AttachPanel({
  scopeLabel,
  files,
  rendering,
  sending,
  onRemove,
}: {
  scopeLabel: string;
  files: readonly File[];
  rendering: readonly string[];
  sending: boolean;
  onRemove: (index: number) => void;
}) {
  return (
    <>
      <p className="mb-2 text-[11px] text-ink-muted">{unscrubbedSentence(scopeLabel)}</p>
      <p className="mb-2 text-[11px] text-ink-muted">{CARRY_ONLY_SENTENCE}</p>
      {files.length > 0 && (
        <ul aria-label="Files to attach" className="mb-2 flex flex-wrap gap-1">
          {files.map((file, i) => (
            <li
              key={`${i}-${file.name}`}
              data-name={file.name}
              className="surface-pressed flex max-w-full items-center gap-1 rounded px-2 py-0.5 text-[11px] text-ink"
            >
              <span className="truncate">{file.name}</span>
              <span className="text-ink-muted">{sizeLabel(file.size)}</span>
              {renderedPageCount(file) !== undefined && (
                <span className="text-ink-muted">{`page 1 of ${renderedPageCount(file)}, sent as an image`}</span>
              )}
              <button
                type="button"
                aria-label={sending ? `Sending ${file.name}…` : `Remove ${file.name}`}
                aria-busy={sending}
                onClick={() => onRemove(i)}
                disabled={sending}
                className="px-1 text-ink-muted hover:text-ink"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {rendering.length > 0 && (
        <p role="status" className="mb-2 flex flex-wrap gap-1 text-[11px] text-ink-muted">
          {rendering.map((name, i) => (
            <span key={`${i}-${name}`} className="surface-pressed rounded px-2 py-0.5">{`Rendering ${name}…`}</span>
          ))}
        </p>
      )}
    </>
  );
}
