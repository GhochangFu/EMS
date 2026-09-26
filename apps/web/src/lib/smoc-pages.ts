import type { AccessibleScope } from "@bms/shared";

import { canAccessControlRoomArea, type ControlRoomArea } from "./control-room-access";

/** The seven SMOC tab keys, in the site page's tab-strip order (D2, D9). */
export type SmocTabKey = "overview" | "sld" | "ups" | "battery" | "hvac" | "env" | "it";

/** One tab: its key, its strip label (D9, no `CR ·` prefix), and its per-area rule (D3). */
export type SmocTab = {
  readonly key: SmocTabKey;
  readonly label: string;
  readonly area: ControlRoomArea;
};

/**
 * The seven SMOC tabs, in the order the shell's *Control Room 2D* group
 * listed them until `F3.66` U6 replaced that group with one *Control Room*
 * entry (D2, D3, D9). `F3.70` hosts them as tabs under one site page.
 */
export const SMOC_TABS: readonly SmocTab[] = [
  { key: "overview", label: "Main Dashboard", area: "overview" },
  { key: "sld", label: "Electrical SLD", area: "electrical" },
  { key: "ups", label: "UPS Monitoring", area: "upsBattery" },
  { key: "battery", label: "Battery Bank", area: "upsBattery" },
  { key: "hvac", label: "HVAC System", area: "hvac" },
  { key: "env", label: "Environment", area: "environment" },
  { key: "it", label: "IT & Rack Load", area: "it" },
];

/** The tab a bare `/control-room/site/:locationId` URL renders (D2, OQ2). */
export const DEFAULT_SMOC_TAB: SmocTabKey = "overview";

/** The one site whose resolved view is `builtin/smoc` (OQ3, D7). */
export const SMOC_SITE_CODE = "RSMOC-WC";

/** The URL for one SMOC tab on one site, encoded for the router path segment. */
export function smocTabPath(locationId: string, tab: SmocTabKey): string {
  return `/control-room/site/${encodeURIComponent(locationId)}/${tab}`;
}

/** Reads the optional `:tab` route param (D2): missing → `overview`, unknown → `null`. */
export function smocTabFromParam(param: string | undefined): SmocTabKey | null {
  if (param === undefined) {
    return DEFAULT_SMOC_TAB;
  }
  const match = SMOC_TABS.find((tab) => tab.key === param);
  return match ? match.key : null;
}

/** The tabs this scope's per-area rule allows (D3): the strip's content. */
export function allowedSmocTabs(scope: AccessibleScope | null): readonly SmocTab[] {
  return SMOC_TABS.filter((tab) => canAccessControlRoomArea(scope, tab.area));
}

/** Finds the `RSMOC-WC` row among readable sites (OQ3, D7), never assumes it is first. */
export function findSmocSite<T extends { readonly id: string; readonly code: string }>(
  items: readonly T[],
): T | undefined {
  return items.find((item) => item.code === SMOC_SITE_CODE);
}

/**
 * @deprecated `F3.70` U1 — replaced by `SMOC_TABS`. Kept only so
 * `pages/control-room/site-page.tsx` keeps building until U4 rewrites it to
 * `SmocSiteView`; U4 removes this export.
 */
export const SMOC_PAGES = SMOC_TABS.map((tab) => ({
  label: `CR · ${tab.label}`,
  path: `/cr-${tab.key}`,
})) as ReadonlyArray<{ readonly label: string; readonly path: string }>;
