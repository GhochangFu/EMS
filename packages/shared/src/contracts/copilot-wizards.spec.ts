import { expect } from "vitest";

import {
  COPILOT_OPEN_WIZARDS_MAX,
  copilotFillStepDtoSchema,
  copilotOpenWizardSchema,
  copilotTurnBodySchema,
} from "./copilot";

/**
 * `F4.245` / ADR 0099 Amendment 4 — a turn names the wizards open on the
 * user's screen, and a fill names the record it is for. Vitest entry point:
 * the sibling `.test.ts` (ADR 0014).
 */

const DASHBOARD = "11111111-1111-4111-8111-111111111111";
const WIZARD = { catalogId: "dashboard.update", params: { id: DASHBOARD } };

/** Mutation: make the fill's `params` optional — the fill without it parses. */
export function aFillWithoutItsRecordIsRefused(): void {
  expect(copilotFillStepDtoSchema.safeParse({ catalogId: "dashboard.update", stepId: "basics", values: {} }).success).toBe(false);
}

/** Adjacent positive: a fill naming its record round-trips. */
export function aFillCarriesItsRecordParams(): void {
  const fill = { catalogId: "dashboard.update", params: { id: DASHBOARD }, stepId: "basics", values: { name: "A" } };
  expect(copilotFillStepDtoSchema.parse(fill)).toStrictEqual(fill);
}

export function aTurnBodyNamesItsOpenWizards(): void {
  const body = { message: "hi", wizards: [WIZARD] };
  expect(copilotTurnBodySchema.parse(body)).toStrictEqual(body);
}

/** Mutation: `.optional()` on `wizards` — a body without it parses. */
export function aTurnBodyWithoutWizardsIsRefused(): void {
  expect(copilotTurnBodySchema.safeParse({ message: "hi" }).success).toBe(false);
}

/** Mutation: drop `.max(COPILOT_OPEN_WIZARDS_MAX)` — nine wizards parse. */
export function aTurnBodyHoldsAtMostEightWizards(): void {
  const wizards = Array.from({ length: COPILOT_OPEN_WIZARDS_MAX + 1 }, () => WIZARD);
  expect(COPILOT_OPEN_WIZARDS_MAX).toBe(8);
  expect(copilotTurnBodySchema.safeParse({ message: "hi", wizards }).success).toBe(false);
}

/** Mutation: drop `.strict()` on the wizard object — an extra key parses. */
export function anOpenWizardWithAnExtraKeyIsRefused(): void {
  expect(copilotOpenWizardSchema.safeParse({ ...WIZARD, organizationId: DASHBOARD }).success).toBe(false);
}
