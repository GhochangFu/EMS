import { HEALTH_BASELINE_CONTENT } from "@bms/db";
import { expect } from "vitest";

import {
  templateContentSchema,
  templateHealthSchema,
} from "../admin/asset-templates/asset-templates-content.schema";
import { scoreAsset, type TagCounts } from "./health-score";

/**
 * `F4.75` — the seed's health block, held to the schema the API itself runs.
 *
 * **This file exists because the seed writes SQL.** `packages/db` cannot import
 * `templateContentSchema` — it lives in `apps/api` — so nothing on the seed side
 * can tell a valid health block from an invalid one. An invalid one writes
 * cleanly, `AssetHealthService.parseHealth` returns `undefined`, every asset
 * reports `band: null`, and the enterprise donut stays exactly as empty as it
 * was before `F4.75` while `pnpm db:seed` reports success. That is the same
 * silent-success shape `F4.73` measured on the simulator, and the reason the
 * literal is exported from `@bms/db` at all.
 *
 * Vitest entry point lives in the sibling `.test.ts` (ADR 0014). No jsdom and no
 * database: this parses a literal and calls a pure function.
 */

/** One tag whose in-range ratio is exactly `numerator / 100`. */
function tagScoring(numerator: number): TagCounts[] {
  return [
    {
      pointKey: "kw",
      inRangeCount: numerator,
      sampleCount: 100,
      ruleCount: 1,
      skippedRuleCount: 0,
    },
  ];
}

/** The seeded block, parsed by the schema the read path uses. */
function seededHealth() {
  return templateHealthSchema.parse(HEALTH_BASELINE_CONTENT.health);
}

/**
 * The seeded content is content the API's own write path would accept.
 *
 * `create`, `update` and `publish` all run `templateContentSchema` on the body
 * they are given. A seeded row bypasses them, so this is the only place the two
 * are ever compared — and every rule the schema carries is checked by running
 * it, never by restating it here: strictly descending cut-points, a lowest band
 * at `0`, unique band codes, `minScore` inside `0..1`, and no unrecognised key.
 */
export function assertTheSeededContentPassesTheApisOwnSchema(): void {
  const parsed = templateContentSchema.safeParse(HEALTH_BASELINE_CONTENT);
  expect(
    parsed.success ? null : JSON.stringify(parsed.error.issues),
    "the seeded template content must be content the API would accept on create, update and publish",
  ).toBeNull();
}

/**
 * Every score in `0..1` lands in a band — the property the whole row is for.
 *
 * `resolveBand` returns `null` when no band's `minScore` is at or below the
 * score, and `band: null` already means something else entirely (Amendment 1
 * decision 3: this template configures no bands). A gap in the seeded cut-points
 * would give that one value a second meaning, and the donut would under-count
 * without anything failing.
 */
export function assertEveryScoreLandsInABand(): void {
  const health = seededHealth();
  for (let numerator = 0; numerator <= 100; numerator += 1) {
    const { score, band } = scoreAsset(tagScoring(numerator), health);
    expect(score, `a tag at ${numerator}/100 must score`).not.toBeNull();
    expect(band, `a score of ${numerator}/100 must land in a band`).not.toBeNull();
  }
}

/**
 * `minScore` is the **inclusive** lower bound, checked at each cut-point and one
 * sample below it.
 *
 * The pair is the point. A `<` written where `<=` belongs, or a cut-point moved
 * by one hundredth, passes a test that only samples band interiors — and the
 * visible symptom is a donut whose slices are each off by a few assets, which
 * nobody reads as a defect.
 */
export function assertEachCutPointIsAnInclusiveLowerBound(): void {
  const health = seededHealth();
  const expected: [number, string, string][] = [
    [100, "excellent", "excellent"],
    [95, "excellent", "good"],
    [85, "good", "fair"],
    [70, "fair", "poor"],
    [50, "poor", "critical"],
    [0, "critical", "critical"],
  ];
  for (const [numerator, atCutPoint, justBelow] of expected) {
    expect(scoreAsset(tagScoring(numerator), health).band?.code, `at ${numerator}/100`).toBe(
      atCutPoint,
    );
    if (numerator > 0) {
      expect(
        scoreAsset(tagScoring(numerator - 1), health).band?.code,
        `just below ${numerator}/100`,
      ).toBe(justBelow);
    }
  }
}

/**
 * The negative control: without the seeded block, the same scores are unbanded.
 *
 * Without this, every assertion above would still pass against a template that
 * banded everything by accident, and the file would prove the scorer works
 * rather than that the *seed* is what supplies the bands.
 */
export function assertTheSameScoresAreUnbandedWithoutTheSeededBlock(): void {
  for (const numerator of [0, 50, 95, 100]) {
    const { score, band } = scoreAsset(tagScoring(numerator), undefined);
    expect(score, "the score does not depend on a template").not.toBeNull();
    expect(band, "a band does — and there is none without the seeded block").toBeNull();
  }
}
