import { ML_FINDINGS_WIDGET_SHOW, type MlFindingsWidgetShow } from "@bms/shared";

import type { WidgetConfigRow } from "../../lib/widget-config-form";
import { Field } from "../asset-templates/field";
import { ML_FINDINGS_WIDGET_NOTE } from "../widgets/ml-findings-widget-preview";

const SHOW_LABEL: Readonly<Record<MlFindingsWidgetShow, string>> = {
  both: "Both",
  forecasts: "Forecasts",
  anomalies: "Anomalies",
};

type MlFindingsInspectorFieldsProps = {
  config: WidgetConfigRow;
  onChange: (patch: Partial<WidgetConfigRow>) => void;
};

/**
 * `E1.9f` / ADR 0135 Amendment 8 decision 13 — the `ml_findings` widget's inspector: the advisory
 * line, *Show* (`config.show`) and *AI paragraph* (`config.paragraph`; off shows the facts only and
 * never asks for a paragraph). The widget binds nothing, so there is no unit, decimals or point.
 */
export function MlFindingsInspectorFields({ config, onChange }: MlFindingsInspectorFieldsProps) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-muted" data-testid="ml-findings-inspector-note">
        {ML_FINDINGS_WIDGET_NOTE}
      </p>
      <Field label="Show">
        <select
          value={config.mlFindingsShow ?? "both"}
          onChange={(event) => onChange({ mlFindingsShow: event.target.value as MlFindingsWidgetShow })}
          className="surface-field w-full px-2 py-1.5 text-xs"
        >
          {ML_FINDINGS_WIDGET_SHOW.map((show) => (
            <option key={show} value={show}>
              {SHOW_LABEL[show]}
            </option>
          ))}
        </select>
      </Field>
      <label className="flex items-center gap-2 text-xs text-ink">
        <input
          type="checkbox"
          checked={config.mlFindingsParagraph ?? true}
          onChange={(event) => onChange({ mlFindingsParagraph: event.target.checked })}
        />
        AI paragraph
      </label>
    </div>
  );
}
