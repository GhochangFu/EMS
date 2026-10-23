import { z } from "zod";

/**
 * `F3.8` request bodies (ADR 0041, ADR 0029 decision 1).
 *
 * `F4.279` (ADR 0030): the channel and rule-notification bodies moved to
 * `packages/shared/src/contracts/notification-writes.ts`, so the copilot catalog
 * carries them by identity; the deliveries query stays here.
 *
 * These are the objects the handlers `.parse()`, and the same objects
 * `openapi-registry.ts` points at — one description of each payload, not two.
 */

export const listDeliveriesQuerySchema = z.object({
  // The same bounded-list shape `listRuleExecutions` uses (ADR 0041 decision
  // 4): a limit, no cursor. The deliveries view is recent history, not an
  // infinite scroll.
  limit: z.coerce.number().int().min(1).max(500).default(100),
  channelId: z.string().uuid().optional(),
  ruleId: z.string().uuid().optional(),
});

export type ListDeliveriesQuery = z.infer<typeof listDeliveriesQuerySchema>;
