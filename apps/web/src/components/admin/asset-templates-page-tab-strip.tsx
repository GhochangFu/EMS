/**
 * The Asset Templates list page's tab strip (`F2.21` part 1).
 *
 * Presentation only. The registry, the `?tab=` resolver and the permission
 * fallback live in `src/lib/asset-templates-page-tabs.ts`, where a test can
 * reach them and the coverage gate can see them — a `.tsx` is unreachable by
 * both in this repository. This file holds no rule, which is why it has no spec
 * of its own.
 *
 * **Not `template-tab-strip.tsx`.** That one renders the detail page's seven
 * authoring tabs, is fixed by ADR 0038 decision 2, and its registry is scanned
 * as source text by `tests/adr-0038-template-authoring-ui.test.ts`. This strip
 * renders two lists and shows a count on each, so generalising the other one
 * would have meant editing a surface that scan is mutation-proven against, for
 * no gain here.
 */
import type {
  AssetTemplatesPageTab,
  AssetTemplatesPageTabId,
} from "../../lib/asset-templates-page-tabs";

type AssetTemplatesPageTabStripProps = {
  tabs: readonly AssetTemplatesPageTab[];
  active: AssetTemplatesPageTabId;
  onSelect: (tab: AssetTemplatesPageTabId) => void;
  /**
   * How many rows each tab holds, by id. A tab with no entry shows no count —
   * which is what a still-loading list should look like, rather than a
   * confident `0` that changes a moment later.
   */
  counts: Partial<Record<AssetTemplatesPageTabId, number>>;
};

/** The two lists as peers, with the active one's hint underneath. */
export function AssetTemplatesPageTabStrip({
  tabs,
  active,
  onSelect,
  counts,
}: AssetTemplatesPageTabStripProps) {
  const current = tabs.find((tab) => tab.id === active) ?? tabs[0];

  return (
    <div className="space-y-1">
      <nav className="flex flex-wrap gap-1 border-b border-gray-200 pb-2" role="tablist">
        {tabs.map((tab) => {
          const count = counts[tab.id];
          return (
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
              {count === undefined ? null : (
                <span
                  className={`ml-2 font-normal ${
                    tab.id === active ? "text-white/80" : "text-bms-muted"
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </nav>
      {current ? <p className="text-[11px] text-bms-muted">{current.hint}</p> : null}
    </div>
  );
}
