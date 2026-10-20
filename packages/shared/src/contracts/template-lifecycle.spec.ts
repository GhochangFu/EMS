import { canInstantiate, instantiateRefusedMessage } from "./template-lifecycle";

/**
 * `F4.246` — the instantiate rule, declared beside the other lifecycle rules
 * (ADR 0049 decision 2), so the copilot's propose-time mirror reads the set
 * rather than spelling a status literal. Vitest entry point: the sibling
 * `.test.ts` (ADR 0014).
 *
 * The two sentences below are copies of the two routes' literals
 * (`asset-templates-instantiate-core.ts`,
 * `dashboard-templates-instantiate.service.ts`), which are not rewired. What
 * joins each route to `instantiateRefusedMessage` is the route's own
 * integration spec (`asset-templates.instantiate.integration.spec.ts`,
 * `dashboard-templates-instantiate.integration.spec.ts`), which asserts the
 * refusal equals it.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

export function assertAPublishedVersionInstantiates(): void {
  assert(canInstantiate("published"), "a published version must instantiate");
}

export function assertADraftOrArchivedVersionDoesNotInstantiate(): void {
  assert(!canInstantiate("draft"), "a draft must not instantiate");
  assert(!canInstantiate("archived"), "an archived version must not instantiate");
}

export function assertTheDashboardRefusalIsTheDashboardRoutesSentence(): void {
  const actual = instantiateRefusedMessage("draft", "dashboard");
  const expected = "Only a published template can be instantiated; this one is draft";
  assert(actual === expected, `dashboard sentence drifted: ${actual}`);
}

export function assertTheAssetRefusalIsTheAssetRoutesTwoSentences(): void {
  const actual = instantiateRefusedMessage("archived", "asset");
  const expected =
    "Only a published template can be instantiated; this one is archived. " +
    "Publishing is what freezes the shape assets are built from.";
  assert(actual === expected, `asset sentence drifted: ${actual}`);
}
