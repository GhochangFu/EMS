import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";

import type { TabWritePayload } from "../../lib/dashboard-builder-form";

type DashboardTabStripProps = {
  tabs: readonly TabWritePayload[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  /** The selected tab's content, drawn inside the `tabpanel` every tab controls. */
  children: ReactNode;
};

/**
 * The project's `--focus` token as a keyboard-focus outline. An outline, not a `ring`: a ring is a
 * `box-shadow`, and the selected tab's pressed `box-shadow` (`.surface-tab-selected`) competes with it.
 */
export const TAB_FOCUS_CLASS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

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
export function DashboardTabStrip({ tabs, selectedKey, onSelect, children }: DashboardTabStripProps) {
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
    onSelect(tab.key);
    buttons.current[target]?.focus();
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap gap-1 border-b border-line pb-2" role="tablist" aria-label="Dashboard tabs">
        {tabs.map((tab, index) => (
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
            tabIndex={index === focusableIndex ? 0 : -1}
            onClick={() => onSelect(tab.key)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={`px-3 py-1.5 surface-tab ${TAB_FOCUS_CLASS} ${index === selectedIndex ? "surface-tab-selected" : ""}`}
          >
            {tab.label.trim() || tab.key}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={panelId}
        aria-labelledby={tabId(focusableIndex)}
        tabIndex={0}
        className={`rounded ${TAB_FOCUS_CLASS}`}
      >
        {children}
      </div>
    </>
  );
}
