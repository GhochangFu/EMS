import { z } from "zod";

import { alarmSkillCodeSchema } from "@bms/shared";

/**
 * `PUT /api/v1/alarms/:id/enrichment` request body (ADR 0034 decision 6).
 *
 * Declared here, not in `packages/shared/src/contracts/`: AGENTS.md §3 /
 * ADR 0030 decision 3 — request schemas stay in `apps/api`, matching
 * `ack.schema.ts` beside it. Only *response* contracts (`alarmDetailsResponseSchema`,
 * `alarmEnrichmentDtoSchema`, etc.) live in the shared package, because those
 * are what `apps/web`'s `checkResponse` validates against. Nothing needs this
 * body schema on the web side — `apps/web/src/api/alarms.ts` types its own
 * request payload locally, the same way `ackAlarm` does.
 */
export const alarmEnrichmentUpsertBodySchema = z
  .object({
    rootCause: z.string().max(2000).nullable().optional(),
    impact: z.string().max(2000).nullable().optional(),
    correctiveActions: z.string().max(2000).nullable().optional(),
    energyImpact: z.string().max(2000).nullable().optional(),
    waterImpact: z.string().max(2000).nullable().optional(),
    productionImpact: z.string().max(2000).nullable().optional(),
    /** No future-only refinement — revising a passed ETR is legitimate. */
    etrAt: z.string().datetime({ offset: true }).nullable().optional(),
    skillCode: alarmSkillCodeSchema.nullable().optional(),
    affectedAssetIds: z.array(z.string().uuid()).max(50).optional(),
  })
  .strict();

export type AlarmEnrichmentUpsertBody = z.infer<typeof alarmEnrichmentUpsertBodySchema>;
