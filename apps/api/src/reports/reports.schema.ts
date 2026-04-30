import { z } from "zod";

export const energyReportQuerySchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export type EnergyReportQuery = z.infer<typeof energyReportQuerySchema>;
