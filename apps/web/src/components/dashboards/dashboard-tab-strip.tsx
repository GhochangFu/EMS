import type { TabWritePayload } from "../../lib/dashboard-builder-form";

type DashboardTabStripProps = {
  tabs: readonly TabWritePayload[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
};

/** `F3.73` (plan D11) — the strip above the builder's canvas and the dashboard viewer's canvas;
 * the canvas shows the selected tab. */
export function DashboardTabStrip({ tabs, selectedKey, onSelect }: DashboardTabStripProps) {
  return (
    <nav className="mb-3 flex flex-wrap gap-1 border-b border-line pb-2" role="tablist" aria-label="Dashboard tabs">
      {tabs.map((tab, index) => (
        <button
          key={`${index}-${tab.key}`}
          type="button"
          role="tab"
          aria-selected={tab.key === selectedKey}
          onClick={() => onSelect(tab.key)}
          className={`px-3 py-1.5 surface-tab ${tab.key === selectedKey ? "surface-tab-selected" : ""}`}
        >
          {tab.label.trim() || tab.key}
        </button>
      ))}
    </nav>
  );
}
