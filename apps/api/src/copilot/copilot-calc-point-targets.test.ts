import { describe, it } from "vitest";

import {
  aMalformedListIsRefusedBeforeAnyRead,
  anAssetTargetAdmitsOnlyItsKind,
  aRepeatedIdIsRefusedBeforeAnyRead,
  aTwentySixthAssetIsRefusedBeforeAnyRead,
  twentyFiveAssetsAreRead,
} from "./copilot-calc-point-targets.spec";

/** `F4.311` PR 3 — Vitest entry point for the calc-point targets' checks. Assertions live in the sibling `.spec` (§4.6). */
describe("F4.311 PR 3 — the calcPointBatch target refuses a malformed list before any read (Amendment 11 G3)", () => {
  it("refuses a twenty-sixth asset before any read", () => aTwentySixthAssetIsRefusedBeforeAnyRead());
  it("reads twenty-five assets and resolves their organization", () => twentyFiveAssetsAreRead());
  it("refuses an id listed twice before any read", () => aRepeatedIdIsRefusedBeforeAnyRead());
  it("refuses an empty, non-array or non-string list before any read", () => aMalformedListIsRefusedBeforeAnyRead());
});

describe("F4.311 PR 3 — an asset target admits only its kind (Amendment 11 G2)", () => {
  it("admits a pinned or template-less asset as the target's template says", () => anAssetTargetAdmitsOnlyItsKind());
});
