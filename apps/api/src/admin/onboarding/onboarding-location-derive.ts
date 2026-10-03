import { ONBOARDING_DRAFT_STRING_MAX } from "@bms/shared";
import type { OnboardingDraft } from "@bms/shared";

import { cutToBound, cutToBoundWithHashSuffix } from "./onboarding-draft-caps";

type DraftLocation = NonNullable<OnboardingDraft["location"]>;

/**
 * The location a name derives, lifted out of `handleRuleBasedTurn` (`F3.21`)
 * so the rule-based branch and the agent's `set_location` tool share one copy
 * (AGENTS.md §4.8). The behaviour is unchanged; the full account of each bound
 * — why `slug` is hash-suffixed when cut and `code` is not, why the cut is
 * surrogate-safe — stays on the rule-based branch that first needed it, and
 * `assertRuleBasedTurnBoundsDerivedDraftStrings` still gates it.
 *
 * - `name` is the location name, already bounded by the caller.
 * - `stored` is the draft's current location: its coordinates, province and
 *   capital carry over.
 * - `kept` is spread over the derived fields, so a kept non-empty `slug` or
 *   `code` wins; an empty one is derived from the name.
 * - `type` is written only when given.
 */
export function deriveLocationPatch(input: {
  readonly name: string;
  readonly stored: Partial<DraftLocation> | undefined;
  readonly kept?: Partial<DraftLocation>;
  readonly type?: DraftLocation["type"];
}): DraftLocation {
  const { name, stored, kept, type } = input;
  const slug = cutToBoundWithHashSuffix(
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, ""),
    ONBOARDING_DRAFT_STRING_MAX["location.slug"],
    "lower",
  );
  const code = cutToBound(
    name.toUpperCase().replace(/[^A-Z0-9]+/g, "_"),
    ONBOARDING_DRAFT_STRING_MAX["location.code"],
  );
  return {
    name,
    latitude: stored?.latitude ?? -25.7,
    longitude: stored?.longitude ?? 28.2,
    province: stored?.province,
    capital: stored?.capital,
    ...kept,
    slug: kept?.slug || slug || "location",
    code: kept?.code || code || "LOC",
    ...(type ? { type } : {}),
  } as DraftLocation;
}
