import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";

import { AppShell } from "../../layouts/app-shell";
import { visibleMasterDataTabs } from "../../lib/admin-access";
import type { AuthUser } from "../../stores/auth-store";
import { AdminBreadcrumb } from "./admin-breadcrumb";

type MasterDataLayoutProps = {
  user: AuthUser;
  children: ReactNode;
};

/** Shared chrome for master-data admin screens with tabs and breadcrumb. */
export function MasterDataLayout({ user, children }: MasterDataLayoutProps) {
  const location = useLocation();
  const tabs = visibleMasterDataTabs(user.role);

  return (
    <AppShell user={user} kpiRibbon={<span className="text-ink">Administration · Master Data</span>}>
      <div className="mx-auto max-w-[1200px] space-y-4 pb-8">
        <nav className="flex flex-wrap gap-1 border-b border-line pb-2">
          {tabs.map((tab) => {
            const active =
              location.pathname === tab.path ||
              (tab.path !== "/admin/organizations" &&
                location.pathname.startsWith(tab.path));
            return (
              <Link
                key={tab.path}
                to={tab.path}
                className={`rounded px-3 py-1.5 text-xs font-semibold ${
                  active
                    ? "bg-accent text-on-accent"
                    : "text-ink-muted hover:bg-well-deep hover:text-ink"
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
        <AdminBreadcrumb user={user} />
        {children}
      </div>
    </AppShell>
  );
}
