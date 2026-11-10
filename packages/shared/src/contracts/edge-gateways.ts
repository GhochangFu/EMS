import { z } from "zod";

import { UPLINK_CLOCK_STATES, UPLINK_TOKEN_PATTERN } from "../ingest-uplink";

/**
 * `E7.2` / ADR 0123 decisions 5 and 12 (plan T6.1) — the edge gateway admin's
 * response contracts (`/api/v1/admin/edge-gateways`, global `admin` only).
 *
 * **No hash field, and `.strict()` so one cannot slip in.** The DTO is what the
 * list and every write answer with; a `tokenHash` key added to a row mapper
 * fails this parse instead of being stripped (the `ai-assistant.ts` rule). The
 * token itself appears in exactly one schema, {@link edgeGatewayTokenResponseSchema},
 * the mint's one-time answer (§9.6: never stored, logged or audited).
 *
 * Plain `z.object`: nothing here is an intersection or all-readonly, so no
 * `z.intersection` or `.readonly()` applies — and a later change must not use
 * `.merge()` (ADR 0030). The types are exported from this file, not from
 * `src/index.ts`, which sits at the §4.5 cap (the `organization-ingest.ts`
 * precedent); `contracts/index.ts` re-exports them and the root re-exports that.
 */

/** A gateway is `active` or `revoked`; revoke is final (migration `0141`'s CHECK). */
export const EDGE_GATEWAY_STATUSES = ["active", "revoked"] as const;

export const edgeGatewayStatusSchema = z.enum(EDGE_GATEWAY_STATUSES);

/** The clock state the box last reported (decision 8); the uplink wire's vocabulary, declared once. */
export const edgeGatewayClockStateSchema = z.enum(UPLINK_CLOCK_STATES);

/** One RTU the gateway serves. */
export const edgeGatewayRtuSchema = z
  .object({
    id: z.string(),
    code: z.string(),
    /** The `deviceKey` the edge sends (`rtus.rtu_code`); an assigned RTU always has one. */
    rtuCode: z.string().nullable(),
    displayName: z.string(),
  })
  .strict();

/** One gateway row. Never the token, never its hash. */
export const edgeGatewayDtoSchema = z
  .object({
    id: z.string().uuid(),
    organizationId: z.string(),
    organizationCode: z.string(),
    organizationName: z.string(),
    locationId: z.string().nullable(),
    locationName: z.string().nullable(),
    code: z.string(),
    name: z.string(),
    status: edgeGatewayStatusSchema,
    /** The last four characters of the current token; `null` before the first mint. */
    tokenLast4: z.string().length(4).nullable(),
    tokenRotatedAt: z.string().nullable(),
    lastSeenAt: z.string().nullable(),
    reportedBacklog: z.number().int().nonnegative().nullable(),
    clockState: edgeGatewayClockStateSchema.nullable(),
    rtuCount: z.number().int().nonnegative(),
    rtus: z.array(edgeGatewayRtuSchema),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();

export const edgeGatewaysListResponseSchema = z.array(edgeGatewayDtoSchema);

/**
 * `POST /:id/token` — the token, once. The route answers `Cache-Control:
 * no-store`; a second mint replaces it, and nothing can read it back.
 */
export const edgeGatewayTokenResponseSchema = z
  .object({
    gateway: edgeGatewayDtoSchema,
    token: z.string().regex(UPLINK_TOKEN_PATTERN),
  })
  .strict();

export type EdgeGatewayStatus = z.infer<typeof edgeGatewayStatusSchema>;
export type EdgeGatewayClockState = z.infer<typeof edgeGatewayClockStateSchema>;
export type EdgeGatewayRtu = z.infer<typeof edgeGatewayRtuSchema>;
export type EdgeGatewayDto = z.infer<typeof edgeGatewayDtoSchema>;
export type EdgeGatewaysListResponse = z.infer<typeof edgeGatewaysListResponseSchema>;
export type EdgeGatewayTokenResponse = z.infer<typeof edgeGatewayTokenResponseSchema>;
