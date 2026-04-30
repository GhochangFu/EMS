import { z } from "zod";

export const ruleToggleBodySchema = z.object({
  enabled: z.boolean(),
  reason: z.string().min(3).max(2000).optional(),
});

export const listRuleExecutionsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export type RuleToggleBody = z.infer<typeof ruleToggleBodySchema>;
export type ListRuleExecutionsQuery = z.infer<
  typeof listRuleExecutionsQuerySchema
>;
