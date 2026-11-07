import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, vi } from "vitest";

import { blankWidgetRow, type TemplateDashboardWidgetRow } from "../../lib/template-dashboard-form";
import { WidgetEditor } from "./dashboard-widget-editor";

/**
 * `F4.325` (ADR 0047 Amendment 8 item 1) — the asset-template widget editor's Colour select beside
 * each chart point key. Assertions live here; `dashboard-widget-editor.test.tsx` is the Vitest
 * entry point and carries the jsdom docblock (ADR 0014).
 */

function chartWith(pointKeys: string[], chartColors: TemplateDashboardWidgetRow["config"]["chartColors"]): TemplateDashboardWidgetRow {
  const row = blankWidgetRow("chart");
  return { ...row, pointKeys, config: { ...row.config, chartColors } };
}

function renderEditor(widget: TemplateDashboardWidgetRow, onChange = vi.fn()): typeof onChange {
  render(
    <WidgetEditor
      widget={widget}
      problems={[]}
      declaredPointKeys={["kw", "kva", "pf"]}
      editable
      onChange={onChange}
      onRemove={() => {}}
    />,
  );
  return onChange;
}

export function aTemplateChartShowsAColourPerPointKey(): void {
  renderEditor(chartWith(["kw", "pf"], ["", "series-2"]));
  expect((screen.getByRole("combobox", { name: "Colour of kw" }) as HTMLSelectElement).value).toBe("");
  expect((screen.getByRole("combobox", { name: "Colour of pf" }) as HTMLSelectElement).value).toBe("series-2");
  expect(screen.queryByRole("combobox", { name: "Colour of kva" }), "an unselected key has no colour").toBeNull();
}

export function aTemplateTileShowsNoColour(): void {
  const row = blankWidgetRow("value_tile");
  renderEditor({ ...row, pointKeys: ["kw"] });
  expect(screen.queryByRole("combobox", { name: "Colour of kw" })).toBeNull();
}

export async function choosingATemplateColourWritesItAtTheKeysPosition(): Promise<void> {
  const widget = chartWith(["kw", "pf"], []);
  const onChange = renderEditor(widget);
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Colour of pf" }), "series-7");
  expect(onChange).toHaveBeenCalledWith({ config: { ...widget.config, chartColors: ["", "series-7"] } });
}

export async function unselectingAKeyKeepsTheOthersColours(): Promise<void> {
  const widget = chartWith(["kw", "pf"], ["series-1", "series-2"]);
  const onChange = renderEditor(widget);
  await userEvent.deselectOptions(screen.getByRole("listbox"), "kw");
  expect(onChange).toHaveBeenCalledWith({ pointKeys: ["pf"], config: { ...widget.config, chartColors: ["series-2"] } });
}
