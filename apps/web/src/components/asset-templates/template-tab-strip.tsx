/**
 * The detail page's tab strip (`F2.5`, ADR 0038 decision 2 — Unit 7).
 *
 * Presentation only. The registry and the `?tab=` resolver live in
 * `src/lib/template-tabs.ts`, where a test can reach them and the coverage gate
 * can see them — a `.tsx` is unreachable by both in this repository. This file
 * holds no rule, which is why it has no spec of its own.
 */
import {
  TEMPLATE_TABS,
  type TemplateTabId,
} from "../../lib/template-tabs";

type TemplateTabStripProps = {
  active: TemplateTabId;
  onSelect: (tab: TemplateTabId) => void;
};

/** The six tabs, with the active one's hint underneath. */
export function TemplateTabStrip({ active, onSelect }: TemplateTabStripProps) {
  const current = TEMPLATE_TABS.find((tab) => tab.id === active) ?? TEMPLATE_TABS[0];

  return (
    <div className="space-y-1">
      <nav className="flex flex-wrap gap-1 border-b border-gray-200 pb-2" role="tablist">
        {TEMPLATE_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={tab.id === active}
            onClick={() => onSelect(tab.id)}
            className={`rounded px-3 py-1.5 text-xs font-semibold ${
              tab.id === active
                ? "bg-bms-green text-white"
                : "text-bms-muted hover:bg-gray-100 hover:text-bms-ink"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </nav>
      <p className="text-[11px] text-bms-muted">{current.hint}</p>
    </div>
  );
}
