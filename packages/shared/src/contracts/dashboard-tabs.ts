import { z } from "zod";

/**
 * `F3.73` (plan D1, D2) — the dashboard tab contracts.
 *
 * A tab is a named group of widgets on one dashboard. Its `key` is the route segment the site page
 * reads, so it is a lowercase slug, and it may not spell a segment the site page owns.
 */

/**
 * The site page's Assets & RTUs `:tab` segment (`F3.72`, plan D4). Declared here once: the web's
 * `smoc-pages.ts` imports it, and the tab key schema below refuses it, so a dashboard tab can
 * never shadow the assets view.
 */
export const SITE_ASSETS_TAB = "assets";

/**
 * The site page's Trends & Energy `:tab` segment (`F4.302`, ADR 0108 Amendment 4 item 1). Declared
 * here once, like {@link SITE_ASSETS_TAB}: the web's `smoc-pages.ts` re-exports it.
 */
export const SITE_TRENDS_TAB = "trends";

/**
 * Tab keys a dashboard tab may not use — the segments the site page renders itself.
 *
 * This list and the `dashboard_tabs_tab_key_check` CHECK (migration `0119`) are two declarations
 * of one list; `tests/f4.302-dashboard-tab-key-trends.test.ts` compares them.
 */
export const RESERVED_DASHBOARD_TAB_KEYS: readonly string[] = [SITE_ASSETS_TAB, SITE_TRENDS_TAB];

/**
 * The most tabs one dashboard carries. The cap is on tabs, not widgets: `MAX_DASHBOARD_WIDGETS`
 * still bounds each tab's canvas.
 */
export const MAX_DASHBOARD_TABS = 8;

/**
 * A tab key. The regex and the reserved-key refusal repeat the `dashboard_tabs` key CHECK, so an
 * author gets a 400 naming the field instead of a 500 carrying a constraint name.
 */
export const dashboardTabKeySchema = z
  .string()
  .regex(/^[a-z0-9-]{1,64}$/)
  .refine((key) => !RESERVED_DASHBOARD_TAB_KEYS.includes(key), {
    message: "that tab key is reserved",
  });

/**
 * A tab as read.
 *
 * `assetGroupId` is null for the Overview tab (no group). `key` carries no reserved-key or regex
 * check here: a read contract states what the store can hold, and the CHECK is the store's.
 */
export const dashboardTabDtoSchema = z.object({
  id: z.string().uuid(),
  dashboardId: z.string().uuid(),
  organizationId: z.string().uuid(),
  key: z.string(),
  label: z.string(),
  sortOrder: z.number().int(),
  assetGroupId: z.string().uuid().nullable(),
});
