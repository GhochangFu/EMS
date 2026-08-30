import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { isOidcEnabled, startOidcLogout } from "../api/oidc";
import { isGlobalAdmin, isMasterDataAdmin, canWritePointKeys } from "../lib/admin-access";
import { canAccessControlRoomPath } from "../lib/control-room-access";
import { roleLabel } from "../lib/role-label";
import { useAuthStore, type AuthUser } from "../stores/auth-store";
import { StatusBarClock } from "../components/status-bar-clock";
import trinetraLogoUrl from "../assets/trinetra-logo.jpeg";

const topNav = [
  { label: "Overview", to: "/" },
  { label: "Sites", to: "/map" },
  { label: "Energy", to: "/energy" },
] as const;

const moduleGroups = [
  {
    title: "Operations",
    items: [
      { label: "Dashboard", path: "/" },
      { label: "Alarm Centre", path: "/alarms" },
      { label: "Dashboards", path: "/dashboards" },
      { label: "Sites Map", path: "/map" },
      { label: "Electrical SLD", path: "/sld" },
      { label: "HVAC · CRAC", path: "/crac" },
      { label: "Energy Analytics", path: "/energy" },
    ],
  },
  {
    title: "Control Room 2D",
    items: [
      { label: "CR · Main Dashboard", path: "/cr-overview" },
      { label: "CR · Electrical SLD", path: "/cr-sld" },
      { label: "CR · UPS Monitoring", path: "/cr-ups" },
      { label: "CR · Battery Bank", path: "/cr-battery" },
      { label: "CR · HVAC System", path: "/cr-hvac" },
      { label: "CR · Environment", path: "/cr-env" },
      { label: "CR · IT & Rack Load", path: "/cr-it" },
    ],
  },
  {
    title: "Maintenance",
    items: [
      { label: "Maintenance", path: "/work-orders" },
      { label: "Schedule Centre", path: "/maintenance-schedules" },
    ],
  },
  {
    title: "Automation",
    items: [
      { label: "Rule Engine", path: "/rules" },
      { label: "Reports", path: "/reports" },
    ],
  },
] as const;

const adminModuleGroup = {
  title: "Administration",
  items: [
    { label: "Master Data Hub", path: "/admin", globalOnly: false },
    { label: "Organizations", path: "/admin/organizations", globalOnly: false },
    { label: "Locations", path: "/admin/locations", globalOnly: false },
    { label: "RTUs", path: "/admin/rtus", globalOnly: false },
    { label: "Assets", path: "/admin/assets", globalOnly: false },
    { label: "Asset Points", path: "/admin/asset-points", globalOnly: false },
    { label: "Point Keys", path: "/admin/point-keys", catalogOnly: true },
  ],
} as const;

const temporarilyHiddenModulePaths = new Set(["/sld", "/crac"]);

function shortLabel(label: string): string {
  return label
    .replace(/^CR · /, "")
    .split(/\s+|·|&/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

type AppShellProps = {
  user: AuthUser;
  children: ReactNode;
  /**
   * Breadcrumb/KPI strip above the page body, matching the mockups' ribbon row
   * (`TRINETRA.html` `shell(...)` second argument). Required: every screen the
   * shell renders is post-authentication, so there is no state in which the
   * strip has nothing to say.
   */
  kpiRibbon: ReactNode;
};

export function AppShell({ user, children, kpiRibbon }: AppShellProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }
    return window.localStorage.getItem("bms-sidebar-collapsed") === "true";
  });
  const scope = useAuthStore((state) => state.scope);
  const oidcIdToken = useAuthStore((state) => state.oidcIdToken);
  const clearSession = useAuthStore((state) => state.clearSession);
  const locationScopeLabel =
    scope?.kind === "global"
      ? "Global access"
      : scope?.kind === "location"
        ? scope.locations.map((item) => item.name).join(", ") || "Location access"
        : scope?.kind === "asset_group"
          ? `${scope.locations.map((item) => item.name).join(", ")} · ${scope.assetGroups
              .map((item) => item.name)
              .join(", ")}`
          : "No assigned scope";

  function isVisible(path: string): boolean {
    if (temporarilyHiddenModulePaths.has(path)) {
      return false;
    }
    if (scope?.kind !== "asset_group") {
      return true;
    }
    if (path.startsWith("/cr-")) {
      return canAccessControlRoomPath(scope, path);
    }
    return true;
  }

  function handleLogout(): void {
    const logoutIdToken = oidcIdToken;
    clearSession();
    queryClient.clear();
    if (isOidcEnabled()) {
      startOidcLogout(logoutIdToken);
      return;
    }
    void navigate("/login", { replace: true });
  }

  function toggleSidebar(): void {
    setSidebarCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem("bms-sidebar-collapsed", String(next));
      return next;
    });
  }

  return (
    <div className="flex min-h-screen flex-col bg-bms-canvas text-bms-ink">
      <header className="flex h-12 shrink-0 items-center justify-between bg-bms-header px-4 text-sm text-white">
        <div className="flex items-center gap-3">
          <img
            src={trinetraLogoUrl}
            alt="TRINETRA"
            className="h-7 rounded bg-white px-2 py-1"
          />
          <span className="font-condensed text-lg font-bold tracking-tight text-bms-green">
            TRINETRA
          </span>
          <span className="hidden text-white/70 sm:inline">
            Intelligent Building Management System
          </span>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="font-medium">{user.displayName}</div>
            <div className="text-xs text-white/60">
              {roleLabel(user.role)} · {locationScopeLabel}
            </div>
          </div>
          <button
            type="button"
            className="rounded border border-white/20 px-3 py-1.5 text-xs font-semibold text-white/85 transition hover:border-white/40 hover:bg-white/10 hover:text-white"
            onClick={handleLogout}
          >
            Logout
          </button>
        </div>
      </header>

      <nav className="flex h-10 shrink-0 items-center gap-1 bg-bms-green-dark px-2 text-sm font-medium text-white shadow-sm">
        {topNav.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className={`rounded px-3 py-1.5 hover:bg-white/10 ${
              location.pathname === item.to ? "bg-white/15" : ""
            }`}
          >
            {item.label}
          </Link>
        ))}
        {isMasterDataAdmin(user.role) ? (
          <Link
            to="/admin"
            className={`rounded px-3 py-1.5 hover:bg-white/10 ${
              location.pathname.startsWith("/admin") ? "bg-white/15" : ""
            }`}
          >
            Settings
          </Link>
        ) : (
          <span
            className="ml-1 cursor-not-allowed rounded px-3 py-1.5 text-white/50"
            title="Administration requires admin or location_admin role"
          >
            Settings
          </span>
        )}
      </nav>

      <div className="flex min-h-0 flex-1">
        <aside
          className={`shrink-0 border-r border-gray-200 bg-white py-3 text-sm transition-[width] duration-200 ${
            sidebarCollapsed ? "w-16" : "w-60"
          }`}
        >
          <div className={`mb-3 flex items-center px-3 ${sidebarCollapsed ? "justify-center" : "justify-between"}`}>
            {sidebarCollapsed ? null : (
              <span className="font-condensed text-[11px] font-bold uppercase tracking-[0.16em] text-bms-muted">
                Modules
              </span>
            )}
            <button
              type="button"
              className="rounded border border-gray-200 bg-white px-2 py-1 font-mono text-xs font-semibold text-bms-muted transition hover:border-bms-green hover:bg-bms-canvas hover:text-bms-ink"
              aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              onClick={toggleSidebar}
            >
              {sidebarCollapsed ? "»" : "«"}
            </button>
          </div>
          {moduleGroups.map((group) => (
            <div key={group.title} className="mb-3">
              {sidebarCollapsed ? (
                <div className="mx-3 mb-1 border-t border-gray-100" title={group.title} />
              ) : (
                <div className="px-3 pb-1 font-condensed text-[11px] font-bold uppercase tracking-[0.16em] text-bms-muted">
                  {group.title}
                </div>
              )}
              <ul className="space-y-0.5">
                {group.items.filter((m) => isVisible(m.path)).map((m) => (
                  <li key={m.path}>
                    <Link
                      to={m.path}
                      title={m.label}
                      className={`block w-full border-l-2 hover:bg-bms-canvas ${
                        location.pathname === m.path
                          ? "border-bms-green bg-bms-canvas/80 font-semibold text-bms-ink"
                          : "border-transparent text-bms-muted"
                      } ${sidebarCollapsed ? "px-2 py-2 text-center font-condensed text-xs font-bold" : "px-3 py-1.5"}`}
                    >
                      {sidebarCollapsed ? shortLabel(m.label) : m.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {isMasterDataAdmin(user.role) ? (
            <div className="mb-3">
              {sidebarCollapsed ? (
                <div className="mx-3 mb-1 border-t border-gray-100" title={adminModuleGroup.title} />
              ) : (
                <div className="px-3 pb-1 font-condensed text-[11px] font-bold uppercase tracking-[0.16em] text-bms-muted">
                  {adminModuleGroup.title}
                </div>
              )}
              <ul className="space-y-0.5">
                {adminModuleGroup.items
                  .filter((item) => {
                    if ("catalogOnly" in item && item.catalogOnly) {
                      return canWritePointKeys(user.role);
                    }
                    if ("globalOnly" in item && item.globalOnly) {
                      return isGlobalAdmin(user.role);
                    }
                    return true;
                  })
                  .map((item) => (
                    <li key={item.path}>
                      <Link
                        to={item.path}
                        title={item.label}
                        className={`block w-full border-l-2 hover:bg-bms-canvas ${
                          location.pathname === item.path ||
                          (item.path !== "/admin" && location.pathname.startsWith(`${item.path}`))
                            ? "border-bms-green bg-bms-canvas/80 font-semibold text-bms-ink"
                            : "border-transparent text-bms-muted"
                        } ${sidebarCollapsed ? "px-2 py-2 text-center font-condensed text-xs font-bold" : "px-3 py-1.5"}`}
                      >
                        {sidebarCollapsed ? shortLabel(item.label) : item.label}
                      </Link>
                    </li>
                  ))}
              </ul>
            </div>
          ) : null}
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <section className="flex min-h-14 shrink-0 items-center border-b border-gray-200 bg-white px-4 py-2 text-xs text-bms-muted shadow-sm">
            <div className="flex w-full flex-wrap items-center gap-3">
              {kpiRibbon}
              {scope?.kind === "asset_group" ? (
                <span className="rounded border border-amber-300 bg-amber-50 px-2 py-1 font-semibold text-amber-800">
                  Limited asset-group access
                </span>
              ) : null}
            </div>
          </section>
          <div className="flex-1 overflow-auto bg-bms-canvas p-4">{children}</div>
        </main>
      </div>

      <footer className="flex h-8 shrink-0 items-center justify-between bg-bms-header px-4 text-xs text-white/70">
        <span className="flex items-center gap-2">
          <span>TRINETRA · telemetry-driven</span>
          <StatusBarClock />
        </span>
        <span className="flex items-center gap-2">
          <span className="font-mono">v0.1</span>
          <span className="text-bms-green">
            Powered By: <b className="text-white">Euphoria Infotech India Limited</b>
          </span>
        </span>
      </footer>
    </div>
  );
}
