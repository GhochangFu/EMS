import { z } from "zod";

/**
 * `F3.10` escalation-profile request schemas (ADR 0057 decision 7, plan D8/D15).
 *
 * `F4.279` (ADR 0030): the three request bodies moved to
 * `packages/shared/src/contracts/escalation-writes.ts`, so the copilot catalog
 * carries them by identity; the defaults query stays here.
 */

/**
 * `GET /admin/escalation-defaults?organizationId=…`.
 *
 * Left permissive, matching its sibling `listDeliveriesQuerySchema` in this
 * module: D15 governs request *bodies*, and the 2026-08-28 owner ruling
 * recorded in `strict-body-ledger.spec.ts` keeps query schemas outside the
 * strictness audit.
 */
export const escalationDefaultsQuerySchema = z.object({
  organizationId: z.string().uuid().optional(),
});

export type EscalationDefaultsQuery = z.infer<typeof escalationDefaultsQuerySchema>;
