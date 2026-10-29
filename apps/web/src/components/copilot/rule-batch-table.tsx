/**
 * `F4.289` (ADR 0099 Amendment 9 E3) — a batch rule card's rows, one per
 * proposed rule, each with the server's check beside it and a checkbox. A
 * ticked row is created and published on Confirm; an unticked one is left out
 * (the card sends its index as `excludedRows`). The user can only untick: no
 * cell is editable, so the rows sent are the rows the server checked.
 *
 * `checks` is card-only data the server stored beside the rows
 * (`RuleProposalCheckService.checkBatch`). It is read defensively: a value that
 * is not a list of objects still lists every rule from its own fields, with a
 * dash in the columns only the check computes.
 */

type RuleBatchTableProps = {
  /** The stored `body.rules`. */
  rules: unknown;
  /** The stored card-only `body.checks`. */
  checks: unknown;
  /** The indexes (0-based, in `rules`) the user unticked. */
  excluded: ReadonlySet<number>;
  onToggle: (index: number) => void;
  /** The card is busy or closed: the boxes stay as they are. */
  disabled?: boolean;
};

const DASH = "—";

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The stored rows that are objects, with their index in `rules` (a non-object row is not a rule). */
export function batchRulesOf(rules: unknown): { index: number; rule: Record<string, unknown> }[] {
  if (!Array.isArray(rules)) return [];
  return rules.flatMap((rule, index) => (isObject(rule) ? [{ index, rule }] : []));
}

function textOf(value: unknown): string {
  if (typeof value === "string" && value !== "") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return DASH;
}

export function RuleBatchTable({ rules, checks, excluded, onToggle, disabled }: RuleBatchTableProps) {
  const rows = batchRulesOf(rules);
  const checkList = Array.isArray(checks) ? checks : [];
  return (
    <div className="mt-2 max-h-80 overflow-auto">
      <table aria-label="Proposed rules" className="w-full border-collapse text-[11px]">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wide text-ink-muted">
            {["#", "Asset", "Point", "Operator", "Threshold", "Severity", "Would match now", "7-day firings", "Create"].map((label) => (
              <th key={label} scope="col" className="py-0.5 pr-2 font-semibold">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ index, rule }) => {
            const check = isObject(checkList[index]) ? (checkList[index] as Record<string, unknown>) : null;
            const ticked = !excluded.has(index);
            return (
              <tr key={index} data-excluded={!ticked} className={ticked ? "text-ink" : "text-ink-muted line-through"}>
                <td className="py-0.5 pr-2">{index + 1}</td>
                <td className="py-0.5 pr-2">{textOf(check?.assetCode)}</td>
                <td className="break-all py-0.5 pr-2">{textOf(check?.pointKey ?? rule.pointKey)}</td>
                <td className="py-0.5 pr-2">{textOf(check?.operator ?? rule.operator)}</td>
                <td className="py-0.5 pr-2">{textOf(check?.thresholdValue ?? rule.thresholdValue)}</td>
                <td className="py-0.5 pr-2">{textOf(check?.severity ?? rule.severity)}</td>
                <td className="py-0.5 pr-2">{textOf(check?.matchNow)}</td>
                <td className="py-0.5 pr-2">{textOf(check?.firings)}</td>
                <td className="py-0.5">
                  <input
                    type="checkbox"
                    data-testid={`copilot-rule-row-${index}`}
                    aria-label={`Create row ${index + 1}`}
                    checked={ticked}
                    disabled={disabled === true}
                    onChange={() => onToggle(index)}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
