import { expect } from "vitest";

import { UPLINK_TOKEN_PATTERN } from "../ingest-uplink";
import {
  createEdgeGatewayBodySchema,
  EDGE_GATEWAY_MAX_RTUS,
  putEdgeGatewayRtusBodySchema,
  updateEdgeGatewayBodySchema,
} from "./edge-gateway-writes";
import {
  edgeGatewayDtoSchema,
  edgeGatewaysListResponseSchema,
  edgeGatewayTokenResponseSchema,
} from "./edge-gateways";

/**
 * `E7.2` / ADR 0123 decisions 5 and 12 (plan T6.1) — the edge gateway admin's
 * contracts. Vitest entry point: the sibling `.test.ts`.
 */

const ORG = "00000000-0000-4000-8000-0000000000a1";
const LOC = "00000000-0000-4000-8000-0000000000b1";
const RTU = "00000000-0000-4000-8000-0000000000c1";

export const GATEWAY_DTO = {
  id: "00000000-0000-4000-8000-0000000000d1",
  organizationId: ORG,
  organizationCode: "PHE",
  organizationName: "PHE",
  locationId: LOC,
  locationName: "Plant 1",
  code: "GW-1",
  name: "Plant 1 box",
  status: "active",
  tokenLast4: "AbC_",
  tokenRotatedAt: "2026-11-10T00:00:00.000Z",
  lastSeenAt: null,
  reportedBacklog: 12,
  clockState: "unsynced",
  rtuCount: 1,
  rtus: [{ id: RTU, code: "R1", rtuCode: "PHE-1", displayName: "RTU 1" }],
  createdAt: "2026-11-10T00:00:00.000Z",
  updatedAt: "2026-11-10T00:00:00.000Z",
} as const;

/** A token as the mint makes it: `bmsgw_` and 43 base64url characters. */
export const A_TOKEN = `bmsgw_${"A".repeat(42)}_`;

/** C1 — the DTO parses a full row, and refuses any hash or token key (`.strict()`). */
export function theDtoCarriesNoSecret(): void {
  expect(edgeGatewayDtoSchema.safeParse(GATEWAY_DTO).success).toBe(true);
  expect(edgeGatewaysListResponseSchema.safeParse([GATEWAY_DTO]).success).toBe(true);
  for (const leak of [{ tokenHash: "00" }, { token_hash: "00" }, { token: A_TOKEN }]) {
    expect(edgeGatewayDtoSchema.safeParse({ ...GATEWAY_DTO, ...leak }).success, JSON.stringify(Object.keys(leak))).toBe(false);
  }
  expect(Object.keys(edgeGatewayDtoSchema.shape).filter((key) => /hash|^token$/i.test(key))).toEqual([]);
}

/** C2 — the vocabularies are closed: `status` and `clockState` refuse a value outside them. */
export function theVocabulariesAreClosed(): void {
  expect(edgeGatewayDtoSchema.safeParse({ ...GATEWAY_DTO, status: "paused" }).success).toBe(false);
  expect(edgeGatewayDtoSchema.safeParse({ ...GATEWAY_DTO, clockState: "drifting" }).success).toBe(false);
  expect(edgeGatewayDtoSchema.safeParse({ ...GATEWAY_DTO, status: "revoked", clockState: null, tokenLast4: null }).success).toBe(true);
  expect(edgeGatewayDtoSchema.safeParse({ ...GATEWAY_DTO, tokenLast4: "abcde" }).success).toBe(false);
}

/** C3 — the token response holds a token of the uplink's own pattern, and nothing else beside the row. */
export function theTokenResponseIsItsOwnSchema(): void {
  expect(UPLINK_TOKEN_PATTERN.test(A_TOKEN)).toBe(true);
  expect(edgeGatewayTokenResponseSchema.safeParse({ gateway: GATEWAY_DTO, token: A_TOKEN }).success).toBe(true);
  expect(edgeGatewayTokenResponseSchema.safeParse({ gateway: GATEWAY_DTO, token: "bmsgw_short" }).success).toBe(false);
  expect(edgeGatewayTokenResponseSchema.safeParse({ gateway: GATEWAY_DTO, token: A_TOKEN, tokenHash: "00" }).success).toBe(false);
}

/** C4 — the write bodies are strict and bounded. */
export function theWriteBodiesAreStrict(): void {
  expect(createEdgeGatewayBodySchema.safeParse({ organizationId: ORG, code: "GW-1", name: "Box" }).success).toBe(true);
  expect(createEdgeGatewayBodySchema.safeParse({ organizationId: ORG, locationId: null, code: "GW-1", name: "Box" }).success).toBe(true);
  expect(createEdgeGatewayBodySchema.safeParse({ organizationId: ORG, code: "GW 1", name: "Box" }).success).toBe(false);
  expect(createEdgeGatewayBodySchema.safeParse({ organizationId: ORG, code: "GW-1", name: "  " }).success).toBe(false);
  expect(createEdgeGatewayBodySchema.safeParse({ organizationId: "nope", code: "GW-1", name: "Box" }).success).toBe(false);
  expect(
    createEdgeGatewayBodySchema.safeParse({ organizationId: ORG, code: "GW-1", name: "Box", tokenHash: "00" }).success,
  ).toBe(false);

  expect(updateEdgeGatewayBodySchema.safeParse({ name: "Renamed" }).success).toBe(true);
  expect(updateEdgeGatewayBodySchema.safeParse({ locationId: null }).success).toBe(true);
  expect(updateEdgeGatewayBodySchema.safeParse({ code: "GW-2" }).success).toBe(false);
  expect(updateEdgeGatewayBodySchema.safeParse({ status: "active" }).success).toBe(false);

  expect(putEdgeGatewayRtusBodySchema.safeParse({ rtuIds: [] }).success).toBe(true);
  expect(putEdgeGatewayRtusBodySchema.safeParse({ rtuIds: [RTU] }).success).toBe(true);
  expect(putEdgeGatewayRtusBodySchema.safeParse({ rtuIds: ["R1"] }).success).toBe(false);
  expect(putEdgeGatewayRtusBodySchema.safeParse({ rtuIds: [RTU], extra: true }).success).toBe(false);
  expect(putEdgeGatewayRtusBodySchema.safeParse({ rtuIds: Array.from({ length: EDGE_GATEWAY_MAX_RTUS + 1 }, () => RTU) }).success).toBe(false);
}
