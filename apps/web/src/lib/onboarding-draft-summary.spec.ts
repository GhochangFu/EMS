import type { OnboardingDraft } from "@bms/shared";
import { expect } from "vitest";

import { formatOnboardingDraftSummary } from "./onboarding-draft-summary";

/**
 * `F3.22` P6 (ADR 0091 decision 11) — the preview lists templates and
 * templated assets. One exported function per claim, so a mutation that
 * reddens one does not hide the others. Every assertion is an exact string.
 */

const rtu = { displayName: "RTU-1", protocol: "mqtt", config: { topic: "t/1" } };

function asset(extra: Record<string, unknown> = {}): NonNullable<OnboardingDraft["assets"]>[number] {
  return {
    rtuIndex: 0,
    code: "P1",
    name: "Pump 1",
    siteName: "Site",
    domain: "water",
    ...extra,
  } as NonNullable<OnboardingDraft["assets"]>[number];
}

function draft(extra: Record<string, unknown>): OnboardingDraft {
  return { rtus: [rtu], ...extra } as unknown as OnboardingDraft;
}

/** U1 — an authored template renders its heading and one line. */
export function anAuthoredTemplateRendersItsLine(): void {
  const point = { pointKey: "flow" };
  const text = formatOnboardingDraftSummary({
    templates: [
      { code: "PUMP", name: "Pump", domain: "water", points: [point, point, point] },
    ],
  } as unknown as OnboardingDraft);
  expect(text).toBe("Templates:\n  - PUMP (authored, 3 points)");
}

/** U2 — a stock entry renders as stock. */
export function aStockEntryRendersItsLine(): void {
  const text = formatOnboardingDraftSummary({
    templates: [{ stockCode: "WTP" }],
  } as unknown as OnboardingDraft);
  expect(text).toBe("Templates:\n  - WTP (stock)");
}

/** U3 — a templated asset names its template, with the version when set. */
export function aTemplatedAssetNamesItsTemplate(): void {
  const withVersion = formatOnboardingDraftSummary(
    draft({ assets: [asset({ template: { code: "PUMP", version: 1 } })] }),
  );
  expect(withVersion).toBe(
    "RTUs:\n  1. RTU-1 · mqtt · topic t/1\nAssets:\n  - Pump 1 (P1) on RTU-1 · from template PUMP v1",
  );
  const withoutVersion = formatOnboardingDraftSummary(
    draft({ assets: [asset({ template: { code: "PUMP" } })] }),
  );
  expect(withoutVersion).toBe(
    "RTUs:\n  1. RTU-1 · mqtt · topic t/1\nAssets:\n  - Pump 1 (P1) on RTU-1 · from template PUMP",
  );
}

/** U4 — a plain asset line is byte-identical to the pre-F3.22 line. */
export function aPlainAssetLineIsUnchanged(): void {
  const text = formatOnboardingDraftSummary(draft({ assets: [asset()] }));
  expect(text).toBe("RTUs:\n  1. RTU-1 · mqtt · topic t/1\nAssets:\n  - Pump 1 (P1) on RTU-1");
}

/** U5 — an empty draft still says so. */
export function anEmptyDraftSaysSo(): void {
  expect(formatOnboardingDraftSummary({} as OnboardingDraft)).toBe("Draft is empty.");
}
