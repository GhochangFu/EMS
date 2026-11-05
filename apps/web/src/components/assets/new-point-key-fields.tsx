/**
 * `F4.313` (ADR 0109 Amendment 1, decision 7) — the three fields **New key**
 * asks for: code, label and unit, the Point keys page's own, checked by the
 * shared `createPointKeyBodySchema` (`newPointKeyProblems`). Presentation
 * only; the rules are in `lib/new-point-key-draft.ts`. The problems show once
 * a field holds text, and the caller's submit refuses them in any case.
 */
import { newPointKeyDraftChanged, newPointKeyProblems, type NewPointKeyDraft } from "../../lib/new-point-key-draft";

export function NewPointKeyFields({
  draft,
  disabled,
  onChange,
}: {
  draft: NewPointKeyDraft;
  disabled: boolean;
  onChange: (next: NewPointKeyDraft) => void;
}) {
  const problems = newPointKeyProblems(draft);
  const touched = newPointKeyDraftChanged(draft);
  const field = (name: keyof NewPointKeyDraft, label: string) => (
    <label className="block text-xs">
      <span className="text-ink-muted">{label}</span>
      <input
        type="text"
        value={draft[name]}
        disabled={disabled}
        onChange={(event) => onChange({ ...draft, [name]: event.target.value })}
        className="mt-1 w-full surface-field px-2 py-1"
      />
    </label>
  );
  return (
    <fieldset className="grid gap-2 sm:grid-cols-3" aria-label="New key">
      {field("code", "New key code")}
      {field("name", "New key label")}
      {field("unit", "New key unit")}
      {touched && problems.length > 0 ? (
        <ul aria-label="New key problems" className="list-disc pl-4 text-xs text-critical-ink sm:col-span-3">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      ) : null}
    </fieldset>
  );
}
