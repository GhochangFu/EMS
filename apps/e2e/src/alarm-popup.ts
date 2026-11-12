import type { Page } from "@playwright/test";

/**
 * `F4.357` (ADR 0130 decisions 7, 21; plan §4 U6, risk 5) — the alarm bar's "New alarms" popup.
 *
 * It sits fixed above the bar at the bottom centre of every signed-in page, and every page load
 * (a `goto` is a fresh tab) shows it for each unacknowledged alarm of rank >= 20, while the
 * simulator keeps raising alarms. A spec that clicks near the bottom of the page can therefore
 * find its target covered. This registers a handler that closes the popup ("Close" only marks the
 * rows seen — nothing is acknowledged) whenever it is in the way of an action, so a spec acts on
 * its own target. Call it once at the start of a test that signs in.
 */
export async function closeAlarmPopupWhenInTheWay(page: Page): Promise<void> {
  const popup = page.getByRole("region", { name: "New alarms" });
  await page.addLocatorHandler(popup, async () => {
    await popup.getByRole("button", { name: "Close", exact: true }).click();
  });
}
