import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { isOidcEnabled, startOidcLogout } from "../api/oidc";
import {
  isMasterDataAdmin,
  masterDataAreas,
  masterDataTabForPath,
  masterDataTabs,
  visibleMasterDataAreas,
} from "../lib/admin-access";
import { roleLabel } from "../lib/role-label";
import { useAuthStore, type AuthUser } from "../stores/auth-store";
import { StatusBarClock } from "../components/status-bar-clock";
import { SystemStatusIndicator } from "../components/system-status-indicator";
import { SurfaceSwitch } from "../components/surface-switch";
import { ThemeSwitch } from "../components/theme-switch";
import { Wordmark } from "../components/wordmark";

const topNav = [
  { label: "Overview", to: "/" },
  { label: "Sites", to: "/map" },
  { label: "Energy", to: "/energy" },
] as const;

const moduleGroups = [
  {
    title: "Operations",
    items: [
      { label: "Alarm Centre", path: "/alarms" },
      // `F3.66` (ADR 0076 decision 1, OQ4) — one entry replaces the seven-item
      // *Control Room 2D* group. `nested`: it highlights for every
      // level under `/control-room/` too (plan D9); every other item is exact-match.
      // `F3.72` (ADR 0087 decision 1, plan D6) — it replaces *Dashboard* too, and
      // `alsoAt` highlights it on `/`, which renders the caller's entry level.
      { label: "Control Room", path: "/control-room", nested: true, alsoAt: "/" },
      { label: "Alarm Philosophy", path: "/alarm-kb" },
      { label: "Dashboards", path: "/dashboards" },
      // `E4.2` / ADR 0072 decision 1 — the reference sidebar carries
      // Sustainability beside Analytics and Reports; this group is the one that
      // holds Dashboards, which is what it opens.
      { label: "Sustainability", path: "/sustainability" },
      { label: "Assets", path: "/asset-browser" },
      { label: "Sites Map", path: "/map" },
      { label: "Electrical SLD", path: "/sld" },
      { label: "HVAC · CRAC", path: "/crac" },
      { label: "Energy Analytics", path: "/energy" },
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

/**
 * `F3.76` — the Administration group is the hub plus one entry per master-data
 * area. An area's `path` here is its first tab for the global `admin`; the
 * rendered link goes to the first tab the role sees, and an area the role sees
 * no tab of has no entry.
 */
const adminModuleGroup = {
  title: "Administration",
  items: [
    { label: "Master Data Hub", path: "/admin" },
    ...masterDataAreas.map((area) => ({
      label: area.label,
      path: masterDataTabs.find((tab) => tab.area === area.id)?.path ?? "/admin",
      area: area.id,
    })),
  ],
} as const;

const temporarilyHiddenModulePaths = new Set(["/sld", "/crac"]);

/**
 * `F4.164` (OQ-1) — the collapsed-rail code for an item whose `shortLabel`
 * collides with another item's, keyed by the item's path. The rule: on a
 * collision the later item in rail order (Operations, Maintenance,
 * Automation, then Administration) takes the override, and the earlier item
 * keeps its derived letters. `collapsedRailEntries()` is the uniqueness gate.
 * `/dashboards` kept `DS` when `F3.72` removed the *Dashboard* item it
 * collided with, so the collapsed rail does not change under its users.
 */
export const COLLAPSED_LABEL_OVERRIDES: Readonly<Record<string, string>> = {
  "/dashboards": "DS",
};

/**
 * `F4.164` (OQ-4) — why the top-nav Settings entry is locked. The button's
 * accessible description and its `title` both carry it.
 */
export const SETTINGS_LOCKED_REASON =
  "Administration requires an admin, organization_admin or location_admin role";

function shortLabel(label: string): string {
  return label
    .replace(/^CR · /, "")
    .split(/\s+|·|&/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function collapsedLabel(item: { readonly label: string; readonly path: string }): string {
  return COLLAPSED_LABEL_OVERRIDES[item.path] ?? shortLabel(item.label);
}

export type CollapsedRailEntry = {
  readonly path: string;
  readonly label: string;
  readonly code: string;
};

/** Every rail item of both lists, hidden ones included, with the code the collapsed rail shows. */
export function collapsedRailEntries(): CollapsedRailEntry[] {
  type RailItem = { readonly label: string; readonly path: string };
  const items: readonly RailItem[] = [
    ...moduleGroups.flatMap((group): readonly RailItem[] => group.items),
    ...adminModuleGroup.items,
  ];
  return items.map((item) => ({
    path: item.path,
    label: item.label,
    code: collapsedLabel(item),
  }));
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
    // `F3.66` — every scope but `none` sees the entry; a `null` scope (still
    // loading) does not. The API is the access control on every level.
    if (path === "/control-room") {
      return scope !== null && scope.kind !== "none";
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

  /**
   * A module link is selected on its own path, on a nested path under it when it says so, and on
   * its `alsoAt` path (`F3.72` — the Control Room entry on `/`).
   */
  function isModuleSelected(m: {
    readonly path: string;
    readonly nested?: boolean;
    readonly alsoAt?: string;
  }): boolean {
    return (
      location.pathname === m.path ||
      (m.nested === true && location.pathname.startsWith(`${m.path}/`)) ||
      (m.alsoAt !== undefined && location.pathname === m.alsoAt)
    );
  }

  /** `F3.76` — the hub is selected on `/admin`; an area on every path whose tab is in it. */
  const selectedAdminArea = masterDataTabForPath(location.pathname)?.area ?? null;
  function isAdminSelected(item: { readonly path: string; readonly area?: string }): boolean {
    return item.area === undefined ? location.pathname === item.path : item.area === selectedAdminArea;
  }
  const visibleAreaPaths = new Map(
    visibleMasterDataAreas(user.role).map((area) => [area.id as string, area.path]),
  );

  function toggleSidebar(): void {
    setSidebarCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem("bms-sidebar-collapsed", String(next));
      return next;
    });
  }

  return (
    <div className="flex min-h-screen flex-col bg-canvas text-ink">
      <header className="flex h-12 shrink-0 items-center justify-between bg-chrome px-4 text-sm text-on-dark">
        <div className="flex items-center gap-3">
          <Wordmark variant="header" />
          <span className="hidden text-on-dark/70 sm:inline">
            Integrated Building, Energy, Water & Utility Management Platform
          </span>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="font-medium">{user.displayName}</div>
            <div className="text-xs text-on-dark/60">
              {roleLabel(user.role)} · {locationScopeLabel}
            </div>
          </div>
          <ThemeSwitch />
          <SurfaceSwitch />
          <button
            type="button"
            className="rounded border border-on-dark/20 px-3 py-1.5 text-xs font-semibold text-on-dark/85 transition hover:border-on-dark/40 hover:bg-on-dark/10 hover:text-on-dark"
            onClick={handleLogout}
          >
            Logout
          </button>
        </div>
      </header>

      <nav className="flex h-10 shrink-0 items-center gap-1 bg-chrome-nav px-2 text-sm font-medium text-on-dark shadow-sm">
        {topNav.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className={`rounded px-3 py-1.5 hover:bg-on-dark/10 ${
              location.pathname === item.to ? "bg-on-dark/15" : ""
            }`}
          >
            {item.label}
          </Link>
        ))}
        {isMasterDataAdmin(user.role) ? (
          <Link
            to="/admin"
            className={`rounded px-3 py-1.5 hover:bg-on-dark/10 ${
              location.pathname.startsWith("/admin") ? "bg-on-dark/15" : ""
            }`}
          >
            Settings
          </Link>
        ) : (
          <>
            {/* F4.164 D2 — not `DisabledCommandButton`: it sets native `disabled` (not focusable),
                has no slot for the reason, and its palette is for light surfaces. */}
            <button
              type="button"
              aria-disabled="true"
              aria-describedby="settings-locked-reason"
              title={SETTINGS_LOCKED_REASON}
              onClick={(e) => e.preventDefault()}
              className="ml-1 cursor-not-allowed rounded px-3 py-1.5 text-on-dark/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-on-dark/80"
            >
              Settings
            </button>
            <span id="settings-locked-reason" className="sr-only">
              {SETTINGS_LOCKED_REASON}
            </span>
          </>
        )}
      </nav>

      <div className="flex min-h-0 flex-1">
        <aside
          className={`surface-sidebar shrink-0 py-3 text-sm transition-[width] duration-200 ${
            sidebarCollapsed ? "w-16" : "w-60"
          }`}
        >
          <div className={`mb-3 flex items-center px-3 ${sidebarCollapsed ? "justify-center" : "justify-between"}`}>
            {sidebarCollapsed ? null : (
              <span className="font-condensed text-[11px] font-bold uppercase tracking-[0.16em] text-ink-muted">
                Modules
              </span>
            )}
            <button
              type="button"
              className="surface-button px-2 py-1 font-mono transition hover:border-accent"
              aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              onClick={toggleSidebar}
            >
              {sidebarCollapsed ? "»" : "«"}
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
                {sidebarCollapsed ? (
                  <div className="mx-3 mb-1 border-t border-well-deep" title={group.title} />
                ) : (
                  <div className="px-3 pb-1 font-condensed text-[11px] font-bold uppercase tracking-[0.16em] text-ink-muted">
                    {group.title}
                  </div>
                )}
                <ul className="space-y-0.5">
                  {visible.map((m) => (
                    <li key={m.path}>
                      <Link
                        to={m.path}
                        title={m.label}
                        // F4.164 — WCAG 2.5.3: a collapsed name carries the visible code; expanded, the label is the name.
                        aria-label={sidebarCollapsed ? `${m.label} (${collapsedLabel(m)})` : undefined}
                        aria-current={isModuleSelected(m) ? "page" : undefined}
                        className={`surface-nav-item block ${isModuleSelected(m) ? "surface-nav-item-selected" : ""} ${sidebarCollapsed ? "px-2 py-2 text-center font-condensed text-xs font-bold" : "px-3 py-1.5"}`}
                      >
                        {sidebarCollapsed ? collapsedLabel(m) : m.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          {isMasterDataAdmin(user.role) ? (
            <div className="mb-3">
              {sidebarCollapsed ? (
                <div className="mx-3 mb-1 border-t border-well-deep" title={adminModuleGroup.title} />
              ) : (
                <div className="px-3 pb-1 font-condensed text-[11px] font-bold uppercase tracking-[0.16em] text-ink-muted">
                  {adminModuleGroup.title}
                </div>
              )}
              <ul className="space-y-0.5">
                {adminModuleGroup.items
                  .filter((item) => !("area" in item) || visibleAreaPaths.has(item.area))
                  .map((item) => (
                    <li key={item.path}>
                      <Link
                        to={"area" in item ? (visibleAreaPaths.get(item.area) ?? item.path) : item.path}
                        title={item.label}
                        aria-label={sidebarCollapsed ? `${item.label} (${collapsedLabel(item)})` : undefined}
                        aria-current={isAdminSelected(item) ? "page" : undefined}
                        className={`surface-nav-item block ${isAdminSelected(item) ? "surface-nav-item-selected" : ""} ${sidebarCollapsed ? "px-2 py-2 text-center font-condensed text-xs font-bold" : "px-3 py-1.5"}`}
                      >
                        {sidebarCollapsed ? collapsedLabel(item) : item.label}
                      </Link>
                    </li>
                  ))}
              </ul>
            </div>
          ) : null}
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <section className="surface-ribbon flex min-h-14 shrink-0 items-center px-4 py-2 text-xs text-ink-muted">
            <div className="flex w-full flex-wrap items-center gap-3">
              {kpiRibbon}
              {scope?.kind === "asset_group" ? (
                <span className="rounded border border-warning-line bg-warning-wash px-2 py-1 font-semibold text-warning-ink">
                  Limited asset-group access
                </span>
              ) : null}
            </div>
          </section>
          <div className="flex-1 overflow-auto bg-canvas p-4">{children}</div>
        </main>
      </div>

      <footer className="flex h-8 shrink-0 items-center justify-between bg-chrome px-4 text-xs text-on-dark/70">
        <span className="flex items-center gap-2">
          <span>IONSiTE NEXUS · telemetry-driven</span>
          <StatusBarClock />
          <SystemStatusIndicator />
        </span>
        <span className="flex items-center gap-2">
          <span className="font-mono">v0.1</span>
          <span className="text-accent">
            Powered By: <b className="text-on-dark">Euphoria Infotech India Limited</b>
          </span>
        </span>
      </footer>
    </div>
  );
}
