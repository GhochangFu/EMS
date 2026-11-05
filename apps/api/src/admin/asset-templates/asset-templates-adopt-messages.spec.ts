import { expect } from "vitest";

import { alreadyPinnedMessage, domainMismatchMessage, organizationMismatchMessage } from "./asset-templates-adopt-messages";

/**
 * `F4.315` PR A (ADR 0099 Amendment 14 decision 2) — the three whole-asset
 * adoption sentences the route and the copilot share: each names the asset
 * code and the version as `"<code>" v<version>`. That the route reads them is
 * `asset-templates-adopt-plan.spec.ts`'s; that the copilot does is
 * `copilot-adopt-targets.spec.ts`'s.
 * Vitest entry point: the sibling `.test.ts` (ADR 0014).
 */

const ASSET = { code: "PHE-MFM-000000003", domain: "electrical" };
const VERSION = { code: "PUMP-M", version: 2, domain: "water" };

/** The pinned sentence names the asset and the version, and points to migrate. */
export function thePinnedSentenceNamesTheAssetAndTheVersion(): void {
  const text = alreadyPinnedMessage(ASSET, VERSION);
  expect([text.includes('"PHE-MFM-000000003"'), text.includes('"PUMP-M" v2'), text.includes("migrate")]).toEqual([true, true, true]);
}

/** The organization sentence names the asset and the version. */
export function theOrganizationSentenceNamesTheAssetAndTheVersion(): void {
  const text = organizationMismatchMessage(ASSET, VERSION);
  expect([text.includes('"PHE-MFM-000000003"'), text.includes('"PUMP-M" v2'), text.includes("another organization")]).toEqual([
    true,
    true,
    true,
  ]);
}

/** The domain sentence names the asset, the version and both domains. */
export function theDomainSentenceNamesBothDomains(): void {
  expect(domainMismatchMessage(ASSET, VERSION)).toBe(
    'Asset "PHE-MFM-000000003" has domain "electrical" and template "PUMP-M" v2 declares "water". ' +
      "An asset adopts a version of its own domain only.",
  );
}
