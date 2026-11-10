import { z } from "zod";

/**
 * `E7.2` / ADR 0123 decision 12 (plan T6.1) — the edge gateway admin's write
 * bodies. Each is `.strict()`: every field is named and there is no open-ended
 * data, so an unknown key is a caller error (the strict-body ledger's
 * `CALLER_ERROR`). No body here carries a token or a hash — the mint route
 * takes no body at all, so nothing secret can reach an audited body (§4.7's
 * standing obligation).
 */

/** The catalog code charset (`assets_code_charset_check`), 64 characters as the column. */
export const edgeGatewayCodeSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, "Use letters, digits, '-' and '_' only");

const nameSchema = z.string().trim().min(1).max(128);

/** The most RTUs one `PUT /:id/rtus` names. */
export const EDGE_GATEWAY_MAX_RTUS = 500;

/** `POST /admin/edge-gateways`. The location, when named, must be in the organization (404 otherwise). */
export const createEdgeGatewayBodySchema = z
  .object({
    organizationId: z.string().uuid(),
    locationId: z.string().uuid().nullable().optional(),
    code: edgeGatewayCodeSchema,
    name: nameSchema,
  })
  .strict();

/** `PATCH /:id` — rename or move; the code and organization never change. An empty body is the service's 400. */
export const updateEdgeGatewayBodySchema = z
  .object({
    name: nameSchema.optional(),
    locationId: z.string().uuid().nullable().optional(),
  })
  .strict();

/** `PUT /:id/rtus` — the whole assigned set; `[]` unassigns every RTU. A repeated id is the service's 400. */
export const putEdgeGatewayRtusBodySchema = z
  .object({
    rtuIds: z.array(z.string().uuid()).max(EDGE_GATEWAY_MAX_RTUS),
  })
  .strict();

export type CreateEdgeGatewayBody = z.infer<typeof createEdgeGatewayBodySchema>;
export type UpdateEdgeGatewayBody = z.infer<typeof updateEdgeGatewayBodySchema>;
export type PutEdgeGatewayRtusBody = z.infer<typeof putEdgeGatewayRtusBodySchema>;
