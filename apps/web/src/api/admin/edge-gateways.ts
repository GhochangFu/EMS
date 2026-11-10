import type { QueryClient } from "@tanstack/react-query";
import {
  edgeGatewayDtoSchema,
  edgeGatewaysListResponseSchema,
  edgeGatewayTokenResponseSchema,
} from "@bms/shared/contracts";
import type {
  CreateEdgeGatewayBody,
  EdgeGatewayDto,
  EdgeGatewaysListResponse,
  EdgeGatewayTokenResponse,
  UpdateEdgeGatewayBody,
} from "@bms/shared";

import { adminFetch } from "./client";

/**
 * `E7.2` / ADR 0123 decision 12 (plan T6.3) — the edge gateways at
 * `/admin/edge-gateways`. Every route, the read included, is the global
 * `admin`'s. The mint's token is returned to the caller and never cached here:
 * no query holds it, so it lives only in the dialog that shows it.
 */
export const edgeGatewaysQueryKey = ["admin", "edge-gateways"] as const;

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const path = (id: string, rest = ""): string => `/admin/edge-gateways/${encodeURIComponent(id)}${rest}`;

/** `GET /admin/edge-gateways` — every gateway, with its RTUs; never a token or its hash. */
export async function fetchEdgeGateways(): Promise<EdgeGatewaysListResponse> {
  return adminFetch("/admin/edge-gateways", edgeGatewaysListResponseSchema);
}

/** `POST /admin/edge-gateways` — a new gateway with no token; mint one separately. */
export async function createEdgeGateway(input: CreateEdgeGatewayBody): Promise<EdgeGatewayDto> {
  return adminFetch("/admin/edge-gateways", edgeGatewayDtoSchema, json("POST", input));
}

/** `PATCH /admin/edge-gateways/:id` — rename or move; the code and organization never change. */
export async function updateEdgeGateway(id: string, input: UpdateEdgeGatewayBody): Promise<EdgeGatewayDto> {
  return adminFetch(path(id), edgeGatewayDtoSchema, json("PATCH", input));
}

/** Final: a revoked gateway can never hold a token again. Its RTUs return to the cloud. */
export async function revokeEdgeGateway(id: string): Promise<EdgeGatewayDto> {
  return adminFetch(path(id, "/revoke"), edgeGatewayDtoSchema, { method: "POST" });
}

/** Mints or rotates the token; the answer is the only time it is ever shown. */
export async function mintEdgeGatewayToken(id: string): Promise<EdgeGatewayTokenResponse> {
  return adminFetch(path(id, "/token"), edgeGatewayTokenResponseSchema, { method: "POST", cache: "no-store" });
}

/** Replaces the assigned set; `[]` unassigns every RTU. */
export async function putEdgeGatewayRtus(id: string, rtuIds: readonly string[]): Promise<EdgeGatewayDto> {
  return adminFetch(path(id, "/rtus"), edgeGatewayDtoSchema, json("PUT", { rtuIds }));
}

/** Refetches the gateway list after a write; the token is never in it. */
export async function invalidateEdgeGatewayReads(queryClient: QueryClient): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: edgeGatewaysQueryKey });
}
