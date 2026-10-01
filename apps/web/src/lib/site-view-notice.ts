import type { SiteControlRoomViewNotice } from "@bms/shared";

/**
 * `F3.73` critique — the banner's tone. `no_site_layout` is a state ("not made yet"), not a
 * fault, so it reads as information; the fail-safe codes mean a configured view is gone or out
 * of reach and keep the warning tone.
 */
export function siteViewNoticeTone(notice: SiteControlRoomViewNotice): "info" | "warning" {
  return notice === "no_site_layout" ? "info" : "warning";
}

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
    // `F3.73` (ruling Q5) — no view row yet, and the organization has a published site template.
    case "no_site_layout":
      return "This site has no site layout yet. Showing the generated view.";
    default:
      return null;
  }
}
