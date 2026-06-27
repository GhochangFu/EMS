import { z } from "zod";

export const locationDashboardQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(10),
  rtuId: z.string().uuid().optional(),
});

export type LocationDashboardQuery = z.infer<typeof locationDashboardQuerySchema>;
