/**
 * `F4.320` (ADR 0087 Amendment 4 decision 1) — the tab editor of a site template.
 *
 * A site template holds every widget in a tab, so its detail page edits the tabs here: the
 * `DashboardTabStrip` switches tabs, and the selected tab shows its own settings (label, key,
 * domain, group code, order, remove) above the same canvas and `WidgetEditor` rows the top-level
 * canvas uses. Every edit is a pure function of `lib/site-template-tabs.ts`; the page owns the
 * list and sends it in `content.tabs` on Save.
 *
 * Read-only (`editable = false`, a published or archived version) the strip and the canvas stay
 * and no tab input or tab button is drawn.
 */
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { MAX_DASHBOARD_TABS, MAX_DASHBOARD_WIDGETS } from "@bms/shared";

import type { SectionTemplateWidgetInput } from "../../api/admin/dashboard-templates";
import { fetchVocabularies, vocabulariesQueryKey } from "../../api/vocabularies";
import {
  addTemplateTab,
  blankTemplateWidget,
  moveTemplateTab,
  rekeyTemplateTab,
  removeTemplateTab,
  renameTemplateTab,
  setTemplateTabDomain,
  setTemplateTabGroupCode,
  withTabWidgets,
  type TemplateTabInput,
} from "../../lib/site-template-tabs";
import { DashboardCanvas } from "../dashboards/dashboard-canvas";
import { DashboardTabStrip } from "../dashboards/dashboard-tab-strip";
import { WidgetEditor, renderTemplateTile } from "./widget-editor";

type SiteTemplateTabEditorProps = {
  tabs: readonly TemplateTabInput[];
  onChange: (tabs: TemplateTabInput[]) => void;
  /** The selected tab's position; the page owns it so a refusal can select its tab. */
  selectedIndex: number;
  onSelect: (index: number) => void;
  editable: boolean;
  /** A refusal that names a tab (`firstTabProblem`), shown on that tab. */
  problem?: { readonly index: number; readonly message: string } | null;
};

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** The tab strip, the selected tab's settings, and its canvas. */
export function SiteTemplateTabEditor({
  tabs,
  onChange,
  selectedIndex,
  onSelect,
  editable,
  problem,
}: SiteTemplateTabEditorProps) {
  const index = tabs.length === 0 ? -1 : Math.min(Math.max(selectedIndex, 0), tabs.length - 1);
  const tab = index === -1 ? undefined : tabs[index];
  const atTabCap = tabs.length >= MAX_DASHBOARD_TABS;

  function addTab(): void {
    const added = addTemplateTab(tabs);
    if (added === null) return;
    onChange(added.tabs);
    onSelect(added.index);
  }

  const addTabButton = editable ? (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={addTab} disabled={atTabCap} className="surface-button px-2 py-1 disabled:opacity-60">
        Add tab
      </button>
      {atTabCap ? (
        <span className="text-2xs text-ink-muted">A template holds at most {MAX_DASHBOARD_TABS} tabs.</span>
      ) : null}
    </div>
  ) : null;

  if (tab === undefined) {
    return (
      <div className="mb-3 space-y-2">
        <p className="text-sm text-ink-muted">This site template has no tabs yet.</p>
        {addTabButton}
      </div>
    );
  }

  return (
    <div className="mb-3 space-y-3">
      {addTabButton}
      <DashboardTabStrip
        tabs={tabs.map((each) => ({ key: each.key, label: each.label, sortOrder: each.sortOrder, assetGroupId: null }))}
        selectedKey={tab.key}
        onSelect={(key) => {
          const next = tabs.findIndex((each) => each.key === key);
          if (next !== -1) onSelect(next);
        }}
      >
        {problem && problem.index === index ? (
          <p role="alert" className="mb-2 rounded border border-critical-line bg-critical-wash p-2 text-xs text-critical-ink-strong">
            {problem.message}
          </p>
        ) : null}
        {editable ? (
          <TabSettings
            // A new selection starts a new key draft.
            key={index}
            tabs={tabs}
            index={index}
            onChange={onChange}
            onSelect={onSelect}
          />
        ) : (
          <p className="mb-2 text-xs text-ink-muted">
            Key {tab.key} · {tab.domain ?? "overview"}
            {tab.groupCode ? ` · group ${tab.groupCode}` : ""} · {plural(tab.widgets.length, "widget")}
          </p>
        )}
        <TabCanvas tabs={tabs} index={index} onChange={onChange} editable={editable} />
      </DashboardTabStrip>
    </div>
  );
}

/** The selected tab's label, key, domain, group code, order and Remove. */
function TabSettings({
  tabs,
  index,
  onChange,
  onSelect,
}: {
  tabs: readonly TemplateTabInput[];
  index: number;
  onChange: (tabs: TemplateTabInput[]) => void;
  onSelect: (index: number) => void;
}) {
  const tab = tabs[index]!;
  // The key is applied when the field is left: a key typed one letter at a time passes through
  // values (empty, a taken key) the tab list must never hold.
  const [keyDraft, setKeyDraft] = useState(tab.key);
  const [keyProblem, setKeyProblem] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  // A new key (a re-key, or another tab landing at this index after a remove) drops the old
  // draft and its refusal: the alert must never describe a tab it was not raised on.
  useEffect(() => {
    setKeyDraft(tab.key);
    setKeyProblem(null);
  }, [tab.key]);

  const vocabQ = useQuery({ queryKey: vocabulariesQueryKey, queryFn: fetchVocabularies });
  const domains = vocabQ.data?.assetDomains ?? [];
  const knownDomain = tab.domain === null || domains.some((domain) => domain.code === tab.domain);

  /**
   * Applies the typed key. An unchanged key is no edit, so it sends no `onChange` (which would
   * clear the page's Save problem, and fire twice on Enter then blur). A refused key keeps its
   * alert; on leaving the field the input goes back to the key Save will send.
   */
  function applyKey(via: "enter" | "blur"): void {
    if (keyDraft === tab.key) {
      setKeyProblem(null);
      return;
    }
    const result = rekeyTemplateTab(tabs, index, keyDraft);
    if (result.ok) {
      setKeyProblem(null);
      onChange(result.tabs);
    } else {
      setKeyProblem(result.problem);
      if (via === "blur") setKeyDraft(tab.key);
    }
  }

  function move(delta: -1 | 1): void {
    onChange(moveTemplateTab(tabs, index, delta));
    onSelect(index + delta);
  }

  return (
    <div className="mb-3 space-y-2 surface-raised-sm p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block text-xs font-semibold text-ink">
          Tab label
          <input
            value={tab.label}
            onChange={(event) => onChange(renameTemplateTab(tabs, index, event.target.value))}
            className="mt-1 w-full surface-field px-2 py-1 text-xs font-normal"
          />
        </label>
        <label className="block text-xs font-semibold text-ink">
          Tab key
          <input
            value={keyDraft}
            onChange={(event) => setKeyDraft(event.target.value)}
            onBlur={() => applyKey("blur")}
            onKeyDown={(event) => {
              if (event.key === "Enter") applyKey("enter");
            }}
            aria-invalid={keyProblem !== null}
            className="mt-1 w-full surface-field px-2 py-1 text-xs font-normal"
          />
        </label>
        <label className="block text-xs font-semibold text-ink">
          Domain
          <select
            value={tab.domain ?? ""}
            onChange={(event) =>
              onChange(setTemplateTabDomain(tabs, index, event.target.value === "" ? null : event.target.value))
            }
            className="mt-1 w-full surface-field px-2 py-1 text-xs font-normal"
          >
            <option value="">Overview (none)</option>
            {knownDomain ? null : <option value={tab.domain ?? ""}>{tab.domain}</option>}
            {domains.map((domain) => (
              <option key={domain.code} value={domain.code}>
                {domain.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs font-semibold text-ink">
          Group code
          <input
            value={tab.groupCode ?? ""}
            onChange={(event) => onChange(setTemplateTabGroupCode(tabs, index, event.target.value))}
            placeholder="Optional: breaks a tie between two groups"
            className="mt-1 w-full surface-field px-2 py-1 text-xs font-normal"
          />
        </label>
      </div>
      {keyProblem !== null ? (
        <p role="alert" className="text-xs text-critical-ink">
          {keyProblem}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => move(-1)} disabled={index === 0} className="surface-button px-2 py-1 disabled:opacity-60">
          Move up
        </button>
        <button
          type="button"
          onClick={() => move(1)}
          disabled={index === tabs.length - 1}
          className="surface-button px-2 py-1 disabled:opacity-60"
        >
          Move down
        </button>
        {confirmRemove ? null : (
          <button
            type="button"
            onClick={() => setConfirmRemove(true)}
            className="rounded border border-critical-line px-2 py-1 text-xs font-semibold text-critical-ink"
          >
            Remove tab
          </button>
        )}
      </div>
      {confirmRemove ? (
        <div role="alertdialog" aria-label="Remove the tab" className="space-y-2 rounded border border-critical-line p-2 text-xs">
          <p>
            Remove the tab “{tab.label || tab.key}”? It takes {plural(tab.widgets.length, "widget")} with it.
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={() => setConfirmRemove(false)} className="surface-button px-2 py-1">
              Keep the tab
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirmRemove(false);
                onChange(removeTemplateTab(tabs, index));
                onSelect(Math.max(0, index - 1));
              }}
              className="rounded border border-critical-line px-2 py-1 font-semibold text-critical-ink"
            >
              Remove tab and widgets
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** The selected tab's canvas and widget editors. */
function TabCanvas({
  tabs,
  index,
  onChange,
  editable,
}: {
  tabs: readonly TemplateTabInput[];
  index: number;
  onChange: (tabs: TemplateTabInput[]) => void;
  editable: boolean;
}) {
  const widgets = tabs[index]!.widgets;
  const atWidgetCap = widgets.length >= MAX_DASHBOARD_WIDGETS;
  const edit = (update: (current: SectionTemplateWidgetInput[]) => SectionTemplateWidgetInput[]) =>
    onChange(withTabWidgets(tabs, index, update));

  return (
    <div className="space-y-3">
      {editable ? (
        <button
          type="button"
          onClick={() => edit((current) => [...current, blankTemplateWidget()])}
          disabled={atWidgetCap}
          className="surface-button px-2 py-1 disabled:opacity-60"
        >
          Add widget to this tab
        </button>
      ) : null}
      {widgets.length === 0 ? (
        <p className="text-sm text-ink-muted">This tab has no widgets yet.</p>
      ) : (
        <DashboardCanvas tiles={widgets} renderTile={renderTemplateTile} />
      )}
      <div className="space-y-3">
        {widgets.map((row) => (
          <WidgetEditor
            key={row.key}
            row={row}
            editable={editable}
            onChange={(patch) =>
              edit((current) =>
                current.map((each) =>
                  // The cast `updateWidget` on the detail page explains: no patch changes the type.
                  each.key === row.key ? ({ ...each, ...patch } as SectionTemplateWidgetInput) : each,
                ),
              )
            }
            onRemove={() => edit((current) => current.filter((each) => each.key !== row.key))}
          />
        ))}
      </div>
    </div>
  );
}
