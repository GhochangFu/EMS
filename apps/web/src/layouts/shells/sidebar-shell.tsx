import { Link } from "react-router-dom";

import { isMasterDataAdmin } from "../../lib/admin-access";
import { CopilotDock } from "../../components/copilot/copilot-dock";
import { NavIcon } from "./nav-icon";
import type { AppShellProps } from "./shell-props";
import { ShellFooter, ShellMain } from "./shell-footer";
import { ShellHeader, ShellTopNav } from "./shell-header";
import {
  adminModuleGroup,
  moduleGroups,
  navIcon,
  useCollapsibleNav,
  useShellModel,
} from "./navigation-model";

/**
 * `F4.341` PR 5 (ADR 0118 decision 6) — the `sidebar` shell: the chrome header, the top navigation
 * bar and the module sidebar, which is the app shell as it was before `F4.341`, moved here
 * verbatim. `sidebar-shell-markup.spec.tsx` holds the rendered markup byte for byte to a fixture
 * captured before the move.
 *
 * `F4.346` (ADR 0118 Amendment 3 decision 1) — four design systems render it (`nexus-soft`,
 * `enterprise-flat`, `swiss-grid`, `bento-ops`); `swiss-grid` and `bento-ops` skin it in
 * `index.css` with tokens only, so the markup is the same in all four. The sidebar's slot is the
 * `nav[aria-label="Modules"]` landmark, outside the `<aside>`, so the fixture still holds.
 *
 * `F4.348` (ADR 0118 Amendment 4) — every item carries its icon (`NavIcon`) before its label;
 * collapsed, the icon replaces the letter code. The markup fixture was re-captured for the icons.
 */
export function SidebarShell({ user, children, kpiRibbon }: AppShellProps) {
  const { location, scope, locationScopeLabel, isVisible, handleLogout, isModuleSelected, isAdminSelected, visibleAreas, viewport, copilotPush } =
    useShellModel(user);
  // F4.318 — on a narrow viewport the rail is the default and the stored choice is not read or
  // written: a desktop "expanded" must not eat a phone's page. An expanded sidebar there is an
  // overlay, and a move to another page closes it.
  const {
    collapsed,
    narrow,
    overlay,
    toggle: toggleSidebar,
  } = useCollapsibleNav("bms-sidebar-collapsed", location.pathname, viewport.width);

  return (
    <div className="alarm-bar-clearance flex min-h-screen flex-col surface-page text-ink" style={{ paddingRight: `${copilotPush}px` }}>
      <ShellHeader
        user={user}
        locationScopeLabel={locationScopeLabel}
        onLogout={handleLogout}
        // F4.347 — the header's own width: the docked Copilot pushes the page in from the right.
        viewportWidth={viewport.width - copilotPush}
        pathname={location.pathname}
      />

      <ShellTopNav user={user} pathname={location.pathname} />

      <div className="flex min-h-0 flex-1">
        {/* F4.318 — on a narrow viewport the rail keeps a 64 px slot in the row, and the expanded
            sidebar lies over the page from that slot rather than taking 240 px of it. */}
        <nav aria-label="Modules" className={narrow ? "relative w-16 shrink-0" : "contents"} data-testid="shell-sidebar-slot">
          <aside
            className={`surface-sidebar shrink-0 py-3 text-sm transition-[width] duration-200 ${
              collapsed ? "w-16" : "w-60"
            } ${narrow ? "absolute inset-y-0 left-0 overflow-y-auto" : ""} ${overlay ? "z-30 shadow-lg" : ""}`}
          >
            <div className={`mb-3 flex items-center px-3 ${collapsed ? "justify-center" : "justify-between"}`}>
              {collapsed ? null : (
                <span className="font-condensed text-2xs font-bold uppercase tracking-[0.16em] text-ink-muted">
                  Modules
                </span>
              )}
              <button
                type="button"
                className="surface-button px-2 py-1 font-mono transition hover:border-accent"
                aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                onClick={toggleSidebar}
              >
                {collapsed ? "»" : "«"}
              </button>
            </div>
            {moduleGroups.map((group) => {
              const visible = group.items.filter((m) => isVisible(m.path));
              // `F4.156` — a group with no visible item hides its heading too.
              if (visible.length === 0) {
                return null;
              }
              return (
                <div key={group.title} className="mb-3">
                  {collapsed ? (
                    <div className="mx-3 mb-1 border-t border-well-deep" title={group.title} />
                  ) : (
                    <div className="px-3 pb-1 font-condensed text-2xs font-bold uppercase tracking-[0.16em] text-ink-muted">
                      {group.title}
                    </div>
                  )}
                  <ul className="space-y-0.5">
                    {visible.map((m) => (
                      <li key={m.path}>
                        <Link
                          to={m.path}
                          title={m.label}
                          // F4.348 — collapsed, the icon replaces the code and the link is named by its label.
                          aria-label={collapsed ? m.label : undefined}
                          aria-current={isModuleSelected(m) ? "page" : undefined}
                          className={`surface-nav-item flex items-center gap-2 ${isModuleSelected(m) ? "surface-nav-item-selected" : ""} ${collapsed ? "justify-center px-2 py-2" : "px-3 py-1.5"}`}
                        >
                          <NavIcon icon={navIcon(m.label)} />
                          {collapsed ? null : m.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
            {isMasterDataAdmin(user.role) ? (
              <div className="mb-3">
                {collapsed ? (
                  <div className="mx-3 mb-1 border-t border-well-deep" title={adminModuleGroup.title} />
                ) : (
                  <div className="px-3 pb-1 font-condensed text-2xs font-bold uppercase tracking-[0.16em] text-ink-muted">
                    {adminModuleGroup.title}
                  </div>
                )}
                <ul className="space-y-0.5">
                  {adminModuleGroup.items
                    .filter((item) => !("area" in item) || visibleAreas.has(item.area))
                    .map((item) => (
                      <li key={item.path}>
                        <Link
                          to={item.path}
                          title={item.label}
                          aria-label={collapsed ? item.label : undefined}
                          aria-current={isAdminSelected(item) ? "page" : undefined}
                          className={`surface-nav-item flex items-center gap-2 ${isAdminSelected(item) ? "surface-nav-item-selected" : ""} ${collapsed ? "justify-center px-2 py-2" : "px-3 py-1.5"}`}
                        >
                          <NavIcon icon={navIcon(item.label)} />
                          {collapsed ? null : item.label}
                        </Link>
                      </li>
                    ))}
                </ul>
              </div>
            ) : null}
          </aside>
        </nav>

        <ShellMain kpiRibbon={kpiRibbon} scope={scope}>
          {children}
        </ShellMain>
      </div>

      <ShellFooter />
      {/* F3.85 PR 7: the copilot dock. It renders nothing for a role outside
          `canAuthorDashboards` or when `GET /copilot/status` says unavailable. */}
      <CopilotDock user={user} />
    </div>
  );
}
