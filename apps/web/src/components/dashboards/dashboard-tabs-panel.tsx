import { useEffect, useState } from "react";

import type { TabWritePayload } from "../../lib/dashboard-builder-form";
import { SectionCard } from "../section-card";

/** One group a tab may bind — a group at the dashboard's site. */
export type TabGroupOption = { readonly id: string; readonly name: string };

/**
 * The read of the groups at the dashboard's site. Only `loaded` knows which groups the site holds,
 * so only `loaded` may call a bound group missing from the list "A group at another site"; the
 * other states say the list is unknown (review fix: an empty list while the read was pending,
 * failed or disabled labelled every correctly bound tab that way).
 */
export type TabGroups =
  | { readonly status: "loaded"; readonly items: readonly TabGroupOption[] }
  | { readonly status: "loading" }
  | { readonly status: "failed"; readonly message: string }
  /** The read is not made (the role cannot read `/admin/asset-groups`). */
  | { readonly status: "unavailable" };

type DashboardTabsPanelProps = {
  tabs: readonly TabWritePayload[];
  /**
   * The groups at the dashboard's site, or `null` when the scope is not a location: only a site
   * dashboard carries group tabs (the API's `TAB_GROUP_SCOPE_MESSAGE`), so no select renders.
   */
  groups: TabGroups | null;
  /** How many widgets sit on each tab, by key — the remove button says what it takes with it. */
  widgetCounts: ReadonlyMap<string, number>;
  onAdd: () => void;
  onLabel: (index: number, label: string) => void;
  /** Answers `false` when another tab holds the key, so the field can say so. */
  onKey: (index: number, key: string) => boolean;
  onGroup: (index: number, assetGroupId: string | null) => void;
  onMove: (index: number, delta: -1 | 1) => void;
  onRemove: (index: number) => void;
};

/**
 * `F3.73` (plan D11) — the builder's "Tabs" panel: add, rename, re-key, reorder, remove, and
 * bind a tab to one of the site's asset groups.
 *
 * Presentation only. Every edit is a pure function in `lib/dashboard-builder-form.ts`
 * (`addBuilderTab`, `renameBuilderTabKey`, `moveBuilderTab`, `removeBuilderTab`), where it is
 * tested; the rules (a well-formed, unique, unreserved key and a label) are
 * `dashboardBuilderErrors`', shown in the page summary.
 */
export function DashboardTabsPanel({
  tabs,
  groups,
  widgetCounts,
  onAdd,
  onLabel,
  onKey,
  onGroup,
  onMove,
  onRemove,
}: DashboardTabsPanelProps) {
  const groupItems = groups?.status === "loaded" ? groups.items : [];
  return (
    <SectionCard
      title="Tabs"
      actions={
        <button type="button" onClick={onAdd} className="surface-button px-2 py-1">
          Add tab
        </button>
      }
    >
      {tabs.length === 0 ? (
        <p className="text-xs text-ink-muted">
          This dashboard has one canvas. Add a tab to split it; the first tab takes every widget
          already on the canvas.
        </p>
      ) : (
        <ol className="space-y-2">
          {tabs.map((tab, index) => {
            const n = index + 1;
            const count = widgetCounts.get(tab.key) ?? 0;
            return (
              <li key={`${index}-${tab.key}`} className="grid gap-2 text-xs md:grid-cols-[1fr_1fr_1fr_auto]">
                <input
                  aria-label={`Tab ${n} label`}
                  value={tab.label}
                  onChange={(event) => onLabel(index, event.target.value)}
                  className="surface-field px-2 py-1.5"
                />
                <TabKeyField n={n} value={tab.key} onCommit={(key) => onKey(index, key)} />
                {groups !== null ? (
                  <select
                    aria-label={`Tab ${n} asset group`}
                    value={tab.assetGroupId ?? ""}
                    onChange={(event) => onGroup(index, event.target.value || null)}
                    className="surface-field px-2 py-1.5"
                  >
                    <option value="">No group (overview)</option>
                    {/* A group the list does not hold keeps its own option, so the select never
                        shows another group's name. Only a loaded list can say the group is at
                        another site (the scope moved); otherwise the list is not known yet. */}
                    {tab.assetGroupId !== null && !groupItems.some((group) => group.id === tab.assetGroupId) ? (
                      <option value={tab.assetGroupId}>{unlistedGroupLabel(groups)}</option>
                    ) : null}
                    {groupItems.map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.name}
                      </option>
                    ))}
                  </select>
                ) : tab.assetGroupId !== null ? (
                  // The scope left its location with the tab still bound (the page summary says so):
                  // the select is gone, so the binding needs its own way out.
                  <button
                    type="button"
                    aria-label={`Clear tab ${n} group`}
                    onClick={() => onGroup(index, null)}
                    className="surface-button px-2 py-1"
                  >
                    Clear its group
                  </button>
                ) : (
                  <span className="self-center text-ink-muted">Group tabs need a location scope.</span>
                )}
                <div className="flex gap-1">
                  <button
                    type="button"
                    aria-label={`Move tab ${n} up`}
                    disabled={index === 0}
                    onClick={() => onMove(index, -1)}
                    className="surface-button px-2 py-1 disabled:opacity-60"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={`Move tab ${n} down`}
                    disabled={index === tabs.length - 1}
                    onClick={() => onMove(index, 1)}
                    className="surface-button px-2 py-1 disabled:opacity-60"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove tab ${n}`}
                    onClick={() => onRemove(index)}
                    className="surface-button border-critical-line px-2 py-1 text-critical-ink"
                  >
                    {count > 0 ? `Remove (and its ${count} widget${count === 1 ? "" : "s"})` : "Remove"}
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {tabs.length > 0 && groups?.status === "loading" ? (
        <p className="mt-2 text-xs text-ink-muted">Loading the site's asset groups…</p>
      ) : null}
      {tabs.length > 0 && groups?.status === "failed" ? (
        <p className="mt-2 text-xs text-critical-ink">The site's asset groups did not load: {groups.message}</p>
      ) : null}
    </SectionCard>
  );
}

/** The option label of a bound group the list does not hold, by what the read knows. */
function unlistedGroupLabel(groups: TabGroups): string {
  switch (groups.status) {
    case "loaded":
      return "A group at another site";
    case "loading":
      return "Loading its group…";
    case "failed":
    case "unavailable":
      return "Its group (not loaded)";
  }
}

/**
 * The key is the route segment and the widgets follow it, so it applies on blur (or Enter), not
 * on every keystroke: a key typed through another tab's key on the way would otherwise be refused
 * half-typed. A key another tab holds is refused here and the draft stays for the author to fix.
 */
function TabKeyField({ n, value, onCommit }: { n: number; value: string; onCommit: (key: string) => boolean }) {
  const [draft, setDraft] = useState(value);
  const [taken, setTaken] = useState<string | null>(null);
  useEffect(() => {
    setDraft(value);
  }, [value]);

  function commit(): void {
    if (draft === value) {
      setTaken(null);
      return;
    }
    setTaken(onCommit(draft) ? null : draft);
  }

  return (
    <div>
      <input
        aria-label={`Tab ${n} key`}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            commit();
          }
        }}
        className="surface-field w-full px-2 py-1.5 font-mono"
      />
      {taken !== null ? (
        <span className="block text-[11px] text-critical-ink">Another tab already uses the key "{taken}".</span>
      ) : null}
    </div>
  );
}
