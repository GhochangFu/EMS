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

/**
 * U1 — an authored template renders its heading and every point under it:
 * key, pattern and whether it is required (`required` defaults to true, ruling
 * Q2-A). The ADR names this preview as the guard on an irreversible publish.
 */
export function anAuthoredTemplateRendersItsLine(): void {
  const text = formatOnboardingDraftSummary({
    templates: [
      {
        code: "PUMP",
        name: "Pump",
        domain: "water",
        points: [
          { pointKey: "flow", sourceDataKeyPattern: "{site}_{asset_code}_FLOW" },
          { pointKey: "head", sourceDataKeyPattern: "{asset_code}_HEAD", required: false },
          { pointKey: "kw" },
        ],
      },
    ],
  } as unknown as OnboardingDraft);
  expect(text).toBe(
    "Templates:\n  - PUMP (authored, 3 points)\n" +
      "      flow · {site}_{asset_code}_FLOW · required\n" +
      "      head · {asset_code}_HEAD · optional\n" +
      "      kw · no pattern · required",
  );
}

/** U2 — a stock entry renders as stock, with no pattern line when it carries none. */
export function aStockEntryRendersItsLine(): void {
  const text = formatOnboardingDraftSummary({
    templates: [{ stockCode: "WTP" }],
  } as unknown as OnboardingDraft);
  expect(text).toBe("Templates:\n  - WTP (stock)");
}

/** U2b — a stock entry lists every `patterns` override under its line (owner ruling Q1-C). */
export function aStockEntryListsItsPatterns(): void {
  const text = formatOnboardingDraftSummary({
    templates: [{ stockCode: "WTP", patterns: { ph: "{asset_code}_PH", turbidity: "{asset_code}_NTU" } }],
  } as unknown as OnboardingDraft);
  expect(text).toBe("Templates:\n  - WTP (stock)\n      ph · {asset_code}_PH\n      turbidity · {asset_code}_NTU");
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
