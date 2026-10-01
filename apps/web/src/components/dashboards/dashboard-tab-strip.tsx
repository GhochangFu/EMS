import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";

import type { TabMarkers } from "../../hooks/use-tab-markers";
import type { TabWritePayload } from "../../lib/dashboard-builder-form";
import { FOCUS_OUTLINE_CLASS } from "../../lib/focus-classes";
import { tabAccessibleName } from "../widgets/site-widget-parts";
import { TabStatusMarker } from "./tab-status-marker";

type DashboardTabStripProps = {
  tabs: readonly TabWritePayload[];
  selectedKey: string | null;
  /** `via` says how: the viewer keeps one history entry for a run of arrow-key moves. */
  onSelect: (key: string, via: "pointer" | "keyboard") => void;
  /** The selected tab's content, drawn inside the `tabpanel` every tab controls. */
  children: ReactNode;
  /**
   * `F3.77` (plan D4) — the tab status markers (`useTabMarkers`), by tab key. A tab the map lists
   * draws its marker and is named by `tabAccessibleName`; any other tab keeps its label.
   */
  markers?: TabMarkers;
};

/**
 * `F3.73` (plan D11) — the strip above the builder's canvas and the dashboard viewer's canvas;
 * the canvas shows the selected tab.
 *
 * `F3.73` critique fix — one ARIA tabs pattern (APG "Tabs with automatic activation"): a
 * `tablist` of `tab` buttons with a roving tabindex (only the selected tab is in the tab order),
 * ArrowLeft / ArrowRight (wrapping), Home and End, which select and focus; and one `tabpanel`
 * every tab controls, labelled by the selected tab. The panel's content swaps with the selection,
 * so a single panel is enough. Ids are by position, not key: the builder can hold two tabs with
 * one key while the author edits.
 */
export function DashboardTabStrip({ tabs, selectedKey, onSelect, children, markers }: DashboardTabStripProps) {
  const idBase = useId();
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const selectedIndex = tabs.findIndex((tab) => tab.key === selectedKey);
  // No selected tab (a stale key): the first stays reachable by Tab.
  const focusableIndex = selectedIndex === -1 ? 0 : selectedIndex;
  const tabId = (index: number) => `${idBase}-tab-${index}`;
  const panelId = `${idBase}-panel`;

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number): void {
    const last = tabs.length - 1;
    const target =
      event.key === "ArrowRight"
        ? (index + 1) % tabs.length
        : event.key === "ArrowLeft"
          ? (index - 1 + tabs.length) % tabs.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    const tab = target === null ? undefined : tabs[target];
    if (target === null || tab === undefined) {
      return;
    }
    event.preventDefault();
    onSelect(tab.key, "keyboard");
    buttons.current[target]?.focus();
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap gap-1 border-b border-line pb-2" role="tablist" aria-label="Dashboard tabs">
        {tabs.map((tab, index) => {
          const label = tab.label.trim() || tab.key;
          const marker = markers?.byTab.get(tab.key);
          return (
            <button
              key={`${index}-${tab.key}`}
              ref={(node) => {
                buttons.current[index] = node;
              }}
              id={tabId(index)}
              type="button"
              role="tab"
              aria-selected={index === selectedIndex}
              aria-controls={panelId}
              aria-label={
                marker === undefined || markers === undefined
                  ? undefined
                  : tabAccessibleName(label, marker.status, markers.severities)
              }
              tabIndex={index === focusableIndex ? 0 : -1}
              onClick={() => onSelect(tab.key, "pointer")}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={`px-3 py-1.5 surface-tab ${FOCUS_OUTLINE_CLASS} ${index === selectedIndex ? "surface-tab-selected" : ""}`}
            >
              {label}
              {marker === undefined ? null : <TabStatusMarker status={marker.status} />}
            </button>
          );
        })}
      </div>
      <div
        role="tabpanel"
        id={panelId}
        aria-labelledby={tabId(focusableIndex)}
        tabIndex={0}
        className={`rounded ${FOCUS_OUTLINE_CLASS}`}
      >
        {children}
      </div>
    </>
  );
}
