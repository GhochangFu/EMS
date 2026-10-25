import type { ChangeEvent } from "react";

import { ATTACHMENT_EXTENSIONS, CARRY_ONLY_SENTENCE, unscrubbedSentence } from "../../lib/copilot-attachments";

/**
 * `F3.87` PR 8 (ADR 0099 Amendment 3 A4, A7) — the dock's Attach button: a
 * label around a hidden multiple file input, the A7 sentence as its title and
 * name. Moved out of `copilot-dock.tsx` by `F4.283` (AGENTS.md §4.5 cap).
 *
 * `F4.283` (Amendment 8 Q20; owner ruling 2026-10-24, drafter choice 8): the
 * accessible name carries the CSV/XLSX line too, so a screen-reader user
 * picking a CSV hears the sentence that is right for it.
 */
export function AttachButton({
  scopeLabel,
  disabled,
  onChoose,
}: {
  scopeLabel: string;
  disabled: boolean;
  onChoose: (e: ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <label
      title={unscrubbedSentence(scopeLabel)}
      className="surface-button cursor-pointer px-2 py-1 text-xs focus-within:ring-2 focus-within:ring-accent"
    >
      Attach
      <input
        type="file"
        multiple
        accept={ATTACHMENT_EXTENSIONS.join(",")}
        aria-label={`Attach files. ${unscrubbedSentence(scopeLabel)} ${CARRY_ONLY_SENTENCE}`}
        onChange={onChoose}
        disabled={disabled}
        className="sr-only"
      />
    </label>
  );
}
