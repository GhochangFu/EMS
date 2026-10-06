/**
 * `F4.157` review — the one statement of how a draft patch lands on a draft.
 *
 * `OnboardingChatService.mergeDraft` stores the result, and `finalizeTurn`
 * validates it. They used to differ: `finalizeTurn` was handed a shallow
 * `{ ...draft, ...patch }`, where `patch.location` replaced the stored location
 * wholesale, while `mergeDraft` merges the two locations field by field. A turn
 * whose location patch carried no `type` then reported "Location type is
 * required" for a draft whose stored type the merge was about to keep.
 *
 * No clone here: `mergeDraft` clones the stored value first, and a validation
 * read mutates nothing.
 */
import type { OnboardingDraft } from "@bms/shared";

import type { OnboardingDraftInput } from "./onboarding.schema";

/** `base` with `patch` applied: `location` and `onboardingMeta` field by field, the arrays wholesale. */
export function mergeDraftPatch(base: OnboardingDraft, patch: OnboardingDraftInput): OnboardingDraft {
  return {
    ...base,
    ...patch,
    location: patch.location ? { ...base.location, ...patch.location } : base.location,
    rtus: patch.rtus ?? base.rtus,
    pointKeys: patch.pointKeys ?? base.pointKeys,
    assets: patch.assets ?? base.assets,
    assetPoints: patch.assetPoints ?? base.assetPoints,
    // F3.22 (ADR 0091 decision 2): wholesale, like the other arrays. Without
    // this line a patch's explicit `templates: undefined` erases the stored ones.
    templates: patch.templates ?? base.templates,
    onboardingMeta: patch.onboardingMeta
      ? { ...base.onboardingMeta, ...patch.onboardingMeta }
      : base.onboardingMeta,
  };
}

/**
 * The seven draft sections, in a fixed order. Moved here from the agent loop by
 * `F3.25` (ADR 0094 decision 3): the checkpoint module copies and restores
 * exactly these, so the list has one owner beside the merge it mirrors.
 * Anything else at the top level of a stored draft (`_secrets`,
 * `_commitProposal`) is server state, never a section.
 */
export const DRAFT_SECTIONS = [
  "location",
  "rtus",
  "pointKeys",
  "assets",
  "assetPoints",
  "templates",
  "onboardingMeta",
] as const;

export type DraftSection = (typeof DRAFT_SECTIONS)[number];

/** The seven draft sections that differ, wholesale, so `mergeDraft(stored, patch)` reproduces `working`. */
export function diffSections(stored: OnboardingDraft, working: OnboardingDraft): OnboardingDraftInput {
  const patch: Record<string, unknown> = {};
  for (const section of DRAFT_SECTIONS) {
    if (JSON.stringify(stored[section]) !== JSON.stringify(working[section])) {
      patch[section] = working[section];
    }
  }
  return patch as OnboardingDraftInput;
}
