import { expect } from "vitest";

import { adminOrganizationDtoSchema, adminOrganizationSummaryDtoSchema, adminRtuDtoSchema } from "./admin";
import { setOrganizationIngestBodySchema } from "./organization-ingest";

/**
 * `F4.330` (ADR 0115 decisions 3 and 4) — the body of `PUT /admin/organizations/:id/ingest` and the
 * three response fields that carry the switch. Pure: no database. The sibling `.test.ts` carries
 * the `it()`s (ADR 0014).
 */

/** G1 — `{ ingestEnabled: boolean }` passes, either way. */
export function runABooleanBodyPasses(): void {
  expect(setOrganizationIngestBodySchema.safeParse({ ingestEnabled: false }).success).toBe(true);
  expect(setOrganizationIngestBodySchema.safeParse({ ingestEnabled: true }).success).toBe(true);
}

/** G2 — a string, a missing key and an extra key (`.strict()`) are each a 400. */
export function runABadBodyIsRefused(): void {
  expect(setOrganizationIngestBodySchema.safeParse({ ingestEnabled: "false" }).success).toBe(false);
  expect(setOrganizationIngestBodySchema.safeParse({}).success).toBe(false);
  expect(setOrganizationIngestBodySchema.safeParse({ ingestEnabled: true, name: "x" }).success).toBe(false);
}

/** G3 — the organization DTO, its summary and the RTU DTO each require the boolean. */
export function runTheResponsesRequireTheSwitch(): void {
  const org = {
    id: "o1",
    code: "ORG",
    name: "Org",
    active: true,
    currency: "INR",
    timezone: "UTC",
    colourProfile: "nexus",
    meta: null,
    createdAt: "2026-11-07T00:00:00.000Z",
  };
  expect(adminOrganizationDtoSchema.safeParse({ ...org, ingestEnabled: false }).success).toBe(true);
  expect(adminOrganizationDtoSchema.safeParse(org).success).toBe(false);
  expect(adminOrganizationDtoSchema.safeParse({ ...org, ingestEnabled: "false" }).success).toBe(false);

  const summary = { id: "o1", code: "ORG", name: "Org" };
  expect(adminOrganizationSummaryDtoSchema.safeParse({ ...summary, ingestEnabled: true }).success).toBe(true);
  expect(adminOrganizationSummaryDtoSchema.safeParse(summary).success).toBe(false);

  const rtu = {
    id: "r1",
    locationId: "l1",
    locationName: "Loc",
    organizationCode: "ORG",
    code: "RTU-1",
    displayName: "RTU 1",
    sourceType: "mqtt",
    domain: null,
    externalRtuId: null,
    rtuCode: null,
    mqttTopic: null,
    releasedMqttTopic: null,
    stationCode: null,
    stationName: null,
    ingestEnabled: true,
    active: true,
    meta: null,
    createdAt: "2026-11-07T00:00:00.000Z",
    tls: null,
    payloadFormat: null,
  };
  const parsed = adminRtuDtoSchema.safeParse({ ...rtu, organizationIngestEnabled: false });
  expect(parsed.success).toBe(true);
  // The RTU's own box and the organization's switch are two fields (ADR 0115 decision 4).
  expect(parsed.data?.ingestEnabled).toBe(true);
  expect(parsed.data?.organizationIngestEnabled).toBe(false);
  expect(adminRtuDtoSchema.safeParse(rtu).success).toBe(false);
}
