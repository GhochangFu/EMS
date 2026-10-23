import { expect } from "vitest";

import {
  copilotClearEscalationDefaultsModelBodySchema,
  copilotCreateEscalationProfileModelBodySchema,
  copilotSetEscalationDefaultsModelBodySchema,
  setEscalationDefaultsBodySchema,
} from "./escalation-writes";

/**
 * `F4.279` (ADR 0099 Amendment 8, D3, ADR 0030) — the escalation request bodies,
 * now in `@bms/shared`, and the copilot's model bodies. No database.
 */

const ORG = "00000000-0000-4000-8000-000000000001";
const PROFILE = "00000000-0000-4000-8000-000000000002";

/** The copilot's profile create names its organization. */
export function theProfileCreateModelBodyRefusesNoOrganization(): void {
  expect(copilotCreateEscalationProfileModelBodySchema.safeParse({ code: "p1", name: "P1" }).success).toBe(false);
}

/** The positive control: with the organization it parses. */
export function theProfileCreateModelBodyAcceptsAnOrganization(): void {
  expect(
    copilotCreateEscalationProfileModelBodySchema.safeParse({ organizationId: ORG, code: "p1", name: "P1" }).success,
  ).toBe(true);
}

/** D3: the set entry never empties the map; that is the clear entry's red card. */
export function theSetModelBodyRefusesAnEmptyMap(): void {
  expect(copilotSetEscalationDefaultsModelBodySchema.safeParse({ organizationId: ORG, items: [] }).success).toBe(false);
}

/** D3: the clear entry's body is the empty map and nothing else. */
export function theClearModelBodyRefusesItems(): void {
  expect(
    copilotClearEscalationDefaultsModelBodySchema.safeParse({
      organizationId: ORG,
      items: [{ severity: "critical", profileId: PROFILE }],
    }).success,
  ).toBe(false);
}

/** The positive control for the clear: the empty map parses. */
export function theClearModelBodyAcceptsTheEmptyMap(): void {
  expect(copilotClearEscalationDefaultsModelBodySchema.safeParse({ organizationId: ORG, items: [] }).success).toBe(true);
}

/** The clear's body also parses with the route's own body (one route, two entries). */
export function theClearBodyParsesWithTheRouteBody(): void {
  expect(setEscalationDefaultsBodySchema.safeParse({ organizationId: ORG, items: [] }).success).toBe(true);
}
