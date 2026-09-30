import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";

import { AppShell } from "../../layouts/app-shell";
import { masterDataTabForPath, visibleMasterDataAreas } from "../../lib/admin-access";
import type { AuthUser } from "../../stores/auth-store";
import { AdminBreadcrumb } from "./admin-breadcrumb";

type MasterDataLayoutProps = {
  user: AuthUser;
  children: ReactNode;
};

/**
 * Shared chrome for master-data admin screens: the area tabs, the selected
 * area's sub-tabs and the breadcrumb (`F3.76`). The selection comes from
 * `masterDataTabForPath`, so a drill-down selects the level whose table it
 * shows.
 */
export function MasterDataLayout({ user, children }: MasterDataLayoutProps) {
  const location = useLocation();
  const areas = visibleMasterDataAreas(user.role);
  const selectedTab = masterDataTabForPath(location.pathname);
  const selectedArea = areas.find((area) => area.id === selectedTab?.area) ?? null;

  return (
    <AppShell
      user={user}
      kpiRibbon={
        <span className="text-ink">
          Administration · {selectedArea ? selectedArea.label : "Master Data"}
        </span>
      }
    >
      <div className="mx-auto max-w-[1200px] space-y-4 pb-8">
        <div className="space-y-2">
          <nav aria-label="Master data areas" className="flex flex-wrap gap-2">
            {areas.map((area) => {
              const active = area.id === selectedArea?.id;
              return (
                <Link
                  key={area.id}
                  to={area.path}
                  aria-current={active ? "page" : undefined}
                  className={`surface-tab px-3 py-1.5 text-sm font-semibold ${
                    active ? "surface-tab-selected" : ""
                  }`}
                >
                  {area.label}
                </Link>
              );
            })}
          </nav>
          {selectedArea ? (
            <nav
              aria-label={selectedArea.label}
              className="flex flex-wrap gap-1 border-b border-line pb-2"
            >
              {selectedArea.tabs.map((tab) => {
                const active = tab.path === selectedTab?.path;
                return (
                  <Link
                    key={tab.path}
                    to={tab.path}
                    aria-current={active ? "page" : undefined}
                    className={`surface-tab px-3 py-1.5 text-xs font-semibold ${
                      active ? "surface-tab-selected" : ""
                    }`}
                  >
                    {tab.label}
                  </Link>
                );
              })}
            </nav>
          ) : null}
        </div>
        <AdminBreadcrumb user={user} />
        {children}
      </div>
    </AppShell>
  );
}
