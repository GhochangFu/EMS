import type { SiteLayoutResultDto } from "@bms/shared";

/**
 * What one site's copy did, in one cell: the kept tabs, any tab the site could not hold, and any
 * role tile left out because it binds no point at the site (ADR 0087 Amendment 2).
 *
 * `F4.320` PR 2 — moved here from `apply-to-sites-dialog.tsx`: the dialog imports
 * `ReplaceSiteLayoutsWizard`, which used it too, and the import back made a cycle. The apply
 * dialog, the instantiate wizard, the site page's Make wizard and both Replace wizards share it.
 */
export function madeSummary(made: SiteLayoutResultDto): string {
  const kept = `${made.resolution.length} tab${made.resolution.length === 1 ? "" : "s"}`;
  const tabs = made.omittedTabs.length > 0 ? `, ${made.omittedTabs.length} omitted (no matching group)` : "";
  const tiles = made.omittedTiles.length;
  const left = tiles > 0 ? `, ${tiles} tile${tiles === 1 ? "" : "s"} left out (no point at the site)` : "";
  return `Made — ${kept}${tabs}${left}`;
}
