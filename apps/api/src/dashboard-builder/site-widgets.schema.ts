import { z } from "zod";

import { dashboardTabKeySchema } from "@bms/shared";

/**
 * `F3.73` (plan D9, Task 3.4) — the query of `GET /api/v1/dashboards/:id/site-widgets`. `tab` is
 * the dashboard tab's key (the tab-key rule the write path stores); absent, the read covers the
 * dashboard's own scope — the Overview of a site layout, or a dashboard with no tabs. `.strict()`:
 * an unknown key is a 400, not a silently ignored filter.
 */
export const siteWidgetsQuerySchema = z
  .object({
    // `.describe()` AFTER the shared refinement (ADR 0029 decision 10): the document emits
    // nothing for the reserved-key refusal, so without this line it would promise that `assets`
    // is accepted.
    tab: dashboardTabKeySchema
      .describe(
        "The dashboard tab's key: lowercase letters, digits and hyphens, 1 to 64 characters. " +
          "`assets` is reserved. Absent, the read covers the dashboard's own scope.",
      )
      .optional(),
  })
  .strict();

export type SiteWidgetsQuery = z.infer<typeof siteWidgetsQuerySchema>;
