/*
 * `F4.348` — the navigation icon table, data only (no React, no store), so a `tests/` gate can read
 * it without the web runtime. `navigation-model.ts` re-exports it.
 */

/**
 * `F4.348` (ADR 0118 Amendment 4 decisions 1–2, plan's icon table) — each navigation item's icon,
 * a key of the repo's Lucide shapes, keyed by the item's label: the module items (hidden ones
 * included), the Administration hub and areas, and the rail's top entries. Collapsed, the icon
 * replaces the letter code `F4.164` showed; `navIconEntries()` is the unique-icon gate.
 */
export const NAV_ICONS = {
  Overview: "house",
  Sites: "building",
  Energy: "zap",
  Settings: "settings",
  "Alarm Centre": "bell",
  "Control Room": "monitor",
  "Alarm Philosophy": "shield-alert",
  Dashboards: "layout-dashboard",
  Sustainability: "leaf",
  Assets: "boxes",
  "Sites Map": "map-pin",
  "Electrical SLD": "plug-zap",
  "HVAC · CRAC": "fan",
  "Energy Analytics": "chart-line",
  Maintenance: "wrench",
  "Schedule Centre": "clock",
  "Rule Engine": "cpu",
  Reports: "activity",
  "Master Data Hub": "database",
  "Sites & Equipment": "factory",
  "Reference Data": "key",
  "Templates & Visuals": "package",
  "Data Input": "plug",
  Notifications: "bell-ring",
  "Users & Access": "users",
} as const;

export type NavIconKey = (typeof NAV_ICONS)[keyof typeof NAV_ICONS];

/** An item's icon; an item missing from the table fails loudly (the I1 gate keeps it total). */
export function navIcon(label: string): NavIconKey {
  const icon = (NAV_ICONS as Readonly<Record<string, NavIconKey>>)[label];
  if (icon === undefined) throw new Error(`no navigation icon for "${label}"`);
  return icon;
}
