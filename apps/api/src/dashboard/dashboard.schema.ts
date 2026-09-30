import { z } from "zod";

export const locationDashboardQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(10),
  rtuId: z.string().uuid().optional(),
});

/**
 * `F3.72` — `GET /dashboard/load-trend`. `window` keeps its free-form string
 * (the service parses and refuses an unknown one); `organizationId` narrows
 * only, by the `F3.66` rule: the controller swaps in
 * `readableAssetIdsInOrganization`, the readable set intersected with that
 * organization's assets. An unreadable organization answers an empty series,
 * not a 403. A malformed id is a 400 before access control runs.
 */
export const loadTrendQuerySchema = z.object({
  window: z.string().optional(),
  organizationId: z.string().uuid().optional(),
});

export type LoadTrendQuery = z.infer<typeof loadTrendQuerySchema>;

export type LocationDashboardQuery = z.infer<typeof locationDashboardQuerySchema>;
