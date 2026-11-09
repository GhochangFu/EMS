import { Link } from "react-router-dom";

import { isMasterDataAdmin } from "../../lib/admin-access";
import { roleLabel } from "../../lib/role-label";
import { CopilotDock } from "../../components/copilot/copilot-dock";
import { StatusBarClock } from "../../components/status-bar-clock";
import { SurfaceSwitch } from "../../components/surface-switch";
import { SystemStatusIndicator } from "../../components/system-status-indicator";
import { ThemeSwitch } from "../../components/theme-switch";
import { Wordmark } from "../../components/wordmark";
import { shellGroups, topNav, useCollapsibleNav, useShellModel } from "./navigation-model";
import { ShellMain } from "./shell-footer";
import { AppearanceButton } from "./shell-header";
import type { AppShellProps } from "./shell-props";

/** `F4.346` — the store key of the rail's collapsed choice, apart from the sidebar's. */
export const RAIL_COLLAPSED_STORAGE_KEY = "bms-rail-collapsed";

/** `F4.346` — the collapsed codes of the rail's top entries (one word each, so two letters). */
const TOP_CODES: Readonly<Record<string, string>> = { Overview: "OV", Sites: "SI", Energy: "EN", Settings: "SE" };

type RailEntry = { readonly label: string; readonly path: string; readonly code: string; readonly selected: boolean };

/**
 * `F4.341` PR 5 (ADR 0118 decision 6, plan D7) — the `rail` shell (`control-room-dark`): a thin
 * header with a live status strip (the clock and the system status), and a pinned rail down the
 * left with **text labels on every item** (≥ 12px, never revealed on hover: a wall has no hover,
 * Amendment 1 A6). The rail lists the top navigation, then the same groups and items as the sidebar,
 * in the same order and with the same rules. The wordmark and logout are in the header.
 *
 * `F4.346` (ADR 0118 Amendment 3 decision 2) — the rail collapses as the sidebar does
 * (`useCollapsibleNav`): it opens expanded with text labels, its button collapses it to 64 px codes
 * with the full label as each link's accessible name, the choice is stored under
 * `bms-rail-collapsed`, and at ≤ `SHELL_RAIL_MAX_WIDTH` it is a 64 px slot whose expanded rail lies
 * over the page and closes on navigation (`F4.318`).
 */
export function RailShell({ user, children, kpiRibbon }: AppShellProps) {
  const model = useShellModel(user);
  const groups = shellGroups(model, isMasterDataAdmin(user.role));
  const top: RailEntry[] = [
    ...topNav.map((item) => ({ label: item.label, path: item.to, selected: model.location.pathname === item.to })),
    ...(isMasterDataAdmin(user.role)
      ? [{ label: "Settings", path: "/admin", selected: model.location.pathname.startsWith("/admin") }]
      : []),
  ].map((item) => ({ ...item, code: TOP_CODES[item.label] ?? item.label.slice(0, 2).toUpperCase() }));
  const { collapsed, narrow, overlay, toggle } = useCollapsibleNav(
    RAIL_COLLAPSED_STORAGE_KEY,
    model.location.pathname,
    model.viewport.width,
  );
  const toggleName = collapsed ? "Expand rail" : "Collapse rail";

  function entry(item: RailEntry) {
    return (
      <li key={item.path}>
        <Link
          to={item.path}
          title={item.label}
          // F4.164 — WCAG 2.5.3: a collapsed name carries the visible code; expanded, the label is the name.
          aria-label={collapsed ? `${item.label} (${item.code})` : undefined}
          aria-current={item.selected ? "page" : undefined}
          className={`surface-nav-item block ${item.selected ? "surface-nav-item-selected" : ""} ${
            collapsed ? "px-2 py-2 text-center font-bold" : "px-3 py-1.5"
          }`}
        >
          {collapsed ? item.code : item.label}
        </Link>
      </li>
    );
  }

  return (
    <div className="flex min-h-screen flex-col surface-page text-ink" style={{ paddingRight: `${model.copilotPush}px` }}>
      <header className="flex h-10 shrink-0 items-center justify-between gap-3 bg-chrome px-4 text-xs text-on-dark">
        <div className="flex items-center gap-3">
          <Wordmark variant="header" />
          <span className="flex items-center gap-2 text-on-dark/80" data-testid="rail-status-strip">
            <StatusBarClock />
            <SystemStatusIndicator />
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-on-dark/80">
            {user.displayName} · {roleLabel(user.role)} · {model.locationScopeLabel}
          </span>
          <ThemeSwitch />
          <SurfaceSwitch />
          <AppearanceButton />
          <button
            type="button"
            className="rounded border border-on-dark/20 px-3 py-1 text-xs font-semibold text-on-dark/85 transition hover:border-on-dark/40 hover:bg-on-dark/10 hover:text-on-dark"
            onClick={model.handleLogout}
          >
            Logout
          </button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        {/* F4.318 — on a narrow viewport the rail keeps a 64 px slot in the row, and the expanded
            rail lies over the page from that slot. */}
        <div className={narrow ? "relative w-16 shrink-0" : "contents"} data-testid="rail-slot">
          <aside
            data-testid="rail-aside"
            className={`surface-sidebar shrink-0 overflow-y-auto py-2 text-xs transition-[width] duration-200 ${
              collapsed ? "w-16" : "w-44"
            } ${narrow ? "absolute inset-y-0 left-0" : ""} ${overlay ? "z-30 shadow-lg" : ""}`}
          >
            <div className={`mb-2 flex px-3 ${collapsed ? "justify-center" : "justify-end"}`}>
              <button
                type="button"
                className="surface-button px-2 py-1 font-mono transition hover:border-accent"
                aria-label={toggleName}
                title={toggleName}
                onClick={toggle}
              >
                {collapsed ? "»" : "«"}
              </button>
            </div>
            <nav aria-label="Modules">
              <ul className="space-y-0.5">{top.map(entry)}</ul>
              {groups.map((group) => (
                <div key={group.title} className="mt-3">
                  {collapsed ? (
                    <div className="mx-3 mb-1 border-t border-well-deep" title={group.title} />
                  ) : (
                    <div className="px-3 pb-1 text-xs text-ink-muted">{group.title}</div>
                  )}
                  <ul className="space-y-0.5">{group.items.map(entry)}</ul>
                </div>
              ))}
            </nav>
          </aside>
        </div>
        <ShellMain kpiRibbon={kpiRibbon} scope={model.scope}>
          {children}
        </ShellMain>
      </div>
      <CopilotDock user={user} />
    </div>
  );
}
