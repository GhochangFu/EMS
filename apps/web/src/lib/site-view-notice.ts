import type { SiteControlRoomViewNotice } from "@bms/shared";

/**
 * `F3.66` / `F3.67` (ADR 0076 decision 5) — the fail-safe banner text for the
 * resolve read's `notice` field. `null` means the site's configured view
 * resolved cleanly, so the banner does not render (`U4`).
 */
export function siteViewNoticeText(
  notice: SiteControlRoomViewNotice | null,
): string | null {
  switch (notice) {
    case "dashboard_removed":
      return "The dashboard configured for this site has been removed. Showing the generated view instead.";
    case "dashboard_out_of_scope":
      return "The dashboard configured for this site is no longer in your access scope. Showing the generated view instead.";
    case "builtin_unknown":
      return "The built-in view configured for this site is no longer available. Showing the generated view instead.";
    default:
      return null;
  }
}
