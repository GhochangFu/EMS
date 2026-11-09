import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";

import { isOidcEnabled, startOidcLogout } from "../../api/oidc";
import {
  masterDataAreas,
  masterDataTabForPath,
  masterDataTabs,
  normalizeAdminPath,
  visibleMasterDataAreas,
} from "../../lib/admin-access";
import { useAuthStore, type AuthUser } from "../../stores/auth-store";
import { useCopilotSheet, useViewportSize } from "../../components/copilot/use-copilot-viewport";
import { useCopilotPagePush } from "../../stores/copilot-window-store";

/*
 * `F4.341` PR 5 (ADR 0118 decision 6) — the one navigation model every shell renders: the same
 * items, in the same order, with the same visibility and selection rules and the same routes. It
 * moved here from `app-shell.tsx` unchanged; `app-shell.tsx` re-exports the names other files
 * import. `sidebar-shell.tsx` (today's markup), `topbar-shell.tsx` and `rail-shell.tsx` differ only
 * in how they lay the items out.
 */

export const topNav = [
  { label: "Overview", to: "/" },
  { label: "Sites", to: "/map" },
  { label: "Energy", to: "/energy" },
] as const;

export const moduleGroups = [
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
 * area, linked to the area's first tab. Every master-data role sees that tab
 * whenever it sees the area (`master-data-areas.spec.ts` A5b holds this). An
 * area the role sees no tab of has no entry.
 */
export const adminModuleGroup = {
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

export const temporarilyHiddenModulePaths = new Set(["/sld", "/crac"]);

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

export function collapsedLabel(item: { readonly label: string; readonly path: string }): string {
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

/**
 * `F4.318` — the widest viewport, in px, on which the sidebar is a rail. Under Tailwind's `md`
 * (768 px) the expanded 240 px sidebar left a 390 px phone about 83 px of page, so there the shell
 * shows the collapsed rail, and an expanded sidebar lies over the page instead of pushing it.
 */
export const SHELL_RAIL_MAX_WIDTH = 767;

/** One module or administration entry, with its selection resolved for the current path. */
export type ShellItem = { readonly label: string; readonly path: string; readonly code: string; readonly selected: boolean };
export type ShellGroup = { readonly title: string; readonly items: readonly ShellItem[] };

/**
 * The state every shell shares: the visible groups (module groups, then Administration for a
 * master-data role), the scope label, logout, and the copilot push. The rules are the sidebar's
 * from before `F4.341`, moved as they were.
 */
export function useShellModel(user: AuthUser) {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
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
    return item.area === undefined
      ? normalizeAdminPath(location.pathname) === item.path
      : item.area === selectedAdminArea;
  }
  const visibleAreas = new Set<string>(visibleMasterDataAreas(user.role).map((area) => area.id));

  // F4.292 (ADR 0099 Amendment 9 E6): a docked copilot panel pushes the page by its width, not covers it.
  const viewport = useViewportSize();
  const copilotPush = useCopilotPagePush(useCopilotSheet(), viewport);

  return {
    location,
    scope,
    locationScopeLabel,
    isVisible,
    handleLogout,
    isModuleSelected,
    isAdminSelected,
    visibleAreas,
    viewport,
    copilotPush,
  };
}

/**
 * The visible groups as flat data, for the shells that lay the items out themselves (topbar,
 * rail): the module groups with their visible items (an empty group is dropped, `F4.156`), then
 * Administration for a master-data role, filtered to the areas the role sees.
 */
export function shellGroups(model: ReturnType<typeof useShellModel>, showAdmin: boolean): ShellGroup[] {
  const groups: ShellGroup[] = moduleGroups
    .map((group) => ({
      title: group.title,
      items: group.items
        .filter((m) => model.isVisible(m.path))
        .map((m) => ({ label: m.label, path: m.path, code: collapsedLabel(m), selected: model.isModuleSelected(m) })),
    }))
    .filter((group) => group.items.length > 0);
  if (showAdmin) {
    groups.push({
      title: adminModuleGroup.title,
      items: adminModuleGroup.items
        .filter((item) => !("area" in item) || model.visibleAreas.has(item.area))
        .map((item) => ({ label: item.label, path: item.path, code: collapsedLabel(item), selected: model.isAdminSelected(item) })),
    });
  }
  return groups;
}

/** Keeps the narrow-viewport overlay closed after a page change (`F4.318`). */
export function useOverlayClosesOnNavigation(pathname: string): [boolean, (next: (open: boolean) => boolean) => void] {
  const [overlayOpen, setOverlayOpen] = useState(false);
  useEffect(() => {
    setOverlayOpen(false);
  }, [pathname]);
  return [overlayOpen, setOverlayOpen];
}
