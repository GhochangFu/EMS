import { Link } from "react-router-dom";

import { isMasterDataAdmin } from "../../lib/admin-access";
import { roleLabel } from "../../lib/role-label";
import { CopilotDock } from "../../components/copilot/copilot-dock";
import { StatusBarClock } from "../../components/status-bar-clock";
import { SurfaceSwitch } from "../../components/surface-switch";
import { SystemStatusIndicator } from "../../components/system-status-indicator";
import { ThemeSwitch } from "../../components/theme-switch";
import { Wordmark } from "../../components/wordmark";
import { shellGroups, topNav, useShellModel } from "./navigation-model";
import { ShellMain } from "./shell-footer";
import { AppearanceButton } from "./shell-header";
import type { AppShellProps } from "./shell-props";

/**
 * `F4.341` PR 5 (ADR 0118 decision 6, plan D7) — the `rail` shell (`control-room-dark`): a thin
 * header with a live status strip (the clock and the system status), and a pinned rail down the
 * left with **text labels on every item** (≥ 12px, never revealed on hover: a wall has no hover,
 * Amendment 1 A6). The rail lists the top navigation, then the same groups and items as the sidebar,
 * in the same order and with the same rules. The wordmark and logout are in the header.
 */
export function RailShell({ user, children, kpiRibbon }: AppShellProps) {
  const model = useShellModel(user);
  const groups = shellGroups(model, isMasterDataAdmin(user.role));
  const top = [
    ...topNav.map((item) => ({ label: item.label, path: item.to, selected: model.location.pathname === item.to })),
    ...(isMasterDataAdmin(user.role)
      ? [{ label: "Settings", path: "/admin", selected: model.location.pathname.startsWith("/admin") }]
      : []),
  ];
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
        <aside className="surface-sidebar w-44 shrink-0 overflow-y-auto py-2 text-xs">
          <nav aria-label="Modules">
          <ul className="space-y-0.5">
            {top.map((item) => (
              <li key={item.path}>
                <Link
                  to={item.path}
                  aria-current={item.selected ? "page" : undefined}
                  className={`surface-nav-item block px-3 py-1.5 ${item.selected ? "surface-nav-item-selected" : ""}`}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
          {groups.map((group) => (
            <div key={group.title} className="mt-3">
              <div className="px-3 pb-1 text-xs text-ink-muted">{group.title}</div>
              <ul className="space-y-0.5">
                {group.items.map((item) => (
                  <li key={item.path}>
                    <Link
                      to={item.path}
                      aria-current={item.selected ? "page" : undefined}
                      className={`surface-nav-item block px-3 py-1.5 ${item.selected ? "surface-nav-item-selected" : ""}`}
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          </nav>
        </aside>
        <ShellMain kpiRibbon={kpiRibbon} scope={model.scope}>
          {children}
        </ShellMain>
      </div>
      <CopilotDock user={user} />
    </div>
  );
}
