import { Link } from "react-router-dom";

import { isMasterDataAdmin } from "../../lib/admin-access";
import { CopilotDock } from "../../components/copilot/copilot-dock";
import { shellGroups, useShellModel } from "./navigation-model";
import { ShellFooter, ShellMain } from "./shell-footer";
import { ShellHeader, ShellTopNav } from "./shell-header";
import type { AppShellProps } from "./shell-props";

/**
 * `F4.341` PR 5 (ADR 0118 decision 6) — the `topbar` shell (`swiss-grid`, `bento-ops`): the chrome
 * header, the top navigation bar, and the module items as one horizontal tab strip under it, in
 * the sidebar's order, with the same visibility rules. The strip scrolls sideways when the items
 * do not fit (plan §8 risk 5), so no item is hidden; each group starts with its title as text.
 */
export function TopbarShell({ user, children, kpiRibbon }: AppShellProps) {
  const model = useShellModel(user);
  const groups = shellGroups(model, isMasterDataAdmin(user.role));
  return (
    <div className="flex min-h-screen flex-col surface-page text-ink" style={{ paddingRight: `${model.copilotPush}px` }}>
      <ShellHeader user={user} locationScopeLabel={model.locationScopeLabel} onLogout={model.handleLogout} />
      <ShellTopNav user={user} pathname={model.location.pathname} />
      {/* The ribbon shape is on a wrapper: the chrome (header, nav, footer) carries no surface class (f3.71 V6). */}
      <div className="surface-ribbon shrink-0 overflow-x-auto px-2 py-1 text-sm">
        <nav aria-label="Modules">
        <ul className="flex w-max items-center gap-1">
          {groups.map((group) => (
            <li key={group.title} className="flex items-center gap-1">
              <span className="px-2 text-xs text-ink-muted">{group.title}</span>
              <ul className="flex items-center gap-1">
                {group.items.map((item) => (
                  <li key={item.path}>
                    <Link
                      to={item.path}
                      aria-current={item.selected ? "page" : undefined}
                      className={`surface-tab block whitespace-nowrap px-3 py-1.5 ${item.selected ? "surface-tab-selected" : ""}`}
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
        </nav>
      </div>
      <div className="flex min-h-0 flex-1">
        <ShellMain kpiRibbon={kpiRibbon} scope={model.scope}>
          {children}
        </ShellMain>
      </div>
      <ShellFooter />
      <CopilotDock user={user} />
    </div>
  );
}
