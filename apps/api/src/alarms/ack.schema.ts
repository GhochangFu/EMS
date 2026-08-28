import { z } from "zod";

export const alarmAckBodySchema = z
  .object({
    reason: z.string().min(3).max(2000),
  })
  .strict();

export type AlarmAckBody = z.infer<typeof alarmAckBodySchema>;
