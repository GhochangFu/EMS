/**
 * The Formula help section (`F4.314` PR 1, ADR 0038 Amendment 6 decision A1).
 *
 * Beside every formula field — the template Calculations and KPIs tabs and
 * `PointCalcFormulaFields` (the Add calculated point panel, the bulk wizard,
 * the override wizard and panel) — a collapsed `<details>` (ruling 4) listing
 * what the dialect in force admits, one example each. Clicking an entry hands
 * its text to `onInsert`, which every surface appends to the formula through
 * its existing change path (ruling 3), so the editor and the plain inputs
 * behave alike.
 *
 * Presentation only: the list is `formulaHelpEntries` (`lib/formula-help.ts`),
 * where the coverage gate and the parse checks reach it. Imports no
 * CodeMirror (decision 7, `tests/adr-0038-formula-editor.test.ts`), so it
 * stays out of the editor's lazy chunk and costs the entry chunk nothing.
 *
 * `V3_WINDOW_HELP` is rendered verbatim under the Windows list: it teaches
 * the window forms together (the time integral, the coverage refusal,
 * `delta` on counters, `hours` prorating), so it is that list's note rather
 * than one entry's text.
 */
import type { CalcDialect } from "@bms/shared";

import { formulaHelpEntries, type FormulaHelpEntry } from "../../lib/formula-help";
import { V3_WINDOW_HELP } from "../../lib/template-calc-config";

type Props = {
  /** The dialect in force for the field. */
  dialect: CalcDialect;
  /** A frozen version or a pending save: every entry is disabled (ADR 0038 decision 3). */
  disabled: boolean;
  /** Receives the entry's insert text; the surface appends it to the formula. */
  onInsert: (text: string) => void;
};

type Group = FormulaHelpEntry["group"];

// Keyed on the union, so a seventh group fails to compile here rather than
// rendering under no heading.
const GROUP_HEADING: Record<Group, string> = {
  operator: "Operators",
  reference: "References",
  function: "Functions",
  scope: "Scopes",
  parameter: "Parameters",
  window: "Windows",
};

const GROUP_ORDER: readonly Group[] = ["operator", "reference", "function", "scope", "parameter", "window"];

/** The collapsed Formula help beside a formula field; a click appends the entry's text. */
export function FormulaHelp({ dialect, disabled, onInsert }: Props) {
  const entries = formulaHelpEntries(dialect);
  return (
    <details className="mt-1 text-2xs text-ink-muted sm:col-span-2">
      <summary className="cursor-pointer select-none font-semibold">Formula help</summary>
      {GROUP_ORDER.map((group) => {
        const inGroup = entries.filter((entry) => entry.group === group);
        if (inGroup.length === 0) {
          return null;
        }
        return (
          <div key={group} className="mt-1">
            <p className="font-semibold uppercase tracking-wide">{GROUP_HEADING[group]}</p>
            <ul aria-label={GROUP_HEADING[group]} className="space-y-0.5">
              {inGroup.map((entry) => (
                <li key={entry.label}>
                  <button
                    type="button"
                    aria-label={`Insert ${entry.label}`}
                    disabled={disabled}
                    onClick={() => onInsert(entry.insert)}
                    className="text-left hover:text-ink disabled:cursor-not-allowed disabled:hover:text-ink-muted"
                  >
                    <span className="font-mono font-semibold">{entry.label}</span> — <span>{entry.says}</span>:{" "}
                    <code className="rounded bg-well-deep px-1">{entry.example}</code>
                  </button>
                </li>
              ))}
            </ul>
            {group === "window" ? <p className="mt-0.5">{V3_WINDOW_HELP}</p> : null}
          </div>
        );
      })}
    </details>
  );
}
