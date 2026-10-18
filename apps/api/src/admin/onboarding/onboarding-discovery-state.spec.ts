import { expect } from "vitest";

import { readDiscovery } from "./onboarding-discovery-state";

/** F3.24b U1 — `readDiscovery` maps the stored shape to the DTO and fails closed. Entry: the sibling `.test.ts`. */

const STORED = {
  discoveryId: "11111111-1111-4111-8111-111111111111",
  rtuCode: "R1",
  topicFilter: "a/#",
  windowSeconds: 60,
  status: "queued",
  startedAt: null,
  finishedAt: null,
  truncated: false,
  devices: [],
  queuedAt: "2026-10-18T00:00:00.000Z",
  messages: 0,
  skipped: 0,
};

export function aStoredDiscoveryReadsAsTheDto(): void {
  const dto = readDiscovery({ _discovery: STORED });
  expect(dto?.discoveryId).toBe(STORED.discoveryId);
  expect(dto).not.toHaveProperty("queuedAt");
}

export function aMalformedBlobReadsAsNull(): void {
  expect(readDiscovery({ _discovery: { ...STORED, status: "weird" } })).toBeNull();
}

export function anAbsentKeyReadsAsNull(): void {
  expect(readDiscovery({})).toBeNull();
}
